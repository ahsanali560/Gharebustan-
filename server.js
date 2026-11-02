'use strict';
// Gharabustan server: static files + WebSocket rooms (custom matches only).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { WebSocketServer } = require('ws');
const GMap = require('./map.js');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/') u = '/index.html';
  if (u === '/info') {
    const ips = [], nets = os.networkInterfaces();
    Object.keys(nets).forEach((n) => nets[n].forEach((a) => { if (a.family === 'IPv4' && !a.internal) ips.push(a.address); }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ ips: ips, port: PORT }));
  }
  if (u === '/map.js') return send(res, path.join(__dirname, 'map.js'));
  const f = path.normalize(path.join(PUB, u));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end('no'); }
  send(res, f);
});
function send(res, f) {
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Pragma': 'no-cache', 'Expires': '0' });
    res.end(data);
  });
}

// Download the 3D engine once so every device gets it from this server (works on WiFi without internet on phones).
const THREE_FILE = path.join(PUB, 'vendor', 'three.min.js');
function fetchThree() {
  if (fs.existsSync(THREE_FILE)) return;
  fs.mkdirSync(path.dirname(THREE_FILE), { recursive: true });
  const url = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  https.get(url, (r) => {
    if (r.statusCode !== 200) { r.resume(); return console.log('  (three.js download nahi hua, browser CDN se le lega)'); }
    const chunks = []; r.on('data', (c) => chunks.push(c));
    r.on('end', () => { try { fs.writeFileSync(THREE_FILE, Buffer.concat(chunks)); console.log('  3D engine download ho gaya.'); } catch (e) { /* ignore */ } });
  }).on('error', () => console.log('  (three.js download nahi hua, browser CDN se le lega)'));
}
fetchThree();

// ---------------- game rules ----------------
const MAX_HP = 200;
const WEAPONS = {
  fist:    { dmg: 8,  rate: 0.45, spread: 0.0,  pellets: 1, range: 3 },
  pistol:  { dmg: 20, rate: 0.35, spread: 0.01, pellets: 1, range: 90 },
  smg:     { dmg: 11, rate: 0.08, spread: 0.04, pellets: 1, range: 70 },
  ar:      { dmg: 16, rate: 0.11, spread: 0.025, pellets: 1, range: 130 },
  shotgun: { dmg: 10, rate: 0.9,  spread: 0.08, pellets: 7, range: 35 },
  sniper:  { dmg: 75, rate: 1.5,  spread: 0.0,  pellets: 1, range: 300 }
};
const isGun = (k) => !!WEAPONS[k] && k !== 'fist';
const ZONE_PHASES = [  // [wait seconds, shrink seconds, end radius, dps]
  [45, 40, 120, 2], [35, 30, 80, 4], [30, 25, 45, 6], [25, 20, 20, 9], [20, 15, 6, 14]
];
const ZONE_CS = [[22, 22, 55, 3], [18, 18, 22, 6], [14, 14, 6, 12]];
const TICK = 1 / 15;
const HEAL_MS = 2500, WALL_LIFE_MS = 30000, WALL_HP = 350;

const rooms = new Map();
let nextId = 1;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)]; } while (rooms.has(c));
  return c;
}
function sendTo(p, obj) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); }
function bcast(room, obj) { const s = JSON.stringify(obj); room.players.forEach(p => { if (p.ws.readyState === 1) p.ws.send(s); }); }
function cleanCos(c) {
  c = c || {};
  const col = (v) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : undefined);
  const o = { hat: Math.max(0, Math.min(5, c.hat | 0)) };
  const t = col(c.top), b = col(c.bottom); if (t !== undefined) o.top = t; if (b !== undefined) o.bottom = b;
  return o;
}
function lobbyInfo(room) {
  return {
    t: 'lobby', code: room.code, host: room.host, state: room.state,
    mode: room.cfg.mode, cfg: { name: room.cfg.name, mode: room.cfg.mode, bots: room.cfg.bots, botN: room.cfg.botN, lock: !!room.cfg.pass, solo: !!room.solo },
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, char: p.char, cos: p.cos, bot: p.bot ? 1 : 0, team: p.team }))
  };
}
function weaponOf(p) { return p.cur >= 0 && p.slots[p.cur] ? p.slots[p.cur] : 'fist'; }
function sendInv(p) { sendTo(p, { t: 'inv', slots: p.slots, cur: p.cur, medkits: p.medkits, walls: p.walls }); }

