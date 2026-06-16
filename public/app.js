'use strict';

const LOCKOUT_MIN    = 30;
const WM_BONUS       = 10;
const PLAYER_COLORS  = ['#1a5c38', '#c07d00', '#c0392b', '#2471a3'];

const state = {
  player: null, players: [], matches: [], tips: {},
  jokers: {}, weltmeister: { tips: {}, result: null },
  pendingResult: null, lastRefresh: null,
};

const FLAGS = {
  USA:'🇺🇸', MEX:'🇲🇽', CAN:'🇨🇦',
  GER:'🇩🇪', FRA:'🇫🇷', ESP:'🇪🇸', ENG:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', POR:'🇵🇹',
  NED:'🇳🇱', BEL:'🇧🇪', ITA:'🇮🇹', SUI:'🇨🇭', AUT:'🇦🇹',
  CRO:'🇭🇷', SRB:'🇷🇸', DEN:'🇩🇰', SWE:'🇸🇪', NOR:'🇳🇴',
  POL:'🇵🇱', CZE:'🇨🇿', HUN:'🇭🇺', SCO:'🏴󠁧󠁢󠁳󠁣󠁴󠁿', WAL:'🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  TUR:'🇹🇷', GRE:'🇬🇷', SVK:'🇸🇰', ROU:'🇷🇴', ALB:'🇦🇱',
  SVN:'🇸🇮', UKR:'🇺🇦', GEO:'🇬🇪',
  BRA:'🇧🇷', ARG:'🇦🇷', URU:'🇺🇾', COL:'🇨🇴', ECU:'🇪🇨',
  CHI:'🇨🇱', VEN:'🇻🇪', PAR:'🇵🇾', BOL:'🇧🇴', PER:'🇵🇪',
  MAR:'🇲🇦', SEN:'🇸🇳', GHA:'🇬🇭', CMR:'🇨🇲', EGY:'🇪🇬',
  NGA:'🇳🇬', CIV:'🇨🇮', COD:'🇨🇩', MLI:'🇲🇱', ZAF:'🇿🇦',
  TUN:'🇹🇳', ALG:'🇩🇿', KEN:'🇰🇪', ANG:'🇦🇴',
  JPN:'🇯🇵', KOR:'🇰🇷', AUS:'🇦🇺', IRN:'🇮🇷', SAU:'🇸🇦',
  QAT:'🇶🇦', IRQ:'🇮🇶', JOR:'🇯🇴', UZB:'🇺🇿', BHR:'🇧🇭',
  CRC:'🇨🇷', HON:'🇭🇳', GUA:'🇬🇹', PAN:'🇵🇦', JAM:'🇯🇲',
  NZL:'🇳🇿',
};

