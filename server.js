require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hashPassword, verifyPassword } = require('./lib/auth');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

const DATA = path.join(__dirname, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);

const LOCKOUT_MIN = 30;
const sessions = new Set();

function read(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8')); }
  catch { return null; }
}
function write(name, data) {
  fs.writeFileSync(path.join(DATA, name + '.json'), JSON.stringify(data, null, 2));
}

function lockTime(matchDate) {
  return new Date(new Date(matchDate).getTime() - LOCKOUT_MIN * 60 * 1000);
}

// Defaults
if (!read('players'))     write('players', ['Spieler 1', 'Spieler 2']);
if (!read('tips'))        write('tips', {});
if (!read('matches'))     write('matches', []);
if (!read('jokers'))      write('jokers', {});
if (!read('weltmeister')) write('weltmeister', { tips: {}, result: null });

{
  const config = read('config') || {};
  if (config.apiKey === undefined) config.apiKey = null;
  if (!config.passwordHash) config.passwordHash = hashPassword(process.env.APP_PASSWORD || 'WM2026!');
  write('config', config);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies['wm-session'];
  if (token && sessions.has(token)) return next();
  res.status(401).json({ error: 'Nicht angemeldet' });
}

app.post('/api/auth', (req, res) => {
  const config = read('config') || {};
  if (verifyPassword(req.body.password || '', config.passwordHash)) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.add(token);
    res.cookie('wm-session', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Falsches Passwort' });
});

app.get('/api/auth', (req, res) => {
  const token = req.cookies['wm-session'];
  if (token && sessions.has(token)) return res.json({ ok: true });
  res.status(401).json({ error: 'Nicht angemeldet' });
});

// Auth-Middleware für alle weiteren /api-Routen
app.use('/api', (req, res, next) => {
  if (req.path === '/auth') return next();
  requireAuth(req, res, next);
});

// ── Config ────────────────────────────────────────────────────────────────────
app.get('/api/config', (_, res) => {
  const config = read('config') || {};
  res.json({ apiKeySaved: !!config.apiKey });
});

app.put('/api/config', (req, res) => {
  const config = read('config') || {};
  if (req.body.apiKey !== undefined) config.apiKey = req.body.apiKey || null;
  write('config', config);
  res.json({ ok: true });
});

// ── Passwort ändern ─────────────────────────────────────────────────────────
app.put('/api/settings/password', (req, res) => {
  const config = read('config') || {};
  const { currentPassword, newPassword } = req.body;
  if (!verifyPassword(currentPassword || '', config.passwordHash)) {
    return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Neues Passwort muss mind. 4 Zeichen haben' });
  }
  config.passwordHash = hashPassword(newPassword);
  write('config', config);
  sessions.clear();
  res.json({ ok: true });
});

// ── Players ───────────────────────────────────────────────────────────────────
app.get('/api/players', (_, res) => res.json(read('players') || []));
app.put('/api/players', (req, res) => { write('players', req.body); res.json({ ok: true }); });

// ── Matches ───────────────────────────────────────────────────────────────────
app.get('/api/matches', (_, res) => res.json(read('matches') || []));

app.put('/api/matches/:id/result', (req, res) => {
  const matches = read('matches') || [];
  const idx = matches.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Nicht gefunden' });
  matches[idx] = { ...matches[idx], score: req.body, status: 'FINISHED' };
  write('matches', matches);
  res.json({ ok: true });
});

// ── Tips ──────────────────────────────────────────────────────────────────────
app.get('/api/tips', (_, res) => res.json(read('tips') || {}));

app.put('/api/tips/:matchId/:player', (req, res) => {
  const match = (read('matches') || []).find(m => m.id === req.params.matchId);
  if (match && new Date() > lockTime(match.date)) {
    return res.status(403).json({ error: `Tipp gesperrt – ${LOCKOUT_MIN} Minuten vor Anpfiff ist Schluss!` });
  }
  const tips = read('tips') || {};
  if (!tips[req.params.matchId]) tips[req.params.matchId] = {};
  tips[req.params.matchId][decodeURIComponent(req.params.player)] = req.body;
  write('tips', tips);
  res.json({ ok: true });
});

// ── Jokers ────────────────────────────────────────────────────────────────────
app.get('/api/jokers', (_, res) => res.json(read('jokers') || {}));

app.put('/api/jokers/:player', (req, res) => {
  if (req.body.matchId) {
    const match = (read('matches') || []).find(m => m.id === req.body.matchId);
    if (match && new Date() > lockTime(match.date)) {
      return res.status(403).json({ error: 'Dieses Spiel ist bereits gesperrt.' });
    }
  }
  const jokers = read('jokers') || {};
  jokers[decodeURIComponent(req.params.player)] = req.body.matchId || null;
  write('jokers', jokers);
  res.json({ ok: true });
});

// ── Weltmeister ───────────────────────────────────────────────────────────────
app.get('/api/weltmeister', (_, res) => res.json(read('weltmeister') || { tips: {}, result: null }));

app.put('/api/weltmeister/tip/:player', (req, res) => {
  const final = (read('matches') || []).find(m => m.stage === 'FINAL');
  if (final && new Date() > lockTime(final.date)) {
    return res.status(403).json({ error: 'Weltmeister-Tipp gesperrt (Finale hat begonnen).' });
  }
  const wm = read('weltmeister') || { tips: {}, result: null };
  wm.tips[decodeURIComponent(req.params.player)] = req.body.team;
  write('weltmeister', wm);
  res.json({ ok: true });
});

app.put('/api/weltmeister/result', (req, res) => {
  const wm = read('weltmeister') || { tips: {}, result: null };
  wm.result = req.body.team || null;
  write('weltmeister', wm);
  res.json({ ok: true });
});

// ── Sync-Logik ────────────────────────────────────────────────────────────────
async function syncFromApi(keyOverride) {
  const config = read('config') || {};
  const key = keyOverride || config.apiKey || process.env.FOOTBALL_API_KEY;
  if (!key) return { error: 'Kein API-Key angegeben.' };

  const response = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': key }
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { error: err.message || `API-Fehler ${response.status}`, status: response.status };
  }
  const data = await response.json();
  const prevMap = Object.fromEntries((read('matches') || []).map(m => [m.id, m]));

  const matches = data.matches.map(m => {
    const prev = prevMap[String(m.id)] || {};
    const done = m.status === 'FINISHED';
    const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
    let score = prev.score || null;
    if (done || live) {
      score = {
        home: m.score.fullTime.home ?? m.score.halfTime?.home ?? null,
        away: m.score.fullTime.away ?? m.score.halfTime?.away ?? null
      };
    }
    return {
      id: String(m.id),
      date: m.utcDate,
      homeTeam: m.homeTeam.name,
      awayTeam: m.awayTeam.name,
      homeTLA: m.homeTeam.tla,
      awayTLA: m.awayTeam.tla,
      status: m.status,
      stage: m.stage,
      group: m.group,
      score
    };
  });

  write('matches', matches);
  return { ok: true, count: matches.length };
}

app.post('/api/sync', async (req, res) => {
  const config = read('config') || {};
  const keyOverride = req.body.apiKey || null;
  if (keyOverride) write('config', { ...config, apiKey: keyOverride });

  try {
    const result = await syncFromApi(keyOverride);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auto-Sync (stündlich) ─────────────────────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  const config = read('config') || {};
  if (!config.apiKey && !process.env.FOOTBALL_API_KEY) return;
  try {
    const result = await syncFromApi();
    console.log(`[Auto-Sync] ${new Date().toISOString()} → ${result.count != null ? result.count + ' Spiele' : result.error}`);
  } catch (err) {
    console.error('[Auto-Sync] Fehler:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏆 WM 2026 Tippspiel: http://localhost:${PORT}`));