function cleanCfg(c) {
  c = c || {};
  const mode = c.mode === 'cs' ? 'cs' : 'br';
  return {
    name: String(c.name || '').trim().slice(0, 18), pass: String(c.pass || '').slice(0, 8), mode,
    bots: c.bots !== false, botN: mode === 'cs' ? 0 : Math.max(0, Math.min(25, c.botN === undefined ? 25 : c.botN | 0)),
    pub: !!c.pub
  };
}
function newRoom(cfg) {
  const room = { code: makeCode(), host: null, players: new Map(), state: 'lobby', loot: [], zone: null, timer: null, t0: 0, walls: [], wallSeq: 0, cfg: cleanCfg(cfg), mode: 'br', zp: ZONE_PHASES, score: [0, 0], round: 0 };
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, ws, name, ch) {
  const p = {
    id: nextId++, ws, room, name: (name || 'Player').slice(0, 14), char: ch | 0,
    x: 0, y: 0, z: 0, ry: 0, pitch: 0, anim: 0, air: false, hp: MAX_HP, armor: 0, alive: true, kills: 0, dmg: 0, lastShot: 0,
    slots: ['pistol', null, null], cur: 0, medkits: 0, walls: 0, healing: 0, lastWall: 0
  };
  room.players.set(p.id, p);
  ws.player = p;
  if (room.host === null) room.host = p.id;
  return p;
}

function addDrop(room, kind, x, z) {
  const id = room.loot.length, ox = x + (Math.random() - 0.5) * 1.6, oz = z + (Math.random() - 0.5) * 1.6;
  room.loot.push({ id, kind, x: ox, z: oz, taken: false });
  bcast(room, { t: 'drop', id, kind, x: ox, z: oz });
}

const BOT_NAMES = ['Sher Khan', 'Bilal Bhai', 'Chacha Pro', 'Rocky', 'Gullu', 'Pappu', 'Zeeshan', 'Kaleem', 'Tiger', 'Jani', 'Mithu', 'Bobby', 'Raja', 'Shakeel', 'Munna', 'Billu', 'Sultan', 'Fauji', 'Lala', 'Chhotu', 'Nawab', 'Dabang', 'Kaka', 'Shehzad', 'Tipu', 'Pehlwan', 'Gogi', 'Ustad', 'Babar', 'Haji Sahab', 'Jugnu', 'Kamran'];
const humansOf = (room) => [...room.players.values()].filter(p => !p.bot);
function addBot(room, team) {
  const taken = new Set([...room.players.values()].map(p => p.name));
  let nm; for (let i = 0; i < 40; i++) { nm = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]; if (!taken.has(nm)) break; }
  const p = addPlayer(room, { readyState: 0, send() {} }, nm, Math.floor(Math.random() * 3));
  p.bot = true; p.team = team; p.cos = { hat: Math.random() < 0.5 ? 0 : 1 + Math.floor(Math.random() * 5) };
  p.ai = { t: 0, tgt: 0, strafe: 1, strafeAt: 0, stuck: 0, avoid: 0, wp: null, wpAt: 0, nextFire: 0, react: 0, lastSeen: 0, loot: -1, lootAt: 0, acc: 0.9 + Math.random() * 0.5 };
  return p;
}
function giveLoadout(room, p) {
  const cs = room.mode === 'cs';
  p.hp = MAX_HP; p.armor = cs ? 30 : (p.char === 1 ? 30 : 0);
  p.slots = ['pistol', null, null]; p.cur = 0; p.medkits = cs ? 2 : 1; p.walls = 2; p.healing = 0;
  if (p.bot || cs) {
    const pool = cs ? ['smg', 'ar', 'shotgun', 'ar'] : ['smg', 'ar', 'shotgun', 'ar', 'smg', 'sniper', null];
    const g = pool[Math.floor(Math.random() * pool.length)];
    if (g) { p.slots[1] = g; p.cur = 1; }
  }
}
function startMatch(room) {
  [...room.players.values()].forEach(p => { if (p.bot) room.players.delete(p.id); });
  room.mode = room.cfg.mode; room.zp = room.mode === 'cs' ? ZONE_CS : ZONE_PHASES;
  room.score = [0, 0]; room.round = 0; room.tn = 0; room.humansDeadAt = 0;
  const hs = humansOf(room);
  if (room.mode === 'cs') {
    hs.forEach((p, i) => { p.team = i % 2; });
    if (room.cfg.bots) for (let t = 0; t < 2; t++) { let n = hs.filter(p => p.team === t).length; while (n++ < 4) addBot(room, t); }
  } else {
    hs.forEach(p => { p.team = -1; });
    if (room.cfg.bots) for (let i = 0; i < room.cfg.botN; i++) addBot(room, -1);
  }
  room.state = 'playing';
  bcast(room, lobbyInfo(room));
  beginRound(room);
}
function beginRound(room) {
  clearTimeout(room.nextT);
  const cs = room.mode === 'cs';
  room.round++; room.state = 'playing'; room.t0 = Date.now(); room.humansDeadAt = 0;
  room.walls = []; room.wallSeq = 0;
  room.loot = GMap.lootSpots.map(l => ({ id: l.id, kind: l.kind, x: l.x, z: l.z, taken: false }));
  const spread = cs ? 25 : 60;
  const cx = (Math.random() - 0.5) * spread, cz = (Math.random() - 0.5) * spread;
  const R0 = cs ? 110 : 200;
  room.zone = { cx, cz, r: R0, fromR: R0, toR: R0, phase: -1, phaseStart: Date.now(), shrinking: false, dps: 0, nextCx: cx, nextCz: cz, fromCx: cx, fromCz: cz };
  advanceZone(room);
  const spawns = {};
  const idxInTeam = [0, 0];
  let k = 0; const n = room.players.size;
  room.players.forEach(p => {
    if (cs) {
      const i = idxInTeam[p.team]++;
      const r = GMap.collide((i - 1.5) * 7, p.team ? 58 : -58, 0, 0.5);
      p.x = r.x; p.z = r.z; p.y = 0; p.air = false;
    } else {
      const ang = (k++ / n) * Math.PI * 2 + Math.random() * 0.5;
      p.x = Math.cos(ang) * 70; p.z = Math.sin(ang) * 80; p.y = 120; p.air = true;
    }
    giveLoadout(room, p);
    p.alive = true; p.kills = 0; p.dmg = 0; p.st = 0;
    if (p.bot) { p.ai.tgt = 0; p.ai.land = null; p.ai.loot = -1; }
    spawns[p.id] = { x: p.x, y: p.y, z: p.z };
  });
  room.initial = room.players.size;
  const teams = {}; room.players.forEach(p => { if (p.team >= 0) teams[p.id] = p.team; });
  bcast(room, { t: 'start', mode: room.mode, round: room.round, score: room.score, teams, spawns, loot: room.loot.map(l => ({ id: l.id, kind: l.kind, x: l.x, z: l.z })), zone: zoneMsg(room), alive: room.players.size });
  room.players.forEach(sendInv);
  clearInterval(room.timer);
  room.timer = setInterval(() => tick(room), TICK * 1000);
}