const STAGE_NAMES = {
  GROUP_STAGE:   'Gruppenphase',
  ROUND_OF_32:   'Runde der letzten 32',
  ROUND_OF_16:   'Achtelfinale',
  QUARTER_FINALS:'Viertelfinale',
  SEMI_FINALS:   'Halbfinale',
  THIRD_PLACE:   'Spiel um Platz 3',
  FINAL:         'Finale',
};
const STAGE_ORDER = ['GROUP_STAGE','ROUND_OF_32','ROUND_OF_16','QUARTER_FINALS','SEMI_FINALS','THIRD_PLACE','FINAL'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const flag = tla => FLAGS[tla] || '🏳️';

function formatDate(utcStr) {
  if (!utcStr) return '';
  const d = new Date(utcStr);
  return d.toLocaleDateString('de-DE', { weekday:'short', day:'2-digit', month:'2-digit' }) +
    ' · ' + d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' }) + ' Uhr';
}

const groupLabel = g => g ? 'Gruppe ' + g.replace('GROUP_', '') : '';

function calcPoints(tip, result) {
  if (!tip || result.home == null || result.away == null) return null;
  if (+tip.home === +result.home && +tip.away === +result.away) return 4;
  if (Math.sign(tip.home - tip.away) === Math.sign(result.home - result.away)) return 2;
  return 0;
}

function isLocked(match) {
  return new Date() >= new Date(new Date(match.date).getTime() - LOCKOUT_MIN * 60 * 1000);
}

const getInitials = name => name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

function allTeams() {
  const t = new Set();
  state.matches.forEach(m => {
    if (m.homeTeam && m.homeTeam !== 'TBD') t.add(m.homeTeam);
    if (m.awayTeam && m.awayTeam !== 'TBD') t.add(m.awayTeam);
  });
  return [...t].sort();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function showLoginModal() {
  document.getElementById('login-modal').classList.remove('hidden');
}

function hideLoginModal() {
  document.getElementById('login-modal').classList.add('hidden');
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-password').value = '';
}

async function login() {
  const pw = document.getElementById('login-password').value;
  const r = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (r.ok) {
    hideLoginModal();
    _refreshTimer = null;
    init();
  } else {
    const err = await r.json().catch(() => ({}));
    document.getElementById('login-error').textContent = err.error || 'Falsches Passwort';
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function getJSON(url, fallback) {
  try {
    const r = await fetch(url);
    if (r.status === 401) { showLoginModal(); return fallback; }
    if (!r.ok) return fallback;
    return await r.json();
  } catch { return fallback; }
}

async function loadData() {
  const [players, matches, tips, jokers, weltmeister, config] = await Promise.all([
    getJSON('/api/players',     ['Spieler 1', 'Spieler 2', 'Spieler 3', 'Spieler 4']),
    getJSON('/api/matches',     []),
    getJSON('/api/tips',        {}),
    getJSON('/api/jokers',      {}),
    getJSON('/api/weltmeister', { tips: {}, result: null }),
    getJSON('/api/config',      { apiKeySaved: false }),
  ]);
  Object.assign(state, { players, matches, tips, jokers, weltmeister, apiKeySaved: config.apiKeySaved, lastRefresh: new Date() });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const authRes = await fetch('/api/auth');
  if (authRes.status === 401) { showLoginModal(); return; }

  await loadData();
  state.player = localStorage.getItem('currentPlayer');
  const keyEl = document.getElementById('api-key-input');
  if (keyEl) {
    keyEl.value = '';
    keyEl.placeholder = state.apiKeySaved ? '✓ API-Key gespeichert – nur ändern wenn nötig' : 'API-Key eingeben (einmalig)';
  }
  if (!state.player || !state.players.includes(state.player)) {
    showPlayerModal();
  } else {
    showApp();
  }
  startAutoRefresh();
}

// ── Player modal ──────────────────────────────────────────────────────────────
function showPlayerModal() {
  document.getElementById('player-btn-list').innerHTML = state.players.map(name =>
    `<button class="player-select-btn" onclick="selectPlayer('${name}')">${name}</button>`
  ).join('');
  document.getElementById('player-modal').classList.remove('hidden');
}

function selectPlayer(name) {
  state.player = name;
  localStorage.setItem('currentPlayer', name);
  document.getElementById('player-modal').classList.add('hidden');
  document.getElementById('player-chip-name').textContent = name;
  showApp();
}

function showApp() {
  document.getElementById('player-chip-name').textContent = state.player || '–';
  document.getElementById('app').classList.remove('hidden');
  renderAll();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('nav-' + tab).classList.add('active');
  if (tab === 'rangliste') renderLeaderboard();
  if (tab === 'settings')  { renderPlayerInputs(); renderWeltmeisterSettings(); }
}

function renderAll() {
  renderMatches();
  if (document.getElementById('tab-rangliste').classList.contains('active')) renderLeaderboard();
  if (document.getElementById('tab-settings').classList.contains('active')) {
    renderPlayerInputs(); renderWeltmeisterSettings();
  }
  updateRefreshDisplay();
}

// ── Matches ───────────────────────────────────────────────────────────────────
function renderMatches() {
  const filter    = document.getElementById('stage-filter').value;
  const container = document.getElementById('matches-container');
  const noMatches = document.getElementById('no-matches');

  let matches = [...state.matches].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (filter !== 'all') matches = matches.filter(m => m.stage === filter);

  if (matches.length === 0) {
    container.innerHTML = '';
    noMatches.classList.remove('hidden');
    return;
  }
  noMatches.classList.add('hidden');

  const grouped = {};
  matches.forEach(m => { const s = m.stage || '?'; if (!grouped[s]) grouped[s] = []; grouped[s].push(m); });
  const keys = Object.keys(grouped).sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b));

  container.innerHTML = keys.map(stage => `
    <div class="stage-group">
      <div class="stage-label">${STAGE_NAMES[stage] || stage}</div>
      ${grouped[stage].map(matchCard).join('')}
    </div>`).join('');
}

function matchCard(m) {
  const done    = m.status === 'FINISHED';
  const live    = m.status === 'IN_PLAY' || m.status === 'PAUSED';
  const locked  = isLocked(m);
  const tips    = state.tips[m.id] || {};
  const myTip   = tips[state.player];
  const myJoker = state.jokers[state.player] === m.id;

  const statusBadge = done ? '<span class="card-status-done">✓ Beendet</span>'
    : live ? '<span class="card-status-live">🔴 LIVE</span>'
    : formatDate(m.date);

  const cardHeader = `<div class="card-header">
    ${m.group ? `<span class="card-group">${groupLabel(m.group)}</span> · ` : ''}
    ${statusBadge}
  </div>`;

  const scoreCenter = (done || live) && m.score?.home != null
    ? `<div class="score-center"><div class="score-nums">
        <span class="score-num">${m.score.home}</span>
        <span class="score-dash">:</span>
        <span class="score-num">${m.score.away}</span>
       </div></div>`
    : `<div class="score-center">
        ${locked && !done ? '<div class="lock-note">🔒</div>' : '<span class="score-dash" style="font-size:.9rem;padding:0 6px">vs</span>'}
       </div>`;

  const teamsRow = `<div class="teams-row">
    <div class="team"><span class="team-flag">${flag(m.homeTLA)}</span><span class="team-name">${m.homeTeam}</span></div>
    ${scoreCenter}
    <div class="team"><span class="team-flag">${flag(m.awayTLA)}</span><span class="team-name">${m.awayTeam}</span></div>
  </div>`;

  let bottom = '';
  if (done || live) {
    bottom = allTipsSection(m, tips);
  } else if (!locked) {
    const h = myTip?.home ?? 0;
    const a = myTip?.away ?? 0;
    bottom = `<div class="tip-section">
      <div class="tip-label">Dein Tipp</div>
      <div class="tip-controls">
        <button class="tip-btn" onclick="changeTip('${m.id}','home',-1)">−</button>
        <span class="tip-val" id="tip-h-${m.id}">${h}</span>
        <button class="tip-btn" onclick="changeTip('${m.id}','home',1)">+</button>
        <span class="tip-sep">:</span>
        <button class="tip-btn" onclick="changeTip('${m.id}','away',-1)">−</button>
        <span class="tip-val" id="tip-a-${m.id}">${a}</span>
        <button class="tip-btn" onclick="changeTip('${m.id}','away',1)">+</button>
        <button class="tip-save-btn" onclick="saveTip('${m.id}')">Speichern</button>
      </div>
      ${myTip ? `<div class="tip-saved-hint">✓ Dein Tipp: ${myTip.home}:${myTip.away}${myJoker?' 🃏':''}</div>` : ''}
      ${myTip ? jokerBtn(m.id, myJoker) : ''}
      ${missingTips(m.id, tips)}
    </div>`;
  } else {
    const tipTxt = myTip ? `${myTip.home}:${myTip.away}${myJoker?' 🃏':''}` : '–';
    bottom = `<div class="tip-section">
      <span class="tip-locked">🔒 Dein Tipp: <strong>${tipTxt}</strong></span>
      ${missingTips(m.id, tips)}
    </div>`;
  }

  return `<div class="match-card">${cardHeader}${teamsRow}${bottom}</div>`;
}

function jokerBtn(matchId, isActive) {
  const used = state.jokers[state.player];
  if (isActive) return `<button class="joker-btn joker-active" onclick="toggleJoker('${matchId}')">🃏 Joker aktiv – zum Entfernen tippen</button>`;
  if (used)     return `<div class="joker-used-hint">🃏 Joker bereits für ein anderes Spiel eingesetzt</div>`;
  return `<button class="joker-btn" onclick="toggleJoker('${matchId}')">🃏 Joker einsetzen → Punkte x2</button>`;
}

function missingTips(matchId, tips) {
  const chips = state.players.map((name, i) => {
    const has = !!tips[name];
    const tip = tips[name];
    const title = has ? `${name}: ${tip.home}:${tip.away}` : `${name}: kein Tipp`;
    return `<span class="ts-chip ${has ? 'ts-done' : 'ts-missing'}"
      style="${has ? `background:${PLAYER_COLORS[i]}` : ''}"
      title="${title}">${getInitials(name)}</span>`;
  }).join('');
  return `<div class="tipp-status">${chips}</div>`;
}

function allTipsSection(m, tips) {
  const rows = state.players.map((name, i) => {
    const t = tips[name];
    const jokerUsed = state.jokers[name] === m.id;
    let pts = (m.score && t) ? calcPoints(t, m.score) : null;
    if (pts !== null && jokerUsed) pts *= 2;
    const cls = pts === null ? '' : pts >= 8 ? 'pts-4' : pts >= 4 ? 'pts-4' : pts >= 2 ? 'pts-2' : 'pts-0';
    const ptsLabel = pts !== null ? `<span class="tip-pts ${cls}">${pts}P</span>` : '';
    const tipStr = t ? `${t.home}:${t.away}${jokerUsed ? ' 🃏' : ''}` : '<em>kein Tipp</em>';
    return `<div class="tip-row ${!t ? 'no-tip' : ''}">
      <span class="tip-name" style="color:${PLAYER_COLORS[i]}">${name}</span>
      <span class="tip-score">${tipStr}</span>
      ${ptsLabel}
    </div>`;
  }).join('');
  return `<div class="all-tips">${rows}</div>
    <button class="result-edit-btn" onclick="openResultModal('${m.id}')">✏️ Ergebnis korrigieren</button>`;
}

// ── Tip input ─────────────────────────────────────────────────────────────────
const tipDraft = {};

function changeTip(matchId, side, delta) {
  if (!tipDraft[matchId]) {
    const ex = (state.tips[matchId] || {})[state.player];
    tipDraft[matchId] = ex ? { home: +ex.home, away: +ex.away } : { home: 0, away: 0 };
  }
  tipDraft[matchId][side] = Math.max(0, tipDraft[matchId][side] + delta);
  document.getElementById(`tip-h-${matchId}`).textContent = tipDraft[matchId].home;
  document.getElementById(`tip-a-${matchId}`).textContent = tipDraft[matchId].away;
}

async function saveTip(matchId) {
  const draft = tipDraft[matchId] || { home: 0, away: 0 };
  const r = await fetch(`/api/tips/${matchId}/${encodeURIComponent(state.player)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
  });
  if (!r.ok) { alert((await r.json()).error); return; }
  if (!state.tips[matchId]) state.tips[matchId] = {};
  state.tips[matchId][state.player] = draft;
  renderMatches();
}

// ── Joker ─────────────────────────────────────────────────────────────────────
async function toggleJoker(matchId) {
  const isActive = state.jokers[state.player] === matchId;
  const newId = isActive ? null : matchId;
  if (!isActive) {
    const msg = state.jokers[state.player]
      ? 'Joker von einem anderen Spiel hierhin wechseln?'
      : 'Joker einsetzen? Dein Tipp zählt dann doppelt!\n(Nur einmal pro Turnier)';
    if (!confirm(msg)) return;
  }
  const r = await fetch(`/api/jokers/${encodeURIComponent(state.player)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId: newId }),
  });
  if (!r.ok) { alert((await r.json()).error); return; }
  state.jokers[state.player] = newId;
  renderMatches();
}

