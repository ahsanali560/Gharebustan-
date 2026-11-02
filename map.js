// Gharabustan map: shared by server (hit checks) and browser (drawing + collision).
// Layout follows the satellite screenshot of Ahsan's area (approximate, hand-built).
// Houses are hollow: four walls with a doorway, a floor, and a ceiling/roof slab.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GMap = factory();
})(this, function () {
  const BX = 128, BZ = 158;             // playable half sizes
  const EX = 132, EZ = 162;             // ground half sizes
  const TH = Math.atan2(0.47, 0.88);    // street grid rotation (~28 deg)
  const A = { x: Math.cos(TH), z: Math.sin(TH) };    // along Khatm-e-Nabuwat Rd
  const B = { x: -Math.sin(TH), z: Math.cos(TH) };   // along Qamar Rd
  const SHERPAO_Z = 66.6;
  const WALL_T = 0.35, DOOR_W = 1.6, DOOR_H = 2.4, CEIL = 3.2;

  function pxw(px, py) {
    const z = py <= 1035 ? (py - 850) * 0.36 : SHERPAO_Z + (py - 1035) * 0.26;
    return { x: (px - 360) * 0.36, z: z };
  }
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rnd = mulberry(20211027);
  const boxes = [];    // solid volumes {x,z,hw,hd,rot,y0,h,kind,color}
  const houses = [];   // house descriptions for drawing {x,z,hw,hd,rot,h,color,door,kind}
  function addBox(o) { o.rot = o.rot || 0; o.y0 = o.y0 || 0; boxes.push(o); return o; }

  // ---- regions (world coordinates)
  const chowk = pxw(280, 440);
  const park = { x0: pxw(375, 0).x, x1: pxw(520, 0).x, z0: pxw(0, 790).z, z1: pxw(0, 900).z };
  const openGround = { x0: park.x0 - 2, x1: park.x1, z0: park.z1, z1: pxw(0, 1010).z };
  const star = { cx: pxw(560, 1230).x, cz: pxw(560, 1230).z, hw: 22, hd: 13 };
  const cemetery = { cx: pxw(195, 1300).x, cz: pxw(195, 1300).z, r: 20 };
  const home = pxw(345, 877);

  const grid = {
    u1: pxw(385, 500).x * A.x + pxw(385, 500).z * A.z,
    v0: chowk.x * B.x + chowk.z * B.z,
    pu: 17, pv: 21, lane: 7
  };
  function gridToWorld(u, v) { return { x: u * A.x + v * B.x, z: u * A.z + v * B.z }; }

  const houseColors = [0xd9c7a3, 0xcfb8a0, 0xe3d3b8, 0xb9a58c, 0xd6b8a8, 0xc4c9b0, 0xe0c9c0, 0xbfae98, 0xa9b9c4, 0xd8d0c0];
  function inRect(p, r, m) { return p.x > r.x0 - m && p.x < r.x1 + m && p.z > r.z0 - m && p.z < r.z1 + m; }

  // ---- hollow house: collision boxes in the house's own frame
  function hbox(hs, lx, lz, hw, hd, y0, h, kind, color) {
    const c = Math.cos(hs.rot), s = Math.sin(hs.rot);
    return addBox({ x: hs.x + lx * c - lz * s, z: hs.z + lx * s + lz * c, hw: hw, hd: hd, rot: hs.rot, y0: y0, h: h, kind: kind || 'hw', color: color || 0 });
  }
  // door index: 0 = +z side, 1 = -z side, 2 = +x side, 3 = -x side (house local frame)
  function buildHouseBoxes(hs) {
    const hw = hs.hw, hd = hs.hd, h = hs.h, T = WALL_T;
    [1, -1].forEach(function (sg, idx) {
      const lz = sg * (hd - T / 2);
      if (hs.door === idx) {
        const seg = (hw - DOOR_W / 2) / 2;
        hbox(hs, -(DOOR_W / 2 + seg), lz, seg, T / 2, 0, h); hbox(hs, DOOR_W / 2 + seg, lz, seg, T / 2, 0, h);
        hbox(hs, 0, lz, DOOR_W / 2, T / 2, DOOR_H, h - DOOR_H);
      } else hbox(hs, 0, lz, hw, T / 2, 0, h);
    });
    const L = hd - T;
    [1, -1].forEach(function (sg, idx) {
      const lx = sg * (hw - T / 2);
      if (hs.door === 2 + idx) {
        const half = (L - DOOR_W / 2) / 2;
        hbox(hs, lx, -(DOOR_W / 2 + half), T / 2, half, 0, h); hbox(hs, lx, DOOR_W / 2 + half, T / 2, half, 0, h);
        hbox(hs, lx, 0, T / 2, DOOR_W / 2, DOOR_H, h - DOOR_H);
      } else hbox(hs, lx, 0, T / 2, L, 0, h);
    });
    hbox(hs, 0, 0, hw, hd, CEIL, h - CEIL);   // ceiling + roof slab (above head height)
  }

  // ---- houses on the rotated grid
  const homeCell = { d: 1e9, hs: null };
  for (let i = -22; i <= 22; i++) {
    for (let j = -22; j <= 22; j++) {
      const u = grid.u1 + (i + 0.5) * grid.pu;
      const v = grid.v0 + (j + 0.5) * grid.pv;
      const c = gridToWorld(u, v);
      if (Math.abs(c.x) > BX - 8 || Math.abs(c.z) > BZ - 8) continue;
      if (c.z > SHERPAO_Z - 12) continue;
      if (inRect(c, park, 9) || inRect(c, openGround, 9)) continue;
      if (Math.hypot(c.x - chowk.x, c.z - chowk.z) < 16) continue;
      const dHome = Math.hypot(c.x - home.x, c.z - home.z);
      const isHomeCell = dHome < homeCell.d;
      if (isHomeCell) homeCell.d = dHome;
      if (!isHomeCell && rnd() < 0.09) continue;  // empty plots
      const hw = (grid.pu - grid.lane) / 2 - rnd() * 1.2;
      const hd = (grid.pv - grid.lane) / 2 - rnd() * 1.6;
      const floors = 1 + Math.floor(rnd() * 3);
      const hs = {
        x: c.x, z: c.z, hw: hw, hd: hd, rot: TH, h: 3.4 * floors + 0.4, kind: 'house',
        color: houseColors[Math.floor(rnd() * houseColors.length)], door: Math.floor(rnd() * 4)
      };
      houses.push(hs);
      buildHouseBoxes(hs);
      if (isHomeCell) homeCell.hs = hs;
      // furniture on the side opposite the door (acts as cover)
      if (houses.length % 2 === 0) {
        const away = hs.door < 2 ? { x: 0, z: hs.door === 0 ? -1 : 1 } : { x: hs.door === 2 ? -1 : 1, z: 0 };
        const px = away.x * (hw - 1.6) + (away.x === 0 ? (rnd() - 0.5) * (hw - 1.4) : 0);
        const pz = away.z * (hd - 1.6) + (away.z === 0 ? (rnd() - 0.5) * (hd - 1.4) : 0);
        hbox(hs, px, pz, 0.6 + rnd() * 0.5, 0.5 + rnd() * 0.5, 0, 0.6 + rnd() * 0.5, 'prop', [0x7a5a3a, 0x5b6b8a, 0x8a5b5b][houses.length % 3]);
      }
    }
  }
  if (homeCell.hs) { homeCell.hs.color = 0x2f6fe0; homeCell.hs.kind = 'home'; }
  const homeBox = homeCell.hs;

  // ---- crates / cover outside
  function crate(x, z, rot) {
    return addBox({ x: x, z: z, hw: 1.0, hd: 1.0, rot: rot || 0, h: 1.1, kind: 'crate', color: 0x9a6b3c });
  }
  const crateSpots = [];
  function scatter(rect, n) {
    for (let k = 0; k < n; k++) {
      crateSpots.push({ x: rect.x0 + rnd() * (rect.x1 - rect.x0), z: rect.z0 + rnd() * (rect.z1 - rect.z0), r: rnd() * 3 });
    }
  }
  scatter(openGround, 14);
  scatter({ x0: park.x0, x1: park.x1, z0: park.z0, z1: park.z1 }, 5);
  scatter({ x0: star.cx - star.hw, x1: star.cx + star.hw, z0: star.cz - star.hd, z1: star.cz + star.hd }, 6);
  crateSpots.forEach(function (c) { crate(c.x, c.z, c.r); });

  // ---- park pavilion + benches
  const pav = pxw(495, 810);
  addBox({ x: pav.x, z: pav.z, hw: 4.5, hd: 3.2, rot: 0, h: 3.6, kind: 'pavilion', color: 0x2e6fb8 });
  [[-8, 6], [8, 6], [0, -9]].forEach(function (o) {
    addBox({ x: (park.x0 + park.x1) / 2 + o[0], z: (park.z0 + park.z1) / 2 + o[1], hw: 1.4, hd: 0.4, h: 0.8, kind: 'bench', color: 0x6b4a2b });
  });

  // ---- chowk monument
  addBox({ x: chowk.x, z: chowk.z, hw: 1.3, hd: 1.3, rot: 0, h: 9, kind: 'monument', color: 0xe8e4d8 });
  addBox({ x: chowk.x, z: chowk.z, hw: 2.4, hd: 2.4, rot: 0, h: 1.0, kind: 'monument', color: 0xb8b2a0 });

  // ---- Star ground complex: grandstand + boundary wall with gaps
  addBox({ x: star.cx, z: star.cz - star.hd - 6, hw: star.hw, hd: 3.5, h: 7, kind: 'stand', color: 0xb23a3a });
  for (let s = -star.hw; s <= star.hw; s += 6) {
    if (Math.abs(s) < 3.5) continue;
    addBox({ x: star.cx + s, z: star.cz + star.hd + 2, hw: 2.6, hd: 0.4, h: 1.6, kind: 'wall', color: 0xcfc6b0 });
  }

  // ---- cemetery graves
  for (let gx = -14; gx <= 14; gx += 4.5) {
    for (let gz = -14; gz <= 14; gz += 5) {
      if (gx * gx + gz * gz > cemetery.r * cemetery.r) continue;
      if (rnd() < 0.25) continue;
      addBox({ x: cemetery.cx + gx + (rnd() - 0.5), z: cemetery.cz + gz + (rnd() - 0.5), hw: 0.7, hd: 1.4, rot: 0.1, h: 0.6, kind: 'grave', color: 0xa8a493 });
    }
  }

  // ---- trees
  const trees = [];
  function tryTree(x, z) {
    if (Math.abs(x) > BX - 3 || Math.abs(z) > BZ - 3) return false;
    for (let k = 0; k < houses.length; k++) {
      const b = houses[k];
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * Math.cos(-b.rot) - dz * Math.sin(-b.rot);
      const lz = dx * Math.sin(-b.rot) + dz * Math.cos(-b.rot);
      if (Math.abs(lx) < b.hw + 1.5 && Math.abs(lz) < b.hd + 1.5) return false;
    }
    trees.push({ x: x, z: z, h: 4 + rnd() * 3 });
    addBox({ x: x, z: z, hw: 0.35, hd: 0.35, h: 3.5, kind: 'trunk', color: 0x5b4130 });
    return true;
  }
  for (let k = 0; k < 14; k++) tryTree(park.x0 + rnd() * (park.x1 - park.x0), park.z0 + rnd() * (park.z1 - park.z0));
  let guard = 0, placed = 0;
  while (placed < 170 && guard++ < 3000) {
    const x = -BX + rnd() * 2 * BX, z = SHERPAO_Z + 8 + rnd() * (BZ - SHERPAO_Z - 8);
    if (Math.abs(x - star.cx) < star.hw + 6 && Math.abs(z - star.cz) < star.hd + 12) continue;
    if (Math.hypot(x - cemetery.cx, z - cemetery.cz) < cemetery.r + 2 && rnd() < 0.85) continue;
    if (tryTree(x, z)) placed++;
  }
  for (let k = 0; k < 25; k++) {
    const x = -BX + 8 + rnd() * (2 * BX - 16), z = -BZ + 8 + rnd() * (SHERPAO_Z - 20 + BZ);
    tryTree(x, z);
  }

  // ---- props that are only drawn (no collision): bushes, rocks, electric poles
  const bushes = [], rocks = [], poles = [];
  for (let k = 0; k < 140; k++) {
    const x = -BX + 4 + rnd() * (2 * BX - 8), z = -BZ + 4 + rnd() * (2 * BZ - 8);
    const inHouse = houses.some(function (b) { return Math.abs(x - b.x) < b.hw + 2 && Math.abs(z - b.z) < b.hd + 2; });
    if (!inHouse && (z > SHERPAO_Z + 4 || (x > park.x0 && x < park.x1 && z > park.z0 && z < park.z1) || rnd() < 0.2)) bushes.push({ x: x, z: z, s: 0.6 + rnd() * 0.8 });
  }
  for (let k = 0; k < 60; k++) {
    const x = openGround.x0 + rnd() * (openGround.x1 - openGround.x0 + 40) - 20, z = openGround.z0 + rnd() * (openGround.z1 - openGround.z0 + 60) - 20;
    if (Math.abs(x) < BX - 3 && Math.abs(z) < BZ - 3 && rnd() < 0.7) rocks.push({ x: x, z: z, s: 0.3 + rnd() * 0.6, r: rnd() * 6 });
  }
  for (let s = -BX + 10; s < BX - 5; s += 34) {   // poles along Sherpao Rd
    poles.push({ x: s, z: SHERPAO_Z - 5.5 });
  }
  for (let k = -3; k <= 3; k++) {                  // poles along Qamar Rd
    const p = gridToWorld(grid.u1 + 4.6, grid.v0 + k * 42);
    if (Math.abs(p.x) < BX - 6 && Math.abs(p.z) < SHERPAO_Z - 8) poles.push({ x: p.x, z: p.z });
  }

  // ---- geometry helpers (shared collision + ray tests); `extra` = dynamic boxes (player walls)
  function toLocal(b, x, z) {
    const dx = x - b.x, dz = z - b.z, c = Math.cos(-b.rot), s = Math.sin(-b.rot);
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }
  // Resolve a circle (px,pz,r) at feet height y. Returns {x,z,ground}.
  function collide(px, pz, y, r, extra) {
    let ground = 0;
    const lists = extra && extra.length ? [boxes, extra] : [boxes];
    for (let it = 0; it < 2; it++) {
      for (let li = 0; li < lists.length; li++) {
        const list = lists[li];
        for (let k = 0; k < list.length; k++) {
          const b = list[k];
          const rr = Math.max(b.hw, b.hd) + r + 0.01;
          if (Math.abs(px - b.x) > rr || Math.abs(pz - b.z) > rr) continue;
          if (y + 1.75 <= b.y0) continue;           // box starts above our head (ceilings, lintels)
          const top = b.y0 + b.h;
          const l = toLocal(b, px, pz);
          const cx = Math.max(-b.hw, Math.min(b.hw, l.x));
          const cz = Math.max(-b.hd, Math.min(b.hd, l.z));
          const dx = l.x - cx, dz = l.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r && !(dx === 0 && dz === 0)) continue;
          if (y >= top - 0.25) { if (top > ground) ground = top; continue; }
          let nx, nz;
          if (dx === 0 && dz === 0) {
            const ox = b.hw - Math.abs(l.x), oz = b.hd - Math.abs(l.z);
            if (ox < oz) { nx = Math.sign(l.x || 1) * (b.hw + r); nz = l.z; }
            else { nx = l.x; nz = Math.sign(l.z || 1) * (b.hd + r); }
          } else {
            const d = Math.sqrt(d2), push = (r - d) / d;
            nx = l.x + dx * push; nz = l.z + dz * push;
          }
          const c = Math.cos(b.rot), s = Math.sin(b.rot);
          px = b.x + nx * c - nz * s;
          pz = b.z + nx * s + nz * c;
        }
      }
    }
    px = Math.max(-BX, Math.min(BX, px));
    pz = Math.max(-BZ, Math.min(BZ, pz));
    return { x: px, z: pz, ground: ground };
  }

  // Nearest ray hit. Returns {t, box}; t = maxT and box = null when nothing is hit.
  function rayCast(ox, oy, oz, dx, dy, dz, maxT, extra) {
    let best = maxT, bestBox = null;
    const lists = extra && extra.length ? [boxes, extra] : [boxes];
    for (let li = 0; li < lists.length; li++) {
      const list = lists[li];
      for (let k = 0; k < list.length; k++) {
        const b = list[k];
        const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
        const rx = ox - b.x, rz = oz - b.z;
        const lox = rx * c - rz * s, loz = rx * s + rz * c;
        const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
        let t0 = 0, t1 = best;
        const mins = [-b.hw, b.y0, -b.hd], maxs = [b.hw, b.y0 + b.h, b.hd];
        const o = [lox, oy, loz], d = [ldx, dy, ldz];
        let ok = true;
        for (let a = 0; a < 3; a++) {
          if (Math.abs(d[a]) < 1e-9) { if (o[a] < mins[a] || o[a] > maxs[a]) { ok = false; break; } }
          else {
            let ta = (mins[a] - o[a]) / d[a], tb = (maxs[a] - o[a]) / d[a];
            if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
            if (ta > t0) t0 = ta;
            if (tb < t1) t1 = tb;
            if (t0 > t1) { ok = false; break; }
          }
        }
        if (ok && t0 < best) { best = t0; bestBox = b; }
      }
    }
    return { t: best, box: bestBox };
  }
  function rayBoxes(ox, oy, oz, dx, dy, dz, maxT, extra) { return rayCast(ox, oy, oz, dx, dy, dz, maxT, extra).t; }

  // ---- loot spots (deterministic; server tracks which are taken)
  const lootSpots = [];
  const kinds = [];
  [['pistol', 8], ['smg', 12], ['ar', 14], ['shotgun', 9], ['sniper', 5], ['medkit', 22], ['vest', 12], ['wall', 18]].forEach(function (e) {
    for (let k = 0; k < e[1]; k++) kinds.push(e[0]);
  });
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t; }
  // inside every third house
  houses.forEach(function (hs, i) {
    if (i % 3 !== 0 || lootSpots.length >= kinds.length) return;
    const res = collide(hs.x, hs.z, 0, 0.6);
    if (Math.abs(res.x - hs.x) > 0.01 || Math.abs(res.z - hs.z) > 0.01) return;
    lootSpots.push({ id: lootSpots.length, x: hs.x, z: hs.z, kind: kinds[lootSpots.length], indoor: true });
  });
  let tries = 0;
  while (lootSpots.length < kinds.length && tries++ < 6000) {
    const r = rnd();
    let x, z;
    if (r < 0.45) {
      const lane = Math.floor(rnd() * 30) - 15;
      const p = gridToWorld(grid.u1 + lane * grid.pu, grid.v0 + (rnd() - 0.5) * 300);
      x = p.x; z = p.z;
    } else if (r < 0.75) {
      x = openGround.x0 + rnd() * (park.x1 - openGround.x0); z = park.z0 + rnd() * (openGround.z1 - park.z0);
    } else if (r < 0.88) {
      x = star.cx + (rnd() - 0.5) * 2 * star.hw; z = star.cz + (rnd() - 0.5) * 2 * star.hd;
    } else {
      x = cemetery.cx + (rnd() - 0.5) * 36; z = cemetery.cz + (rnd() - 0.5) * 36;
    }
    if (Math.abs(x) > BX - 4 || Math.abs(z) > BZ - 4) continue;
    const res = collide(x, z, 0, 0.8);
    if (Math.abs(res.x - x) > 0.01 || Math.abs(res.z - z) > 0.01) continue;
    lootSpots.push({ id: lootSpots.length, x: x, z: z, kind: kinds[lootSpots.length] });
  }

  return {
    BX: BX, BZ: BZ, EX: EX, EZ: EZ, TH: TH, A: A, B: B, SHERPAO_Z: SHERPAO_Z,
    WALL_T: WALL_T, DOOR_W: DOOR_W, DOOR_H: DOOR_H, CEIL: CEIL,
    grid: grid, gridToWorld: gridToWorld, chowk: chowk, park: park, openGround: openGround,
    star: star, cemetery: cemetery, home: home, homeBox: homeBox, houses: houses,
    boxes: boxes, trees: trees, bushes: bushes, rocks: rocks, poles: poles, lootSpots: lootSpots,
    collide: collide, rayBoxes: rayBoxes, rayCast: rayCast
  };
});