function advanceZone(room) {
  const z = room.zone;
  const ph = z.phase + 1;
  if (ph >= room.zp.length) return;
  z.phase = ph; z.phaseStart = Date.now(); z.shrinking = false;
  z.fromR = z.r; z.fromCx = z.cx; z.fromCz = z.cz;
  z.toR = room.zp[ph][2];
  const maxOff = Math.max(0, z.fromR - z.toR) * 0.6;
  const a = Math.random() * Math.PI * 2, d = Math.random() * maxOff;
  z.nextCx = Math.max(-80, Math.min(80, z.fromCx + Math.cos(a) * d));
  z.nextCz = Math.max(-100, Math.min(100, z.fromCz + Math.sin(a) * d));
  z.dps = room.zp[ph][3];
}
function zoneMsg(room) {
  const z = room.zone;
  return { cx: z.cx, cz: z.cz, r: z.r, toCx: z.nextCx, toCz: z.nextCz, toR: z.toR, phase: z.phase, shrinking: z.shrinking, phaseStart: z.phaseStart, wait: room.zp[Math.max(0, z.phase)][0], shrink: room.zp[Math.max(0, z.phase)][1] };
}

function aliveList(room) { return [...room.players.values()].filter(p => p.alive); }

function stopHeal(p) { if (p.healing) { p.healing = 0; sendTo(p, { t: 'healstop' }); } }

// returns the damage actually dealt (for the attacker's stats)
function damage(room, victim, dmg, killer, weapon) {
  if (!victim.alive) return 0;
  const dealt = Math.min(dmg, victim.hp + victim.armor);
  stopHeal(victim);
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, dmg * 0.6);
    victim.armor -= absorbed; dmg -= absorbed;
  }
  victim.hp -= dmg;
  if (victim.hp <= 0) {
    victim.hp = 0; victim.alive = false;
    if (killer && killer !== victim) killer.kills++;
    victim.slots.forEach(w => { if (w) addDrop(room, w, victim.x, victim.z); });
    if (victim.medkits > 0) addDrop(room, 'medkit', victim.x, victim.z);
    bcast(room, { t: 'kill', killer: killer ? killer.id : 0, victim: victim.id, weapon, left: aliveList(room).length });
    checkEnd(room);
  }
  return dealt;
}