// ── Result modal ──────────────────────────────────────────────────────────────
function openResultModal(matchId) {
  const m = state.matches.find(x => x.id === matchId);
  if (!m) return;
  state.pendingResult = { matchId, homeVal: m.score?.home ?? 0, awayVal: m.score?.away ?? 0 };
  document.getElementById('result-home-name').textContent = m.homeTeam;
  document.getElementById('result-away-name').textContent = m.awayTeam;
  document.getElementById('result-home-val').textContent  = state.pendingResult.homeVal;
  document.getElementById('result-away-val').textContent  = state.pendingResult.awayVal;
  document.getElementById('result-modal-title').textContent = `${flag(m.homeTLA)} ${m.homeTeam} – ${m.awayTeam} ${flag(m.awayTLA)}`;
  document.getElementById('result-modal').classList.remove('hidden');
}

function closeResultModal() {
  document.getElementById('result-modal').classList.add('hidden');
  state.pendingResult = null;
}

function changeResult(side, delta) {
  if (!state.pendingResult) return;
  const key = side === 'home' ? 'homeVal' : 'awayVal';
  state.pendingResult[key] = Math.max(0, state.pendingResult[key] + delta);
  document.getElementById(`result-${side}-val`).textContent = state.pendingResult[key];
}

async function submitResult() {
  const { matchId, homeVal, awayVal } = state.pendingResult;
  const r = await fetch(`/api/matches/${matchId}/result`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ home: homeVal, away: awayVal }),
  });
  if (!r.ok) { alert('Fehler beim Speichern'); return; }
  const idx = state.matches.findIndex(m => m.id === matchId);
  if (idx !== -1) state.matches[idx] = { ...state.matches[idx], score: { home: homeVal, away: awayVal }, status: 'FINISHED' };
  closeResultModal();
  renderMatches();
  renderLeaderboard();
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function calcStats() {
  const finished = state.matches.filter(m => m.status === 'FINISHED' && m.score);
  return state.players.map((name, i) => {
    let total = 0, exact = 0, trend = 0;
    finished.forEach(m => {
      const t = (state.tips[m.id] || {})[name];
      let pts = calcPoints(t, m.score);
      if (pts === null) return;
      if (state.jokers[name] === m.id) pts *= 2;
      total += pts;
      if (pts >= 4) exact++; else if (pts >= 2) trend++;
    });
    let wmBonus = 0;
    if (state.weltmeister.result && state.weltmeister.tips[name] === state.weltmeister.result) {
      wmBonus = WM_BONUS; total += wmBonus;
    }
    return { name, total, exact, trend, played: exact + trend, wmBonus, color: PLAYER_COLORS[i] };
  });
}

