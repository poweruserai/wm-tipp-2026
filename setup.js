#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { hashPassword } = require('./lib/auth');

const DATA_DIR = path.join(__dirname, 'data');
const ENV_PATH = path.join(__dirname, '.env');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('🏆 WM 2026 Tippspiel – Einrichtung\n');

  if (fs.existsSync(path.join(DATA_DIR, 'players.json'))) {
    const overwrite = await ask('⚠️  Es gibt bereits Daten in ./data. Trotzdem neu einrichten und überschreiben? (j/N): ');
    if (!/^j/i.test(overwrite.trim())) {
      console.log('Abgebrochen.');
      rl.close();
      return;
    }
  }

  const countInput = (await ask('Wie viele Mitspieler sind dabei? (mind. 2, Enter = 4): ')).trim();
  let count = parseInt(countInput, 10);
  if (countInput === '' ) count = 4;
  if (!Number.isInteger(count) || count < 2) count = Math.max(2, count || 4);

  const players = [];
  for (let i = 1; i <= count; i++) {
    const name = (await ask(`Name von Spieler ${i} (Enter = "Spieler ${i}"): `)).trim();
    players.push(name || `Spieler ${i}`);
  }

  const pw = (await ask('Passwort für die App (Enter = Standard "WM2026!"): ')).trim() || 'WM2026!';
  const port = (await ask('Port (Enter = 3000): ')).trim() || '3000';

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'players.json'), JSON.stringify(players, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify({ apiKey: null, passwordHash: hashPassword(pw) }, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'tips.json'), JSON.stringify({}, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'matches.json'), JSON.stringify([], null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'jokers.json'), JSON.stringify({}, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'weltmeister.json'), JSON.stringify({ tips: {}, result: null }, null, 2));
  fs.writeFileSync(ENV_PATH, `PORT=${port}\n`);

  console.log('\n✅ Fertig eingerichtet!');
  console.log('   Mitspieler:', players.join(', '));
  console.log(`   Passwort:   ${pw}  (später in der App unter Einstellungen änderbar)`);
  console.log('\nStarten mit: npm start\n');
  rl.close();
}

main();