function endStats(room) {
  return [...room.players.values()].map(p => ({ id: p.id, name: p.name, kills: p.kills, dmg: Math.round(p.dmg), team: p.team, bot: p.bot ? 1 : 0 }));
}
function checkEnd(room) {
  if (room.state !== 'playing') return;
  if (room.mode === 'cs') {
    const a = [0, 0]; room.players.forEach(p => { if (p.alive && p.team >= 0) a[p.team]++; });
    if (a[0] > 0 && a[1] > 0) return;
    clearInterval(room.timer);
    const win = a[0] > 0 ? 0 : a[1] > 0 ? 1 : -1;
    if (win >= 0) room.score[win]++;
    if (room.score[0] >= 3 || room.score[1] >= 3) {
      room.state = 'ended';
      bcast(room, { t: 'end', mode: 'cs', winTeam: win, score: room.score, winner: 0, stats: endStats(room) });
    } else {
      room.state = 'roundend';
      bcast(room, { t: 'round', win, score: room.score, round: room.round });
      room.nextT = setTimeout(() => { if (rooms.get(room.code) === room && room.state === 'roundend' && humansOf(room).length) beginRound(room); }, 4200);
    }
    return;
  }
  const alive = aliveList(room);
  if ((room.initial >= 2 && alive.length <= 1) || alive.length === 0) {
    room.state = 'ended';
    clearInterval(room.timer);
    const w = alive[0] || null;
    bcast(room, { t: 'end', mode: 'br', winner: w ? w.id : 0, stats: endStats(room) });
  }
}

function tick(room) {
  const now = Date.now(), z = room.zone;
  const ph = Math.max(0, z.phase);
  const waited = (now - z.phaseStart) / 1000;
  if (!z.shrinking && waited >= room.zp[ph][0]) { z.shrinking = true; z.phaseStart = now; }
  if (z.shrinking) {
    const f = Math.min(1, (now - z.phaseStart) / 1000 / room.zp[ph][1]);
    z.r = z.fromR + (z.toR - z.fromR) * f;
    z.cx = z.fromCx + (z.nextCx - z.fromCx) * f;
    z.cz = z.fromCz + (z.nextCz - z.fromCz) * f;
    if (f >= 1) advanceZone(room);
  }
  room.tn = (room.tn || 0) + 1;
  room.players.forEach(p => { if (p.bot && p.alive) botThink(room, p, TICK, now); });
  if (room.mode === 'br' && room.cfg.bots) {   // everyone real is out: don't make them wait for 25 bots to finish
    const hs = humansOf(room);
    if (hs.length && !hs.some(h => h.alive)) {
      if (!room.humansDeadAt) room.humansDeadAt = now;
      else if (now - room.humansDeadAt > 7000) {
        const al = aliveList(room).sort((a, b2) => b2.kills - a.kills); room.state = 'ended'; clearInterval(room.timer);
        bcast(room, { t: 'end', mode: 'br', winner: al[0] ? al[0].id : 0, stats: endStats(room) }); return;
      }
    }
  }
  room.players.forEach(p => {
    if (!p.alive) return;
    if (!p.air && Math.hypot(p.x - z.cx, p.z - z.cz) > z.r) damage(room, p, z.dps * TICK, null, 'zone');
    if (p.alive && p.healing && now >= p.healing) {
      p.healing = 0; p.medkits = Math.max(0, p.medkits - 1); p.hp = Math.min(MAX_HP, p.hp + 100);
      sendTo(p, { t: 'healdone' }); sendInv(p);
    }
  });
  for (let i = room.walls.length - 1; i >= 0; i--) {
    const w = room.walls[i];
    if (now > w.until || w.hp <= 0) { room.walls.splice(i, 1); bcast(room, { t: 'wallgone', id: w.id }); }
  }
  bcast(room, {
    t: 'snap', zone: zoneMsg(room),
    players: [...room.players.values()].map(p => ({
      id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), ry: +p.ry.toFixed(2), p: +(p.pitch || 0).toFixed(2),
      hp: Math.round(p.hp), ar: Math.round(p.armor), w: weaponOf(p), a: p.anim, s: p.st | 0, air: p.air ? 1 : 0, alive: p.alive ? 1 : 0, k: p.kills, d: Math.round(p.dmg)
    }))
  });
}

function tryPickup(room, p, id, swap) {
  const l = room.loot[id];
  if (!l || l.taken) return false;
  if (Math.hypot(l.x - p.x, l.z - p.z) > 3.5) return false;
  if (isGun(l.kind)) {
    if (p.slots.includes(l.kind)) return false;
    let si = p.slots.indexOf(null);
    if (si === -1) {
      if (!swap) return false;
      si = p.cur >= 0 ? p.cur : 0;
      addDrop(room, p.slots[si], p.x, p.z);
    }
    p.slots[si] = l.kind; p.cur = si;
  } else if (l.kind === 'medkit') { if (p.medkits >= 5) return false; p.medkits++; }
  else if (l.kind === 'wall') { if (p.walls >= 5) return false; p.walls++; }
  else if (l.kind === 'vest') { if (p.armor >= 100) return false; p.armor = Math.min(100, p.armor + 60); }
  else return false;
  l.taken = true;
  bcast(room, { t: 'loot', id: l.id, by: p.id, kind: l.kind });
  sendInv(p);
  return true;
}