function renderLeaderboard() {
  const stats = calcStats().sort((a, b) => b.total - a.total || b.exact - a.exact);
  const medals = ['🥇','🥈','🥉','4️⃣'];

  const podium = `<div class="podium">${stats.map((s, i) => `
    <div class="podium-item">
      <span class="podium-rank">${medals[i] || ''}</span>
      <span class="podium-name">${s.name}</span>
      <span class="podium-pts" style="color:${s.color}">${s.total}P</span>
      <div class="podium-bar" style="background:${['var(--gold)','var(--silver)','#cd7f32','var(--border)'][i] || 'var(--border)'}"></div>
    </div>`).join('')}</div>`;

  const rows = stats.map((s, i) => `
    <div class="lb-row ${['rank-1','rank-2','rank-3',''][i]||''} ${s.name===state.player?'me':''}">
      <div class="lb-rank">${i+1}.</div>
      <div class="lb-name" style="color:${s.color}">${s.name}${s.name===state.player?' 👤':''}${state.jokers[s.name]?' 🃏':''}</div>
      <div class="lb-cell">${s.exact}</div>
      <div class="lb-cell">${s.trend}</div>
      <div class="lb-cell">${s.played}</div>
      <div class="lb-pts">${s.total}${s.wmBonus?`<span style="font-size:.65rem;color:var(--muted)"> +${s.wmBonus}🌍</span>`:''}
      </div>
    </div>`).join('');

  const table = `<div class="lb-table">
    <div class="lb-row header">
      <div></div><div>Spieler</div>
      <div class="lb-cell" title="Exakt">🎯</div>
      <div class="lb-cell" title="Tendenz">✓</div>
      <div class="lb-cell" title="Gespielt">⚽</div>
      <div class="lb-pts">Pkt</div>
    </div>${rows}</div>`;

  document.getElementById('leaderboard').innerHTML = podium + table + renderWmSection() + renderVerlauf();
}