// ---------------- bots ----------------
const BOT_WALK = 5.0;
function botPerceive(room, b, now) {
  const ai = b.ai, eyeY = b.y + 1.5;
  let best = null, bd = 62;
  room.players.forEach(q => {
    if (q === b || !q.alive || q.air) return;
    if (room.mode === 'cs' && q.team === b.team) return;
    const d = Math.hypot(q.x - b.x, q.z - b.z); if (d >= bd) return;
    const dy = q.y + 1.2 - eyeY, L = Math.hypot(d, dy) || 1;
    const rc = GMap.rayCast(b.x, eyeY, b.z, (q.x - b.x) / L, dy / L, (q.z - b.z) / L, L, room.walls);
    if (rc.t >= L - 0.8) { best = q; bd = d; }
  });
  if (best) {
    if (ai.tgt !== best.id) { ai.tgt = best.id; ai.react = now + 380 + Math.random() * 520; }
    ai.lastSeen = now; ai.td = bd;
  } else if (ai.tgt && now - ai.lastSeen > 2600) ai.tgt = 0;
  // choose a gun that suits the distance
  const td = ai.tgt ? ai.td : 30, have = b.slots.map((k, i) => ({ k, i })).filter(e => e.k);
  if (have.length) {
    const rank = (k) => td < 14 ? { shotgun: 5, smg: 4, ar: 3, pistol: 2, sniper: 1 }[k] : td > 55 ? { sniper: 5, ar: 4, smg: 2, pistol: 2, shotgun: 0 }[k] : { ar: 5, smg: 4, sniper: 3, shotgun: 2, pistol: 1 }[k];
    have.sort((x, y) => rank(y.k) - rank(x.k));
    if (b.cur !== have[0].i) { b.cur = have[0].i; }
  }
  // loot goal (only when calm)
  if (!ai.tgt && (ai.loot < 0 || room.loot[ai.loot] === undefined || room.loot[ai.loot].taken || now > ai.lootAt)) {
    ai.loot = -1; let bl = 38;
    const free = b.slots.includes(null);
    for (let i = 0; i < room.loot.length; i++) {
      const l = room.loot[i]; if (l.taken) continue;
      if (isGun(l.kind) ? (!free || b.slots.includes(l.kind)) : l.kind === 'medkit' ? b.medkits >= 3 : l.kind === 'wall' ? true : b.armor >= 60) continue;
      const d = Math.hypot(l.x - b.x, l.z - b.z); if (d < bl) { bl = d; ai.loot = i; }
    }
    ai.lootAt = now + 9000;
  }
}
function botThink(room, b, dt, now) {
  const ai = b.ai, z = room.zone;
  if (b.air) {   // parachute down to a loot spot
    if (!ai.land) { const L = GMap.lootSpots[Math.floor(Math.random() * GMap.lootSpots.length)]; ai.land = { x: L.x + (Math.random() - 0.5) * 6, z: L.z + (Math.random() - 0.5) * 6 }; }
    const dx = ai.land.x - b.x, dz = ai.land.z - b.z, d = Math.hypot(dx, dz) || 1;
    const stepd = Math.min(d, 15 * dt);
    b.x += dx / d * stepd; b.z += dz / d * stepd; b.y -= 22 * dt; b.ry = Math.atan2(dx, dz); b.anim = 0;
    if (b.y <= 0) { b.y = 0; b.air = false; ai.land = null; const r = GMap.collide(b.x, b.z, 0, 0.4, room.walls); b.x = r.x; b.z = r.z; }
    return;
  }
  if (b.healing) { b.anim = 0; return; }
  if ((room.tn + b.id) % 3 === 0) botPerceive(room, b, now);
  const tgt = ai.tgt ? room.players.get(ai.tgt) : null;
  if (ai.tgt && (!tgt || !tgt.alive)) ai.tgt = 0;
  let mx = 0, mz = 0, speed = BOT_WALK, face = null;
  const seen = tgt && tgt.alive && now - ai.lastSeen < 500;
  if (!tgt && b.hp < 120 && b.medkits > 0) { b.healing = now + HEAL_MS; return; }
  if (tgt && tgt.alive) {
    const dx = tgt.x - b.x, dz = tgt.z - b.z, d = Math.hypot(dx, dz) || 1;
    face = Math.atan2(dx, dz);
    if (now > ai.strafeAt) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeAt = now + 900 + Math.random() * 1600; }
    if (d > 26) { mx = dx / d; mz = dz / d; }
    else if (d < 9) { mx = -dx / d * 0.8 - dz / d * ai.strafe * 0.4; mz = -dz / d * 0.8 + dx / d * ai.strafe * 0.4; }
    else { mx = -dz / d * ai.strafe; mz = dx / d * ai.strafe; speed = 3.4; }
    if (!seen) { mx = dx / d; mz = dz / d; }
    // shoot
    if (seen && now > ai.react && now > ai.nextFire) {
      const wname = weaponOf(b), w = WEAPONS[wname] || WEAPONS.fist;
      if (d < w.range * 0.85 && wname !== 'fist') {
        const ex = b.x, ey = b.y + 1.5, ez = b.z;
        const ty = tgt.y + ([1.2, 0.8, 0.35][tgt.st | 0]) + (Math.random() < 0.16 ? 0.45 : 0);
        let ddx = tgt.x - ex, ddy = ty - ey, ddz = tgt.z - ez;
        const L = Math.hypot(ddx, ddy, ddz) || 1, noise = (0.022 + d * 0.0011) * ai.acc;
        ddx = ddx / L + (Math.random() - 0.5) * noise * 2; ddy = ddy / L + (Math.random() - 0.5) * noise * 2; ddz = ddz / L + (Math.random() - 0.5) * noise * 2;
        shoot(room, b, { ox: ex, oy: ey, oz: ez, dx: ddx, dy: ddy, dz: ddz });
        b.pitch = Math.asin(Math.max(-1, Math.min(1, ddy / (Math.hypot(ddx, ddy, ddz) || 1))));
        ai.nextFire = now + w.rate * 1000 * (1.5 + Math.random() * 0.9);
      }
    }
  } else {
    let gx = null, gz = null;
    const out = Math.hypot(b.x - z.cx, b.z - z.cz) > z.r * 0.82 || (z.shrinking && Math.hypot(b.x - z.nextCx, b.z - z.nextCz) > z.toR * 0.9);
    if (out) { gx = z.shrinking ? z.nextCx : z.cx; gz = z.shrinking ? z.nextCz : z.cz; speed = 6.2; }
    else if (ai.loot >= 0 && room.loot[ai.loot] && !room.loot[ai.loot].taken) {
      const l = room.loot[ai.loot]; gx = l.x; gz = l.z;
      if (Math.hypot(l.x - b.x, l.z - b.z) < 2.4) { tryPickup(room, b, ai.loot, false); ai.loot = -1; }
    } else {
      if (!ai.wp || now > ai.wpAt || Math.hypot(ai.wp.x - b.x, ai.wp.z - b.z) < 4) {
        const a = Math.random() * 6.283, rr = Math.random() * Math.max(10, z.r * 0.6);
        ai.wp = { x: z.cx + Math.cos(a) * rr, z: z.cz + Math.sin(a) * rr }; ai.wpAt = now + 9000 + Math.random() * 6000;
      }
      gx = ai.wp.x; gz = ai.wp.z;
    }
    if (gx !== null) { const dx = gx - b.x, dz = gz - b.z, d = Math.hypot(dx, dz) || 1; mx = dx / d; mz = dz / d; face = Math.atan2(dx, dz); }
  }
  if (now < ai.avoid) { mx = Math.sin(ai.avoidDir); mz = Math.cos(ai.avoidDir); }
  const ml = Math.hypot(mx, mz);
  if (ml > 0.01) {
    mx /= ml; mz /= ml;
    const nx = b.x + mx * speed * dt, nz = b.z + mz * speed * dt;
    const r = GMap.collide(nx, nz, b.y, 0.4, room.walls);
    const moved = Math.hypot(r.x - b.x, r.z - b.z);
    if (moved < speed * dt * 0.35) { if (++ai.stuck > 8) { ai.stuck = 0; ai.avoid = now + 900 + Math.random() * 700; ai.avoidDir = Math.random() * 6.283; ai.wp = null; ai.loot = -1; } } else ai.stuck = 0;
    b.x = r.x; b.z = r.z; b.anim = speed > 6 ? 2 : 1;
    if (face === null) face = Math.atan2(mx, mz);
  } else b.anim = 0;
  if (face !== null) b.ry = face;
  if (!tgt) b.pitch = 0;
}

function shoot(room, p, m) {
  const wname = weaponOf(p), w = WEAPONS[wname] || WEAPONS.fist;
  const now = Date.now();
  if (now - p.lastShot < w.rate * 1000 * 0.75) return;
  p.lastShot = now;
  stopHeal(p);
  let ox = +m.ox, oy = +m.oy, oz = +m.oz, dx = +m.dx, dy = +m.dy, dz = +m.dz;
  if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite)) return;
  const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
  if (Math.hypot(ox - p.x, oz - p.z) > 12 || Math.abs(oy - (p.y + 1.5)) > 8) { ox = p.x; oy = p.y + 1.5; oz = p.z; }
  const muzzle = { x: p.x, y: p.y + 1.4, z: p.z };
  for (let n = 0; n < w.pellets; n++) {
    let ddx = dx, ddy = dy, ddz = dz;
    if (w.spread) {
      ddx += (Math.random() - 0.5) * 2 * w.spread; ddy += (Math.random() - 0.5) * 2 * w.spread; ddz += (Math.random() - 0.5) * 2 * w.spread;
      const l = Math.hypot(ddx, ddy, ddz); ddx /= l; ddy /= l; ddz /= l;
    }
    const rc = GMap.rayCast(ox, oy, oz, ddx, ddy, ddz, w.range, room.walls);
    let tBest = rc.t;
    let victim = null, head = false;
    room.players.forEach(q => {
      if (q === p || !q.alive || q.air) return;
      if (room.mode === 'cs' && q.team === p.team) return;
      const rx = q.x - ox, rz = q.z - oz;
      const a = ddx * ddx + ddz * ddz;
      if (a < 1e-9) return;
      const tc = (rx * ddx + rz * ddz) / a;
      if (tc < 0 || tc > tBest) return;
      const cxp = ox + ddx * tc - q.x, czp = oz + ddz * tc - q.z;
      if (cxp * cxp + czp * czp > 0.5 * 0.5) return;
      const yy = oy + ddy * tc;
      const H = [1.85, 1.2, 0.55][q.st | 0];
      if (yy < q.y || yy > q.y + H) return;
      tBest = tc; victim = q; head = yy > q.y + H - 0.4;
    });
    if (!victim && rc.box && rc.box.isWall) rc.box.hp -= w.dmg;   // bullets chew through player walls
    const hit = { x: ox + ddx * tBest, y: oy + ddy * tBest, z: oz + ddz * tBest };
    bcast(room, { t: 'shot', id: p.id, from: muzzle, to: hit, hit: victim ? 1 : 0 });
    if (victim) {
      const dmg = w.dmg * (head ? 1.8 : 1) * (p.char === 2 && head ? 1.12 : 1);   // Jasim skill: deadlier headshots
      const dealt = damage(room, victim, dmg, p, wname);
      p.dmg += dealt;
      sendTo(p, { t: 'hitmark', head: head ? 1 : 0, kill: victim.alive ? 0 : 1, dmg: Math.round(dealt), total: Math.round(p.dmg) });
      sendTo(victim, { t: 'hurt', from: p.id, dmg: Math.round(dmg) });
    }
  }
}