// ── Weltmeister ───────────────────────────────────────────────────────────────
function renderWmSection() {
  const wm = state.weltmeister;
  const rows = state.players.map((name, i) => {
    const pick = wm.tips[name];
    const correct = wm.result && pick === wm.result;
    return `<div class="wm-row">
      <span class="wm-name" style="color:${PLAYER_COLORS[i]}">${name}</span>
      <span class="wm-pick">${pick
        ? `${pick} ${correct ? `✅ +${WM_BONUS}P` : wm.result ? '❌' : ''}`
        : '<em>nicht getippt</em>'}</span>
    </div>`;
  }).join('');
  const resultLine = wm.result
    ? `<div class="wm-result">🏆 Weltmeister: <strong>${wm.result}</strong></div>`
    : `<div class="wm-result-pending">Ergebnis noch offen</div>`;
  return `<div class="wm-section"><div class="section-title">🌍 Weltmeister-Tipp</div>${resultLine}${rows}</div>`;
}

function renderWeltmeisterSettings() {
  const teams  = allTeams();
  const myPick = state.weltmeister.tips[state.player] || '';
  const result = state.weltmeister.result || '';
  const opts   = t => teams.map(x => `<option value="${x}" ${x===t?'selected':''}>${x}</option>`).join('');

  document.getElementById('wm-settings').innerHTML = `
    <div class="wm-tip-row">
      <label>Dein Tipp:</label>
      <select id="wm-team-select" ${!teams.length?'disabled':''}>
        <option value="">– Bitte wählen –</option>
        ${opts(myPick)}
      </select>
      <button class="btn-small-green" onclick="saveWeltmeisterTip()">✓</button>
    </div>
    ${myPick ? `<div class="tip-saved-hint">✓ Dein Tipp: ${myPick}</div>` : ''}
    <details style="margin-top:12px">
      <summary style="color:var(--muted);font-size:.85rem;cursor:pointer">Ergebnis eintragen (nach dem Finale)</summary>
      <div class="wm-result-row" style="margin-top:8px">
        <select id="wm-result-select">
          <option value="">– Weltmeister –</option>
          ${opts(result)}
        </select>
        <button class="btn-small-green" onclick="saveWeltmeisterResult()">Speichern</button>
      </div>
      ${result ? `<div class="tip-saved-hint" style="margin-top:6px">Eingetragen: ${result}</div>` : ''}
    </details>`;
}