function leave(ws) {
  const p = ws.player; if (!p) return;
  const room = p.room;
  room.players.delete(p.id);
  ws.player = null;
  if (humansOf(room).length === 0) { clearInterval(room.timer); clearTimeout(room.nextT); rooms.delete(room.code); return; }
  if (room.host === p.id) room.host = humansOf(room)[0].id;
  if (room.state === 'playing') {
    bcast(room, { t: 'kill', killer: 0, victim: p.id, weapon: 'left', left: aliveList(room).length });
    checkEnd(room);
  }
  bcast(room, lobbyInfo(room));
}

// ---------------- websocket ----------------
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const p = ws.player;
    const playing = p && p.room.state === 'playing';
    switch (m.t) {
      case 'create': {
        if (p) leave(ws);
        const room = newRoom(m.cfg);
        const np = addPlayer(room, ws, m.name, m.char); np.cos = cleanCos(m.cos);
        sendTo(np, { t: 'joined', id: np.id });
        if (m.solo) { room.solo = true; room.cfg.pub = false; room.cfg.bots = true; if (room.cfg.mode === 'br') room.cfg.botN = 25; startMatch(room); }
        else bcast(room, lobbyInfo(room));
        break;
      }
      case 'list': {
        const out = [];
        rooms.forEach(r => { if (r.cfg.pub) out.push({ code: r.code, name: r.cfg.name || ('Room ' + r.code), mode: r.cfg.mode, n: humansOf(r).length, max: 12, lock: r.cfg.pass ? 1 : 0, bots: r.cfg.bots ? 1 : 0, playing: r.state === 'lobby' ? 0 : 1 }); });
        ws.send(JSON.stringify({ t: 'rooms', rooms: out }));
        break;
      }
      case 'join': {
        if (p) leave(ws);
        const room = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room) return ws.send(JSON.stringify({ t: 'err', msg: 'Room code galat hai.' }));
        if (room.state !== 'lobby') return ws.send(JSON.stringify({ t: 'err', msg: 'Match shuru ho chuka hai.' }));
        if (room.cfg.pass && room.cfg.pass !== String(m.pass || '')) return ws.send(JSON.stringify({ t: 'err', msg: 'Is room ka password chahiye.', needPass: 1, code: room.code }));
        if (humansOf(room).length >= 12) return ws.send(JSON.stringify({ t: 'err', msg: 'Room full hai.' }));
        const np = addPlayer(room, ws, m.name, m.char); np.cos = cleanCos(m.cos);
        sendTo(np, { t: 'joined', id: np.id });
        bcast(room, lobbyInfo(room));
        break;
      }
      case 'cfg': {        // host changes room settings in the lobby
        if (!p || p.room.state !== 'lobby' || p.room.host !== p.id) return;
        const old = p.room.cfg, c = cleanCfg(Object.assign({}, old, m.cfg || {}));
        c.pub = old.pub; p.room.cfg = c;
        bcast(p.room, lobbyInfo(p.room));
        break;
      }
      case 'prof': {          // change name / character / outfit while waiting in the room
        if (!p || p.room.state === 'playing') return;
        if (typeof m.name === 'string' && m.name.trim()) p.name = m.name.trim().slice(0, 14);
        p.char = Math.max(0, Math.min(2, m.char | 0)); p.cos = cleanCos(m.cos);
        bcast(p.room, lobbyInfo(p.room));
        break;
      }
      case 'start': {
        if (!p) return;
        const room = p.room;
        if (room.host !== p.id || room.state !== 'lobby') return;
        if (room.cfg.mode === 'cs' && !room.cfg.bots && humansOf(room).length < 2) return sendTo(p, { t: 'err', msg: 'CS ke liye kam se kam 2 player chahiye ya bots on karo.' });
        startMatch(room);
        break;
      }
      case 'again': {
        if (!p) return;
        const room = p.room;
        if (room.host !== p.id || room.state !== 'ended') return;
        if (room.solo) { startMatch(room); return; }
        room.state = 'lobby';
        [...room.players.values()].forEach(q => { if (q.bot) room.players.delete(q.id); });
        bcast(room, lobbyInfo(room));
        break;
      }
      case 'state': {
        if (!playing || !p.alive) return;
        if (![m.x, m.y, m.z, m.ry].every(Number.isFinite)) return;
        p.x = Math.max(-GMap.BX, Math.min(GMap.BX, m.x)); p.y = m.y; p.z = Math.max(-GMap.BZ, Math.min(GMap.BZ, m.z));
        p.ry = m.ry; p.pitch = Number.isFinite(m.p) ? m.p : 0; p.anim = m.a | 0; p.air = !!m.air; p.st = Math.max(0, Math.min(2, m.st | 0));
        break;
      }
      case 'shoot': {
        if (!playing || !p.alive || p.air) return;
        shoot(p.room, p, m);
        break;
      }
      case 'switch': {
        if (!playing || !p.alive) return;
        const s = m.slot | 0;
        if (s === -1) p.cur = -1; else if (s >= 0 && s < 3 && p.slots[s]) p.cur = s; else return;
        stopHeal(p); sendInv(p);
        break;
      }
      case 'pickup': {
        if (!playing || !p.alive || p.air) return;
        tryPickup(p.room, p, m.id | 0, !!m.swap);
        break;
      }
      case 'heal': {
        if (!playing || !p.alive || p.air || p.healing) return;
        if (p.medkits <= 0 || p.hp >= MAX_HP) return;
        p.healing = Date.now() + HEAL_MS;
        sendTo(p, { t: 'healstart', ms: HEAL_MS });
        break;
      }
      case 'wall': {
        if (!playing || !p.alive || p.air) return;
        const room = p.room, now = Date.now(), yaw = +m.yaw;
        if (!Number.isFinite(yaw) || p.walls <= 0 || now - p.lastWall < 1200 || room.walls.length >= 40) return;
        p.lastWall = now; p.walls--;
        const w = {
          id: ++room.wallSeq, kind: 'gloo', isWall: true,
          x: Math.max(-GMap.BX, Math.min(GMap.BX, p.x + Math.sin(yaw) * 2.4)), z: Math.max(-GMap.BZ, Math.min(GMap.BZ, p.z + Math.cos(yaw) * 2.4)),
          hw: 1.8, hd: 0.22, rot: -yaw, y0: 0, h: 2.4, hp: WALL_HP, until: now + WALL_LIFE_MS
        };
        room.walls.push(w);
        bcast(room, { t: 'wall', w: { id: w.id, x: w.x, z: w.z, hw: w.hw, hd: w.hd, rot: w.rot, y0: 0, h: w.h } });
        sendInv(p);
        break;
      }
      case 'emote': {
        if (!playing || !p.alive || p.air) return;
        bcast(p.room, { t: 'emote', id: p.id, e: Math.max(0, Math.min(11, m.e | 0)) });
        break;
      }
      case 'leave': leave(ws); break;
    }
  });
  ws.on('close', () => leave(ws));
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 20000);

server.listen(PORT, () => {
  console.log('\n  GHARABUSTAN server chal gaya  (port ' + PORT + ')\n');
  console.log('  Apne PC par:        http://localhost:' + PORT);
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(n => nets[n].forEach(a => {
    if (a.family === 'IPv4' && !a.internal) console.log('  Same WiFi walay dost: http://' + a.address + ':' + PORT);
  }));
  console.log('\n  Door walay doston ke liye README.txt dekho (tunnel ya hosting).\n');
});