async function saveWeltmeisterTip() {
  const team = document.getElementById('wm-team-select')?.value;
  if (!team) { alert('Bitte ein Team auswählen'); return; }
  const r = await fetch(`/api/weltmeister/tip/${encodeURIComponent(state.player)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team }),
  });
  if (!r.ok) { alert((await r.json()).error); return; }
  state.weltmeister.tips[state.player] = team;
  renderWeltmeisterSettings();
}

async function saveWeltmeisterResult() {
  const team = document.getElementById('wm-result-select')?.value || null;
  const r = await fetch('/api/weltmeister/result', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team }),
  });
  if (!r.ok) { alert('Fehler'); return; }
  state.weltmeister.result = team;
  renderWeltmeisterSettings();
  renderLeaderboard();
}

// ── Verlauf Chart ─────────────────────────────────────────────────────────────
function renderVerlauf() {
  const finished = [...state.matches]
    .filter(m => m.status === 'FINISHED' && m.score)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (finished.length < 2) {
    return `<div class="chart-section"><div class="section-title">📈 Verlauf</div><p class="chart-empty">Noch zu wenige Spiele für einen Verlauf.</p></div>`;
  }

  const run = {};
  state.players.forEach(p => run[p] = 0);
  const series = {};
  state.players.forEach(p => series[p] = [0]);

  finished.forEach(m => {
    state.players.forEach(p => {
      const t = (state.tips[m.id] || {})[p];
      let pts = calcPoints(t, m.score) || 0;
      if (state.jokers[p] === m.id) pts *= 2;
      run[p] += pts;
      series[p].push(run[p]);
    });
  });

  const n    = finished.length + 1;
  const maxY = Math.max(...Object.values(series).flat(), 4);
  const W = 320, H = 150;
  const P = { t: 10, r: 12, b: 28, l: 32 };
  const cW = W - P.l - P.r, cH = H - P.t - P.b;

  const tx = i => P.l + (i / (n - 1)) * cW;
  const ty = v => P.t + cH - (v / maxY) * cH;

  const grid = [0, Math.round(maxY / 2), maxY].map(v =>
    `<line x1="${P.l}" x2="${W-P.r}" y1="${ty(v).toFixed(1)}" y2="${ty(v).toFixed(1)}" stroke="#e0e6e3" stroke-width="1"/>
     <text x="${(P.l-4).toFixed()}" y="${(ty(v)+4).toFixed()}" text-anchor="end" font-size="9" fill="#aaa">${v}</text>`
  ).join('');

  const lines = state.players.map((p, pi) => {
    const pts = series[p];
    const d = pts.map((v, i) => `${i===0?'M':'L'}${tx(i).toFixed(1)},${ty(v).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return `<path d="${d}" fill="none" stroke="${PLAYER_COLORS[pi]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${tx(n-1).toFixed(1)}" cy="${ty(last).toFixed(1)}" r="3.5" fill="${PLAYER_COLORS[pi]}"/>`;
  }).join('');

  const legend = state.players.map((p, pi) =>
    `<div class="cl-item"><span class="cl-dot" style="background:${PLAYER_COLORS[pi]}"></span>${p}</div>`
  ).join('');

  const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
    ${grid}
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${P.t+cH}" stroke="#ccc" stroke-width="1"/>
    ${lines}
    <text x="${P.l}" y="${H-6}" font-size="9" fill="#aaa">Start</text>
    <text x="${W-P.r}" y="${H-6}" text-anchor="end" font-size="9" fill="#aaa">Spiel ${finished.length}</text>
  </svg>`;

  return `<div class="chart-section">
    <div class="section-title">📈 Punkte-Verlauf</div>
    <div class="chart-wrap">${svg}</div>
    <div class="chart-legend">${legend}</div>
  </div>`;
}

// ── Settings ──────────────────────────────────────────────────────────────────
function renderPlayerInputs() {
  document.getElementById('player-name-inputs').innerHTML = state.players.map((name, i) => `
    <div class="player-name-row">
      <span class="player-color-dot" style="background:${PLAYER_COLORS[i]}"></span>
      <input type="text" value="${name}" id="pname-${i}" placeholder="Name eingeben">
    </div>`).join('');
}

async function savePlayerNames() {
  const names = state.players.map((_, i) => document.getElementById(`pname-${i}`)?.value.trim() || state.players[i]);
  await fetch('/api/players', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(names),
  });
  state.players = names;
  state.player  = names.includes(state.player) ? state.player : names[0];
  localStorage.setItem('currentPlayer', state.player);
  document.getElementById('player-chip-name').textContent = state.player;
  renderAll();
  alert('Namen gespeichert! ✓');
}

async function changePassword() {
  const currentPassword = document.getElementById('current-password-input').value;
  const newPassword = document.getElementById('new-password-input').value;
  const statusEl = document.getElementById('password-status');
  if (!newPassword || newPassword.length < 4) {
    statusEl.innerHTML = '<span class="status-err">Neues Passwort muss mind. 4 Zeichen haben</span>';
    return;
  }
  const r = await fetch('/api/settings/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok) {
    statusEl.innerHTML = '<span class="status-ok">✓ Passwort geändert. Bitte neu einloggen.</span>';
    document.getElementById('current-password-input').value = '';
    document.getElementById('new-password-input').value = '';
    setTimeout(showLoginModal, 1200);
  } else {
    statusEl.innerHTML = `<span class="status-err">⚠️ ${data.error || 'Fehler'}</span>`;
  }
}

async function syncMatches() {
  const keyInput = document.getElementById('api-key-input').value.trim();
  const statusEl = document.getElementById('sync-status');
  statusEl.innerHTML = '<span>⏳ Lade Daten…</span>';

  const r = await fetch('/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: keyInput || undefined }),
  });
  const data = await r.json();

  if (r.ok) {
    state.apiKeySaved = true;
    document.getElementById('api-key-input').value = '';
    document.getElementById('api-key-input').placeholder = '✓ API-Key gespeichert';
    statusEl.innerHTML = `<span class="status-ok">✓ ${data.count} Spiele geladen! Key wird gespeichert.</span>`;
    state.matches = await fetch('/api/matches').then(x => x.json());
    state.lastRefresh = new Date();
    renderMatches(); renderLeaderboard(); renderWeltmeisterSettings();
  } else {
    statusEl.innerHTML = `<span class="status-err">⚠️ ${data.error}</span>`;
  }
}

// ── Auto-Refresh ──────────────────────────────────────────────────────────────
let _refreshTimer = null;

function startAutoRefresh() {
  if (_refreshTimer) return;
  const NORMAL = 3 * 60 * 1000, LIVE = 60 * 1000;

  async function tick() {
    _refreshTimer = null;
    try {
      const matchesRes = await fetch('/api/matches');
      if (matchesRes.status === 401) { showLoginModal(); return; }
      const [matches, tips, jokers] = await Promise.all([
        matchesRes.json(),
        fetch('/api/tips').then(r => r.json()),
        fetch('/api/jokers').then(r => r.json()),
      ]);
      const changed = JSON.stringify(matches) !== JSON.stringify(state.matches)
                   || JSON.stringify(tips)    !== JSON.stringify(state.tips);
      Object.assign(state, { matches, tips, jokers, lastRefresh: new Date() });
      if (changed) renderAll();
      updateRefreshDisplay();
    } catch {}
    const hasLive = state.matches.some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED');
    _refreshTimer = setTimeout(tick, hasLive ? LIVE : NORMAL);
  }

  _refreshTimer = setTimeout(tick, NORMAL);
}

function updateRefreshDisplay() {
  const el = document.getElementById('refresh-time');
  if (!el || !state.lastRefresh) return;
  el.textContent = '🔄 ' + state.lastRefresh.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
