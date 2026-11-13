// Room 1: the six Titanic mini games behind the three clue spots (the crooked tile, the mirror and the scratches).
// ### Each game lasts at most 30 seconds and is drawn on its own (DOM buttons or a 2D canvas), with no image files.
// ### The top of the file holds the pure helpers (dealing the games, the bots, the fleets, the differences), which the Node
// ### tests load with require(). open() below them builds a game inside the card and reports the result through onEnd.
(function (root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniGames = factory();
})(typeof self !== 'undefined' ? self : this, function (){
  'use strict';

  const TIME = 30;
  // ### The six games, in the order rules.js lists them, with the words on the card above each game.
  const INFO = {
    battleship: { title: 'Sink the <em>fleet</em>', name: 'Battleship', how: 'Fire at the enemy waters on the right. A hit lets you fire again. Ships never touch, not even at a corner, so the water around a sunk ship is marked for you. Sink all three of the bot’s ships before it sinks yours.' },
    spotdiff: { title: 'Spot the <em>difference</em>', name: 'Spot the difference', how: 'Two photographs of the Titanic, five differences. Click them in either picture. A wrong click costs 2 seconds.' },
    tictactoe: { title: 'Anchors and <em>icebergs</em>', name: 'Tic-tac-toe', how: 'You play the anchors, the bot plays the icebergs. Get three in a row. A draw starts a new round.' },
    deckrun: { title: 'Run the <em>deck</em>', name: 'Deck run', how: 'Run to the bow as a sailor. Jump over crates, trunks, barrels and ice with Space, ↑ or a click. Three knocks and you are out.' },
    deckclimb: { title: 'Climb the <em>decks</em>', name: 'Deck climb', how: 'Bounce up through the ship as a sailor: from the engine room past the crew quarters, second class and first class to the boat deck. Steer with ← → or the mouse. Lifebuoys bounce you higher. Do not fall.' },
    seagull: { title: 'The <em>seagull</em>', name: 'Seagull', how: 'Fly between the icebergs and the storm clouds. Flap with Space, ↑ or a click. Pass ten gaps.' }
  };
  const GAMES = Object.keys(INFO);

  // ---------- Pure helpers ----------
  // ### Deals three different games out of the six. rand() returns a number from 0 (inclusive) to 1, like Math.random.
  function pickGames(rand){
    const a = GAMES.slice();
    for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, 3);
  }
  // ### Tic-tac-toe: the board is nine cells, '' (free), 'X' (the player's anchor) or 'O' (the bot's iceberg).
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  function tttWinner(b){
    for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x];
    return b.every(c => c) ? 'draw' : null;
  }
  // ### The bot always takes a winning cell, blocks the player three times out of four, likes the centre, else plays at random.
  // ### It can be beaten, so the game fits in 30 seconds.
  function tttBot(b, rand){
    const free = b.map((c, i) => c ? -1 : i).filter(i => i >= 0);
    if (!free.length) return -1;
    const finish = who => free.find(i => { const t = b.slice(); t[i] = who; return tttWinner(t) === who; });
    const win = finish('O');
    if (win !== undefined) return win;
    const block = finish('X');
    if (block !== undefined && rand() < .75) return block;
    if (!b[4] && rand() < .5) return 4;
    return free[Math.floor(rand() * free.length)];
  }
  // ### The cells around a cell on an n x n grid, the diagonals included.
  function around(n, cell){
    const r = Math.floor(cell / n), c = cell % n, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++){
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
    }
    return out;
  }
  // ### Battleship: a fleet of straight ships on an n x n grid. The real rule of the game: ships never touch, not even at a
  // ### corner, so every cell around a ship is water. A ship is a list of cell numbers. If a fleet cannot be finished (very
  // ### unlikely on 6 x 6), it starts again.
  function placeFleet(n, sizes, rand){
    for (let attempt = 0; attempt < 200; attempt++){
      const blocked = new Set(), ships = [];
      for (const size of sizes){
        for (let tries = 0; tries < 200; tries++){
          const across = rand() < .5, r = Math.floor(rand() * (across ? n : n - size + 1)), c = Math.floor(rand() * (across ? n - size + 1 : n));
          const cells = Array.from({ length: size }, (_, k) => across ? r * n + c + k : (r + k) * n + c);
          if (cells.some(x => blocked.has(x))) continue;
          cells.forEach(x => { blocked.add(x); around(n, x).forEach(y => blocked.add(y)); });
          ships.push(cells); break;
        }
      }
      if (ships.length === sizes.length) return ships;
    }
    return [];
  }
  // ### The water around the sunk ships of a fleet: no ship can be there, so the game marks it for the player.
  function waterAround(n, ships, shots){
    const water = new Set();
    for (const s of ships) if (s.every(c => shots.has(c))) s.forEach(c => around(n, c).forEach(x => { if (!s.includes(x)) water.add(x); }));
    return water;
  }
  const sunk = (ship, shots) => ship.every(c => shots.has(c));
  const fleetSunk = (ships, shots) => ships.every(s => sunk(s, shots));
  // ### The bot's shot: half the time it hunts next to a hit of a ship that is still afloat, otherwise it fires at random.
  function bsBot(n, ships, shots, rand){
    const free = [];
    for (let i = 0; i < n * n; i++) if (!shots.has(i)) free.push(i);
    if (!free.length) return -1;
    const hits = [...shots].filter(c => ships.some(s => s.includes(c) && !sunk(s, shots)));
    if (hits.length && rand() < .5){
      const near = [];
      for (const h of hits){
        const r = Math.floor(h / n), c = h % n;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < n && cc >= 0 && cc < n && !shots.has(rr * n + cc)) near.push(rr * n + cc); }
      }
      if (near.length) return near[Math.floor(rand() * near.length)];
    }
    return free[Math.floor(rand() * free.length)];
  }
  // ### Spot the difference: the changes that can be made to the right-hand picture, each with the circle (in the picture's
  // ### own 310 x 290 coordinates) that counts as finding it. Five of them are used in every game.
  const DIFFS = [
    { id: 'moon', x: 262, y: 42, r: 24 }, { id: 'funnel', x: 129, y: 133, r: 18 }, { id: 'smoke', x: 75, y: 104, r: 22 },
    { id: 'iceberg', x: 272, y: 196, r: 28 }, { id: 'gull', x: 196, y: 62, r: 18 }, { id: 'flag', x: 34, y: 108, r: 18 },
    { id: 'buoy', x: 70, y: 252, r: 18 }, { id: 'star', x: 40, y: 30, r: 16 }, { id: 'lamp', x: 199, y: 109, r: 16 }
  ];
  function pickDiffs(rand){
    const a = DIFFS.slice();
    for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, 5);
  }
  // ### Which of the differences (not found yet) a click at x, y hits; -1 for none. A little slack makes it fair on touch.
  function hitDiff(diffs, found, x, y){
    return diffs.findIndex((d, i) => !found[i] && Math.hypot(d.x - x, d.y - y) <= d.r + 6);
  }
  // ### Two rectangles {x, y, w, h} overlap.
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // ---------- Drawing helpers ----------
  // ### The Titanic seen from the side, bow to the right: black hull with a red waterline, white decks, four buff funnels
  // ### with black tops, two masts, lifeboats and portholes. x, y is the stern at the waterline; s scales it (1 = 300 px long).
  function drawTitanic(g, x, y, s, o){
    o = o || {};
    g.save(); g.translate(x, y); g.scale(s, s);
    if (o.silhouette){ g.fillStyle = o.silhouette; g.strokeStyle = o.silhouette; }
    // masts and wires
    g.lineWidth = 1.6; g.strokeStyle = o.silhouette || '#2b2622';
    g.beginPath(); g.moveTo(25, -40); g.lineTo(25, -135); g.moveTo(270, -40); g.lineTo(272, -135); g.stroke();
    g.lineWidth = .7; g.beginPath(); g.moveTo(25, -132); g.lineTo(272, -132); g.moveTo(272, -132); g.lineTo(305, -42); g.moveTo(25, -132); g.lineTo(0, -40); g.stroke();
    // funnels, raked back
    for (let i = 0; i < 4; i++){
      const fx = 82 + i * 40;
      g.fillStyle = o.silhouette || (o.funnelBlack === i ? '#151515' : '#d39a3a');
      g.beginPath(); g.moveTo(fx, -70); g.lineTo(fx - 7, -112); g.lineTo(fx + 11, -112); g.lineTo(fx + 18, -70); g.closePath(); g.fill();
      if (!o.silhouette){ g.fillStyle = '#151515'; g.beginPath(); g.moveTo(fx - 5.5, -104); g.lineTo(fx - 7, -112); g.lineTo(fx + 11, -112); g.lineTo(fx + 12.5, -104); g.closePath(); g.fill(); }
    }
    // superstructure
    g.fillStyle = o.silhouette || '#ece8dc'; g.fillRect(40, -58, 212, 18); g.fillRect(62, -70, 172, 12);
    if (!o.silhouette){
      g.fillStyle = '#9aa0a3'; for (let k = 0; k < 8; k++) g.fillRect(84 + k * 18, -76, 12, 5);   // lifeboats
      g.fillStyle = '#5b6266'; for (let k = 0; k < 26; k++) g.fillRect(46 + k * 8, -52, 4, 4);
    }
    // hull
    g.fillStyle = o.silhouette || '#16181a';
    g.beginPath(); g.moveTo(14, 0); g.lineTo(292, 0); g.lineTo(306, -42); g.lineTo(2, -40); g.quadraticCurveTo(-2, -16, 14, 0); g.fill();
    if (!o.silhouette){
      g.fillStyle = '#8f2a20'; g.beginPath(); g.moveTo(14, 0); g.lineTo(292, 0); g.lineTo(294.6, -8); g.lineTo(8, -8); g.closePath(); g.fill();
      g.fillStyle = '#ece8dc'; g.fillRect(3, -41, 302, 2.5);
      g.fillStyle = o.lights ? '#ffd27a' : '#6d6a60';
      for (let k = 0; k < 34; k++) g.fillRect(18 + k * 8, -28, 2.6, 2.6);
      for (let k = 0; k < 30; k++) g.fillRect(30 + k * 8, -20, 2.6, 2.6);
    }
    g.restore();
  }
  // ### A seagull: two curved wings, flapping with phase f.
  function drawGull(g, x, y, s, f, color){
    const up = Math.sin(f) * 5 * s;
    g.strokeStyle = color || '#f4f1ea'; g.lineWidth = 2.2 * s; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x - 10 * s, y - up); g.quadraticCurveTo(x - 5 * s, y - 6 * s - up * .4, x, y); g.quadraticCurveTo(x + 5 * s, y - 6 * s - up * .4, x + 10 * s, y - up); g.stroke();
  }
  // ### An iceberg: a jagged white lump, darker on its shaded side. Its base sits at y. icebergPoly gives its outline, which
  // ### is also exactly what the seagull can hit, so what you see is what counts.
  function icebergPoly(x, y, w, h){
    return [[x, y], [x + w * .12, y - h * .55], [x + w * .3, y - h * .7], [x + w * .45, y - h], [x + w * .62, y - h * .62], [x + w * .8, y - h * .72], [x + w, y]];
  }
  function drawIceberg(g, x, y, w, h){
    const pts = icebergPoly(x, y, w, h);
    const gr = g.createLinearGradient(x, y - h, x + w, y); gr.addColorStop(0, '#f6fbff'); gr.addColorStop(1, '#cfe3ee');
    g.fillStyle = gr; g.beginPath(); pts.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py)); g.closePath(); g.fill();
    g.fillStyle = 'rgba(110,160,190,.45)';
    g.beginPath(); g.moveTo(x + w * .45, y - h); g.lineTo(x + w * .62, y - h * .62); g.lineTo(x + w * .8, y - h * .72); g.lineTo(x + w, y); g.lineTo(x + w * .5, y); g.closePath(); g.fill();
  }
  // ### Whether the point px, py lies inside the polygon pts (ray casting).
  function inPoly(pts, px, py){
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++){
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // ### A stack of separate, slightly overlapping clouds above a gap whose top edge is at y = bottom. Each cloud is a few
  // ### round puffs ({ dx, dy, r } around the cloud's centre); the lowest cloud ends exactly at bottom, the highest reaches
  // ### past the top of the screen, and neighbouring clouds overlap, so no bird fits between them.
  function cloudStack(bottom, rand){
    const clouds = [];
    let cy = bottom - 18, k = 0;
    while (cy > -24 && k++ < 20){
      const cx = (k % 2 ? -6 : 6) + (rand() - .5) * 8;
      const puffs = [{ dx: 0, dy: 0, r: 18 + rand() * 3 }];
      const n = 3 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++){ const a = i / n * Math.PI * 2 + rand(); puffs.push({ dx: Math.cos(a) * (14 + rand() * 10), dy: Math.sin(a) * 6, r: 11 + rand() * 6 }); }
      // shift the cloud so its lowest puff touches bottom (the first cloud) or overlaps the cloud below it a little
      const low = Math.max(...puffs.map(p => p.dy + p.r));
      if (!clouds.length) cy = bottom - low;
      clouds.push({ dx: cx, dy: cy, puffs });
      cy -= 24 + rand() * 6;
    }
    return clouds;
  }
  // ### Whether a circle (x, y, r) touches any puff of a cloud stack drawn at column x0.
  function hitsClouds(clouds, x0, x, y, r){
    return clouds.some(c => c.puffs.some(p => Math.hypot(x0 + c.dx + p.dx - x, c.dy + p.dy - y) < p.r * .92 + r));
  }
  // ### The night of 14 April 1912 in the North Atlantic: clear, moonless and icy cold. A sky full of stars over a black,
  // ### glassy sea, the faint northern lights that survivors remembered, and ice on the horizon. Painted once per game.
  function paintNight(w, h, horizon, seed){
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas'); cv.width = Math.round(w * dpr * 1.2); cv.height = Math.round(h * dpr * 1.2);
    const g = cv.getContext('2d'); g.scale(cv.width / w, cv.height / h);
    const r = seq(seed);
    const sky = g.createLinearGradient(0, 0, 0, horizon); sky.addColorStop(0, '#02050c'); sky.addColorStop(.55, '#08162a'); sky.addColorStop(1, '#1b3550');
    g.fillStyle = sky; g.fillRect(0, 0, w, horizon);
    // northern lights: soft green curtains
    for (let k = 0; k < 3; k++){
      const y0 = 30 + k * 16 + r() * 10;
      const gr = g.createLinearGradient(0, y0 - 30, 0, y0 + 40); gr.addColorStop(0, 'rgba(80,255,170,0)'); gr.addColorStop(.5, `rgba(80,255,170,${.06 + r() * .05})`); gr.addColorStop(1, 'rgba(80,255,170,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, y0 + 20);
      for (let x = 0; x <= w; x += 40) g.lineTo(x, y0 + Math.sin(x / 70 + k * 2) * 14 - 30);
      for (let x = w; x >= 0; x -= 40) g.lineTo(x, y0 + Math.sin(x / 60 + k) * 10 + 34);
      g.fill();
    }
    // stars, a few of them brighter, and the Milky Way as a faint band
    const band = g.createLinearGradient(0, 0, w, horizon); band.addColorStop(.3, 'rgba(200,215,255,0)'); band.addColorStop(.5, 'rgba(200,215,255,.06)'); band.addColorStop(.7, 'rgba(200,215,255,0)');
    g.fillStyle = band; g.fillRect(0, 0, w, horizon);
    for (let i = 0; i < 260; i++){
      const x = r() * w, y = Math.pow(r(), 1.3) * (horizon - 6), s = r();
      g.fillStyle = `rgba(${220 + s * 35 | 0},${230 + s * 25 | 0},255,${.35 + s * .65})`;
      g.beginPath(); g.arc(x, y, s > .95 ? 1.3 : s > .7 ? .9 : .55, 0, 7); g.fill();
    }
    // the sea: almost black, flat as glass, with starlight on it and a pale line of haze at the horizon
    const sea = g.createLinearGradient(0, horizon, 0, h); sea.addColorStop(0, '#0e2236'); sea.addColorStop(1, '#02070e');
    g.fillStyle = sea; g.fillRect(0, horizon, w, h - horizon);
    const haze = g.createLinearGradient(0, horizon - 14, 0, horizon + 4); haze.addColorStop(0, 'rgba(170,200,225,0)'); haze.addColorStop(1, 'rgba(170,200,225,.18)');
    g.fillStyle = haze; g.fillRect(0, horizon - 14, w, 18);
    for (let i = 0; i < 70; i++){ const y = horizon + 2 + Math.pow(r(), 1.6) * (h - horizon), x = r() * w, l = 4 + r() * 14 * (y - horizon) / (h - horizon + 1); g.fillStyle = `rgba(200,220,240,${.06 + r() * .16})`; g.fillRect(x, y, l, .8); }
    // distant icebergs on the horizon
    for (let k = 0; k < 3; k++){ const bx = 60 + k * w / 3 + r() * 80, bw = 26 + r() * 30; g.globalAlpha = .55; drawIceberg(g, bx, horizon + 1, bw, 8 + r() * 10); g.globalAlpha = 1; }
    return cv;
  }
  // ### A lifebuoy ring: white with four red bands.
  function drawBuoy(g, x, y, r){
    g.lineWidth = r * .45;
    for (let k = 0; k < 8; k++){ g.strokeStyle = k % 2 ? '#f1ece2' : '#c0392b'; g.beginPath(); g.arc(x, y, r, k * Math.PI / 4, (k + 1) * Math.PI / 4); g.stroke(); }
  }
  // ### A fixed pseudo-random sequence, so both spot-the-difference pictures get the very same stars and waves.
  function seq(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- The games ----------
  // ### Each game is a function that gets the shell (api) and returns { update(dt), draw(), key(code, down), point(x, y, type) },
  // ### all optional. It calls api.win() or api.lose(reason) when it is decided; the shell ends it when the 30 s are up.
  const BUILD = {};

  // ### 1. Battleship on two 6 x 6 grids: your liner fleet on the left, the enemy waters on the right.
  BUILD.battleship = api => {
    const N = 6, SIZES = [3, 2, 2];
    const mine = placeFleet(N, SIZES, api.rand), theirs = placeFleet(N, SIZES, api.rand);
    const myShots = new Set(), botShots = new Set();
    let turn = 'me';
    api.stage.innerHTML = `<div class="bs"><div class="bs-side"><div class="eyebrow">Your fleet</div><div class="bs-grid mine"></div></div>
      <div class="bs-side"><div class="eyebrow">Enemy waters · fire here</div><div class="bs-grid theirs"></div></div></div>`;
    const gMine = api.stage.querySelector('.mine'), gTheirs = api.stage.querySelector('.theirs');
    for (let i = 0; i < N * N; i++){
      const a = document.createElement('div'); a.className = 'bs-cell'; gMine.appendChild(a);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'bs-cell'; b.dataset.cell = i;
      b.setAttribute('aria-label', `Fire at row ${Math.floor(i / N) + 1}, column ${i % N + 1}`); gTheirs.appendChild(b);
    }
    const shipAt = (fleet, c) => fleet.find(s => s.includes(c));
    function paint(){
      [...gMine.children].forEach((el, i) => {
        const s = shipAt(mine, i);
        el.className = 'bs-cell' + (s ? ' ship' : '') + (botShots.has(i) ? (s ? ' hit' : ' miss') : '') + (s && sunk(s, botShots) ? ' sunk' : '');
      });
      const water = waterAround(N, theirs, myShots);
      [...gTheirs.children].forEach((el, i) => {
        const s = shipAt(theirs, i), shot = myShots.has(i), free = water.has(i) && !shot;
        el.className = 'bs-cell' + (shot ? (s ? ' hit' : ' miss') : '') + (free ? ' water' : '') + (s && sunk(s, myShots) ? ' ship sunk' : '');
        el.disabled = shot || free || turn !== 'me';
      });
      api.status(turn === 'me' ? 'Your turn: fire at the enemy waters.' : 'The bot is aiming…');
    }
    function botTurn(){
      if (api.over) return;
      const c = bsBot(N, mine, botShots, api.rand);
      botShots.add(c);
      const hit = !!shipAt(mine, c);
      api.sound(hit ? 'bad' : 'splash');
      if (fleetSunk(mine, botShots)){ paint(); return api.lose('The bot sank your whole fleet.'); }
      if (hit) api.later(botTurn, 420);
      else { turn = 'me'; paint(); }
      if (hit) paint();
    }
    gTheirs.addEventListener('click', e => {
      const b = e.target.closest('[data-cell]');
      if (!b || turn !== 'me' || api.over) return;
      const c = Number(b.dataset.cell);
      if (myShots.has(c) || waterAround(N, theirs, myShots).has(c)) return;
      myShots.add(c);
      const s = shipAt(theirs, c);
      api.sound(s ? (sunk(s, myShots) ? 'good' : 'hit') : 'splash');
      if (fleetSunk(theirs, myShots)){ paint(); return api.win('All three enemy ships are sunk.'); }
      if (!s){ turn = 'bot'; api.later(botTurn, 450); }
      paint();
    });
    paint();
    return {};
  };

  // ### 2. Spot the difference: two pictures of the Titanic at night; the right one has five changes.
  BUILD.spotdiff = api => {
    const W = 640, H = 300, PW = 310, PH = 290, PX = [5, 325], PY = 5;
    const c = api.canvas(W, H), g = c.getContext('2d');
    const diffs = pickDiffs(api.rand), found = diffs.map(() => false), on = new Set(diffs.map(d => d.id));
    let wrong = null;
    function scene(changed){
      const has = id => changed && on.has(id), r = seq(1912);
      const sky = g.createLinearGradient(0, 0, 0, 190); sky.addColorStop(0, '#0b1830'); sky.addColorStop(1, '#2c4466');
      g.fillStyle = sky; g.fillRect(0, 0, PW, PH);
      g.fillStyle = '#fff'; for (let i = 0; i < 40; i++){ const x = r() * PW, y = r() * 170; g.globalAlpha = .4 + r() * .6; g.fillRect(x, y, 1.6, 1.6); }
      g.globalAlpha = 1;
      if (has('star')){ g.fillStyle = '#fff6c8'; g.beginPath(); for (let k = 0; k < 10; k++){ const a = k * Math.PI / 5 - Math.PI / 2, rr = k % 2 ? 3 : 8; g.lineTo(40 + Math.cos(a) * rr, 30 + Math.sin(a) * rr); } g.fill(); }
      if (!has('moon')){ g.fillStyle = '#f3ecd0'; g.beginPath(); g.arc(262, 42, 17, 0, 7); g.fill(); g.fillStyle = '#d9d1b4'; g.beginPath(); g.arc(256, 38, 4, 0, 7); g.arc(268, 48, 3, 0, 7); g.fill(); }
      const sea = g.createLinearGradient(0, 190, 0, PH); sea.addColorStop(0, '#173252'); sea.addColorStop(1, '#07121f');
      g.fillStyle = sea; g.fillRect(0, 190, PW, PH - 190);
      g.strokeStyle = 'rgba(180,210,240,.25)'; g.lineWidth = 1;
      for (let i = 0; i < 26; i++){ const x = r() * PW, y = 200 + r() * 85; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8 + r() * 14, y); g.stroke(); }
      // smoke from the first funnel
      if (!has('smoke')){ g.fillStyle = 'rgba(70,70,76,.75)'; for (let k = 0; k < 4; k++){ g.beginPath(); g.arc(70 - k * 9, 112 - k * 6, 7 + k * 2.5, 0, 7); g.fill(); } }
      drawTitanic(g, 10, 205, .7, { funnelBlack: has('funnel') ? 2 : -1, lights: true });
      if (has('flag')){ g.fillStyle = '#c0392b'; g.fillRect(28, 102, 14, 9); }
      if (!has('lamp')){ g.fillStyle = '#ff5544'; g.beginPath(); g.arc(199, 110, 3.2, 0, 7); g.fill(); g.fillStyle = 'rgba(255,85,68,.25)'; g.beginPath(); g.arc(199, 110, 8, 0, 7); g.fill(); }
      const big = has('iceberg');
      drawIceberg(g, big ? 240 : 250, 208, big ? 66 : 46, big ? 54 : 30);
      drawGull(g, 150, 46, 1.2, .6);
      if (has('gull')) drawGull(g, 196, 62, 1, 2);
      if (has('buoy')) drawBuoy(g, 70, 252, 7);
    }
    return {
      draw(){
        g.fillStyle = '#05080c'; g.fillRect(0, 0, W, H);
        for (let p = 0; p < 2; p++){
          g.save(); g.translate(PX[p], PY); g.beginPath(); g.rect(0, 0, PW, PH); g.clip(); scene(p === 1);
          g.lineWidth = 3; g.strokeStyle = '#7ee08a';
          diffs.forEach((d, i) => { if (found[i]){ g.beginPath(); g.arc(d.x, d.y, d.r, 0, 7); g.stroke(); } });
          if (wrong && wrong.t > 0){ g.strokeStyle = `rgba(255,77,77,${wrong.t * 2})`; g.lineWidth = 3; g.beginPath(); g.moveTo(wrong.x - 8, wrong.y - 8); g.lineTo(wrong.x + 8, wrong.y + 8); g.moveTo(wrong.x + 8, wrong.y - 8); g.lineTo(wrong.x - 8, wrong.y + 8); g.stroke(); }
          g.restore();
        }
      },
      update(dt){ if (wrong) wrong.t -= dt; },
      point(x, y, type){
        if (type !== 'down') return;
        const p = x >= PX[1] ? 1 : 0, lx = x - PX[p], ly = y - PY;
        if (lx < 0 || lx > PW || ly < 0 || ly > PH) return;
        const i = hitDiff(diffs, found, lx, ly);
        if (i >= 0){
          found[i] = true; api.sound('good');
          const n = found.filter(Boolean).length;
          api.status(`${n} of 5 differences found.`);
          if (n === 5) api.win('All five differences found.');
        } else { wrong = { x: lx, y: ly, t: .5 }; api.penalty(2); api.sound('bad'); }
      },
      start(){ api.status('0 of 5 differences found.'); }
    };
  };

  // ### 3. Tic-tac-toe: the player's anchors against the bot's icebergs.
  const ANCHOR = '<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="none" stroke="#ff7a1a" stroke-width="3.4" stroke-linecap="round"><circle cx="20" cy="8" r="3.6"/><path d="M20 12v22M12 18h16M7 24c2 8 8 11 13 11s11-3 13-11"/></g></svg>';
  const BERG = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M4 33 11 19l6-3 5-11 6 10 4 1 4 17z" fill="#e8f4f8"/><path d="M22 5l6 10 4 1 4 17H20z" fill="#9cc6db"/><path d="M2 34h36" stroke="#4a86b0" stroke-width="2.4"/></svg>';
  BUILD.tictactoe = api => {
    let b = Array(9).fill(''), busy = false, round = 1;
    api.stage.innerHTML = '<div class="ttt" role="grid" aria-label="Tic-tac-toe"></div>';
    const grid = api.stage.querySelector('.ttt');
    for (let i = 0; i < 9; i++){ const el = document.createElement('button'); el.type = 'button'; el.className = 'ttt-cell'; el.dataset.cell = i; el.setAttribute('aria-label', `Row ${Math.floor(i / 3) + 1}, column ${i % 3 + 1}`); grid.appendChild(el); }
    function paint(){
      [...grid.children].forEach((el, i) => { el.innerHTML = b[i] === 'X' ? ANCHOR : b[i] === 'O' ? BERG : ''; el.disabled = !!b[i] || busy; el.dataset.who = b[i]; });
      api.status(busy ? 'The bot is thinking…' : `Round ${round}: your move.`);
    }
    function check(){
      const w = tttWinner(b);
      if (w === 'X'){ paint(); api.win('Three anchors in a row.'); return true; }
      if (w === 'O'){ paint(); api.lose('The icebergs got three in a row.'); return true; }
      if (w === 'draw'){ busy = true; paint(); api.status('A draw. New round…'); api.later(() => { b = Array(9).fill(''); busy = false; round++; paint(); }, 700); return true; }
      return false;
    }
    grid.addEventListener('click', e => {
      const el = e.target.closest('[data-cell]');
      if (!el || busy || api.over) return;
      const i = Number(el.dataset.cell);
      if (b[i]) return;
      b[i] = 'X'; api.sound('tick');
      if (check()) return;
      busy = true; paint();
      api.later(() => { b[tttBot(b, api.rand)] = 'O'; busy = false; api.sound('splash'); if (!check()) paint(); }, 380);
    });
    paint();
    return {};
  };

  // ### 4. Deck run: run along the icy decks of the Titanic to the bow on the night of the collision. First along the side of
  // ### the ship under the deck above, past its round portholes; then out onto the open deck with the railing and its life
  // ### rings, benches, ventilators, lifeboats, a funnel and the foremast with the crow's nest. Everything that belongs to
  // ### the ship is painted once into long tiles that scroll with the deck; only the sky and the sea stay behind.
  // ### Every obstacle is drawn exactly as big as the box that can knock you down, and your own box is your body.
  const RUN_KINDS = {
    crate: { w: 30, h: 30 }, trunk: { w: 46, h: 22 }, barrel: { w: 24, h: 30 }, ice: { w: 36, h: 16 }
  };
  const RUN = { GROUND: 250, H: 300, LEN: 4400, PROMENADE_END: 1700, RAIL: 196, BOW0: 4420, BOW: 4680 };

  // ### A tapered limb from a to b (widths wa and wb), with round ends, for the sailor.
  function limb2(g, a, b, wa, wb, color){
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    g.fillStyle = color; g.beginPath();
    g.moveTo(a[0] + nx * wa / 2, a[1] + ny * wa / 2); g.lineTo(b[0] + nx * wb / 2, b[1] + ny * wb / 2);
    g.lineTo(b[0] - nx * wb / 2, b[1] - ny * wb / 2); g.lineTo(a[0] - nx * wa / 2, a[1] - ny * wa / 2); g.closePath(); g.fill();
    g.beginPath(); g.arc(a[0], a[1], wa / 2, 0, 7); g.arc(b[0], b[1], wb / 2, 0, 7); g.fill();
  }
  const at = (p, len, ang) => [p[0] + Math.sin(ang) * len, p[1] + Math.cos(ang) * len];
  // ### A sailor of 1912 running to the right with his feet at x, y: a navy jumper with the square white-striped collar and a
  // ### black neckerchief, bell-bottom trousers, boots, and the round sailor's cap whose two ribbons fly behind him. Arms and
  // ### legs are two-part limbs that move through a real running stride; the limbs on the far side are drawn darker.
  function drawSailor(g, x, y, t, air, vy){
    const ph = t * 11;
    const leg = (q, near) => air ? (near ? [.95 - Math.min(.5, Math.max(0, vy) / 900), 1.55] : [-.35, .7]) : [.62 * Math.sin(q), .15 + 1.3 * Math.max(0, Math.cos(q))];
    const arm = (q, near) => { const ua = air ? (near ? -1.9 : 1.1) : -.8 * Math.sin(q); return [ua, ua + (air ? .6 : 1.45)]; };
    return drawSailorPose(g, x, y, t, {
      lean: air ? .08 : .2, hipUp: air ? 30 : 0,
      legs: [leg(ph + Math.PI, false), leg(ph, true)], arms: [arm(ph, false), arm(ph + Math.PI, true)]
    });
  }
  // ### The sailor bouncing up through the ship: arms stretched up as he takes off, then arms out and knees drawn up as he
  // ### slows and falls, ready to land. vy is his speed upwards (negative) or downwards.
  function climbPose(vy){
    const k = Math.min(1, Math.max(0, (vy + 760) / 1160)), m = (a, b) => a + (b - a) * k;
    const mix = (a, b) => a.map((v, i) => m(v, b[i]));
    return {
      lean: m(.02, .1), hipUp: 0,
      legs: [mix([-.25, .35], [.2, .9]), mix([.15, .2], [.9, 1.4])],
      arms: [mix([2.5, 2.7], [-1.3, -.9]), mix([2.8, 3], [1.5, 1.1])]
    };
  }
  // ### The same sailor in any pose: lean of the body; for the far and the near leg the thigh angle and the bend of the knee;
  // ### for the far and the near arm the angles of upper arm and forearm (0 is straight down, positive is forward). His feet
  // ### stand at x, y, unless hipUp holds his hip that high above y.
  function drawSailorPose(g, x, y, t, pose){
    const lean = pose.lean;
    const TH = 13.5, SH = 13.5, UA = 10, FA = 9.5, TORSO = 19;
    // lay the legs out from a hip at 0, 0, then move the whole body so the lower foot stands on the deck
    const legs = pose.legs.map(([th, bend], i) => {
      const hip = [0, 0], knee = at(hip, TH, th), sa = th - bend, ankle = at(knee, SH, sa);
      const toe = [ankle[0] + Math.cos(sa) * 6.5, ankle[1] - Math.sin(sa) * 6.5 + 1.5];
      return { near: i === 1, knee, ankle, toe };
    });
    const low = Math.max(...legs.map(l => Math.max(l.ankle[1] + 2.5, l.toe[1] + 1.5)));
    const ox = x, oy = pose.hipUp ? y - pose.hipUp : y - low;
    const P = p => [ox + p[0], oy + p[1]];
    const hip = [ox, oy], shoulder = [ox + Math.sin(lean) * TORSO, oy - Math.cos(lean) * TORSO];
    const NAVY = '#1f2c4f', NAVY_FAR = '#141c33', TROUSER = '#1a2440', TROUSER_FAR = '#10162a', SKIN = '#e0ad86', SKIN_FAR = '#b98663';
    const arm = near => {
      const [ua, fa] = pose.arms[near ? 1 : 0];
      const s = [shoulder[0] + (near ? 1 : -1), shoulder[1] + 2], e = at(s, UA, ua), h = at(e, FA, fa);
      limb2(g, s, e, 5.2, 4.4, near ? NAVY : NAVY_FAR); limb2(g, e, h, 4.4, 3.6, near ? NAVY : NAVY_FAR);
      g.fillStyle = near ? SKIN : SKIN_FAR; g.beginPath(); g.arc(h[0], h[1], 2.1, 0, 7); g.fill();
    };
    const leg = l => {
      const k = P(l.knee), a = P(l.ankle), tt = P(l.toe), c = l.near ? TROUSER : TROUSER_FAR;
      limb2(g, hip, k, 7, 5.6, c); limb2(g, k, a, 5.6, 6.4, c);   // bell-bottoms widen at the ankle
      limb2(g, a, tt, 4.2, 3.4, l.near ? '#0b0b0d' : '#060607');
    };
    arm(false); leg(legs[0]);
    // torso: the jumper, a little wider at the shoulders, with a belt line
    const n = [Math.cos(lean), Math.sin(lean)];
    g.fillStyle = NAVY; g.beginPath();
    g.moveTo(hip[0] - n[0] * 5, hip[1] - n[1] * 5); g.lineTo(hip[0] + n[0] * 5.5, hip[1] + n[1] * 5.5);
    g.lineTo(shoulder[0] + n[0] * 6, shoulder[1] + n[1] * 6); g.lineTo(shoulder[0] - n[0] * 5.5, shoulder[1] - n[1] * 5.5); g.closePath(); g.fill();
    g.beginPath(); g.arc(shoulder[0], shoulder[1] + 1, 5.6, 0, 7); g.fill();
    g.strokeStyle = '#0d1428'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(hip[0] - n[0] * 5, hip[1] - n[1] * 5 - 1); g.lineTo(hip[0] + n[0] * 5.5, hip[1] + n[1] * 5.5 - 1); g.stroke();
    leg(legs[1]);
    // the square sailor's collar on the back, light blue with three white stripes, and the black neckerchief in front
    const back = [shoulder[0] - n[0] * 5.8, shoulder[1] - n[1] * 5.8];
    g.fillStyle = '#5d7fb3'; g.beginPath(); g.moveTo(shoulder[0] - n[0] * 1, shoulder[1] - 2); g.lineTo(back[0] - 1, back[1] - 1); g.lineTo(back[0] - 1 + Math.sin(lean) * 9, back[1] + 9); g.lineTo(shoulder[0] + 1, shoulder[1] + 6); g.closePath(); g.fill();
    g.strokeStyle = '#f4f6f8'; g.lineWidth = .7; g.beginPath(); g.moveTo(back[0] + .3, back[1] + .5); g.lineTo(back[0] + .3 + Math.sin(lean) * 8, back[1] + 8.5); g.moveTo(back[0] + 1.6, back[1] + .5); g.lineTo(back[0] + 1.6 + Math.sin(lean) * 8, back[1] + 8.5); g.stroke();
    g.fillStyle = '#0b0b0d'; g.beginPath(); g.moveTo(shoulder[0] + 3, shoulder[1] + 1); g.lineTo(shoulder[0] + 6, shoulder[1] + 3); g.lineTo(shoulder[0] + 4, shoulder[1] + 8); g.closePath(); g.fill();
    // neck and head: face, ear, short dark hair, nose
    const neck = [shoulder[0] + 2, shoulder[1] - 2], head = [shoulder[0] + 3.5, shoulder[1] - 8.5];
    limb2(g, neck, [head[0], head[1] + 3], 3.4, 3.4, SKIN);
    g.fillStyle = SKIN; g.beginPath(); g.ellipse(head[0], head[1], 4.3, 5.1, .1, 0, 7); g.fill();
    g.fillStyle = '#4a3020'; g.beginPath(); g.ellipse(head[0] - 1.3, head[1] - 1.6, 3.6, 3.6, 0, Math.PI * .75, Math.PI * 1.95); g.fill();
    g.fillStyle = '#c8916b'; g.beginPath(); g.arc(head[0] - .8, head[1] + .3, 1.1, 0, 7); g.fill();
    g.fillStyle = SKIN; g.beginPath(); g.moveTo(head[0] + 4, head[1] - .2); g.lineTo(head[0] + 5.6, head[1] + 1.4); g.lineTo(head[0] + 4, head[1] + 1.8); g.fill();
    g.fillStyle = '#2a1a10'; g.fillRect(head[0] + 2.2, head[1] - 1, 1.1, 1.1);
    // the round sailor's cap: a white top over a navy band, tilted back, with two black ribbons flying behind
    const flap = Math.sin(t * 18) * 1.5;
    g.strokeStyle = '#0b0b0d'; g.lineWidth = 1.1; g.beginPath();
    g.moveTo(head[0] - 3.5, head[1] - 4); g.quadraticCurveTo(head[0] - 9, head[1] - 4 + flap, head[0] - 13, head[1] - 1 - flap);
    g.moveTo(head[0] - 3.5, head[1] - 3.4); g.quadraticCurveTo(head[0] - 8, head[1] - 1 - flap, head[0] - 12, head[1] + 2 + flap); g.stroke();
    g.fillStyle = '#1a2440'; g.beginPath(); g.ellipse(head[0] - .2, head[1] - 4.1, 4.9, 1.6, -.12, 0, 7); g.fill();
    g.fillStyle = '#f2f3f0'; g.beginPath(); g.ellipse(head[0] - .6, head[1] - 5.6, 6.2, 1.9, -.12, 0, 7); g.fill();
    g.fillStyle = '#d7dbe0'; g.beginPath(); g.ellipse(head[0] - .6, head[1] - 5.2, 6.2, .9, -.12, 0, Math.PI); g.fill();
    arm(true);
    return { head, mouth: [head[0] + 4.6, head[1] + 2] };
  }

  // ### The layout of the ship along the run: what stands where, decided once per game.
  function runLayout(rand){
    const L = { portholes: [], doors: [], lamps: [], rings: [], benches: [], vents: [], bollards: [], boats: [] };
    for (let x = -180; x < RUN.PROMENADE_END - 40; x += 64) L.portholes.push(x);
    for (let x = 260; x < RUN.PROMENADE_END - 120; x += 480 + rand() * 160) L.doors.push(x);
    for (let x = -120; x < RUN.PROMENADE_END; x += 210) L.lamps.push(x);
    const B = RUN.PROMENADE_END + 260;
    for (let x = B + 40; x < RUN.LEN - 80; x += 300 + rand() * 120) L.rings.push(x);
    for (let x = B + 190; x < RUN.LEN - 200; x += 420 + rand() * 160) L.benches.push(x);
    for (let x = B + 120; x < RUN.LEN - 300; x += 560 + rand() * 200) L.vents.push(x);
    for (let x = B + 300; x < RUN.LEN; x += 380 + rand() * 160) if (!L.benches.some(b => x > b - 30 && x < b + 70)) L.bollards.push(x);
    for (let x = B + 40; x < B + 1100; x += 190) L.boats.push(x);
    L.funnel = B + 520; L.mast = RUN.LEN - 760; L.crane = RUN.LEN - 380;
    // nothing stands in front of the foot of the mast or the crane
    for (const k of ['rings', 'benches', 'vents', 'bollards']) L[k] = L[k].filter(x => Math.abs(x - L.mast) > 90 && Math.abs(x - L.crane - 20) > 80);
    return L;
  }
  // ### Paints the part of the ship from world x0 to x0 + w onto g (already scaled), in the cold light of the night.
  function paintRunTile(g, x0, w, L){
    const { GROUND, H, PROMENADE_END: PE, RAIL, BOW0, BOW } = RUN;
    g.save(); g.translate(-x0, 0);
    const vis = (a, b) => b > x0 - 2 && a < x0 + w + 2;
    const snow = (x, y, wd, th) => { g.fillStyle = '#f4f9fc'; g.beginPath(); g.moveTo(x - 1, y + 1); g.quadraticCurveTo(x + wd / 2, y - th * 2, x + wd + 1, y + 1); g.closePath(); g.fill(); };
    const icicles = (xa, xb, y, step) => { g.fillStyle = 'rgba(220,240,252,.95)'; for (let x = Math.ceil(xa / step) * step; x < xb; x += step){ const l = 3 + ((x * 7919) % 7); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2.4, y); g.lineTo(x + 1.2, y + l); g.fill(); } };
    const glow = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,205,120,${a})`); gr.addColorStop(1, 'rgba(255,205,120,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
    // ---- the covered promenade along the side of the ship ----
    if (vis(-400, PE + 40)){
      const xa = Math.max(x0 - 2, -400), xb = Math.min(x0 + w + 2, PE);
      // the deck above: its railing against the sky, the slab, the steel side with seams and rivets
      g.strokeStyle = '#d9dee2'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(xa, 8); g.lineTo(xb, 8); g.moveTo(xa, 18); g.lineTo(xb, 18); g.stroke();
      for (let x = Math.ceil(xa / 22) * 22; x < xb; x += 22){ g.beginPath(); g.moveTo(x + .5, 8); g.lineTo(x + .5, 30); g.stroke(); }
      g.fillStyle = '#f4f9fc'; g.fillRect(xa, 6, xb - xa, 2);
      const wall = g.createLinearGradient(0, 30, 0, GROUND); wall.addColorStop(0, '#d9d4c6'); wall.addColorStop(.5, '#c9c6bb'); wall.addColorStop(1, '#a9aeb2');
      g.fillStyle = wall; g.fillRect(xa, 30, xb - xa, GROUND - 30);
      g.fillStyle = '#ece8dc'; g.fillRect(xa, 30, xb - xa, 10); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(xa, 40, xb - xa, 6);   // the slab and its shadow
      icicles(xa, xb, 40, 9);
      g.strokeStyle = 'rgba(80,80,72,.35)'; g.lineWidth = 1;
      for (const y of [92, 128, 196]){ g.beginPath(); g.moveTo(xa, y + .5); g.lineTo(xb, y + .5); g.stroke(); }
      for (let x = Math.ceil(xa / 96) * 96; x < xb; x += 96){ g.beginPath(); g.moveTo(x + .5, 46); g.lineTo(x + .5, GROUND); g.stroke(); }
      g.fillStyle = 'rgba(90,84,70,.45)';
      for (const y of [89, 125, 193]) for (let x = Math.ceil(xa / 12) * 12; x < xb; x += 12){ g.beginPath(); g.arc(x, y, .9, 0, 7); g.fill(); }
      // two rows of round portholes: brass rims, warm light inside, frost on the lower edge
      for (const px of L.portholes) for (const [py, rr, off] of [[160, 13, 0], [70, 9, 32]]){
        const x = px + off; if (!vis(x - 30, x + 30) || x > PE - 30) continue;
        glow(x, py, rr * 2.6, .25);
        const rim = g.createLinearGradient(x - rr, py - rr, x + rr, py + rr); rim.addColorStop(0, '#f0d58c'); rim.addColorStop(.5, '#b58b3a'); rim.addColorStop(1, '#6e5220');
        g.fillStyle = rim; g.beginPath(); g.arc(x, py, rr + 3.5, 0, 7); g.fill();
        g.fillStyle = '#4f3a16'; g.beginPath(); g.arc(x, py, rr + .8, 0, 7); g.fill();
        const gl = g.createRadialGradient(x - rr * .3, py - rr * .3, 1, x, py, rr); gl.addColorStop(0, '#fff1c2'); gl.addColorStop(.6, '#f2b55a'); gl.addColorStop(1, '#a8621e');
        g.fillStyle = gl; g.beginPath(); g.arc(x, py, rr, 0, 7); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, py, rr * .65, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
        g.fillStyle = '#4f3a16'; for (let k = 0; k < 8; k++){ const a = k * Math.PI / 4; g.beginPath(); g.arc(x + Math.cos(a) * (rr + 2), py + Math.sin(a) * (rr + 2), .8, 0, 7); g.fill(); }
        g.strokeStyle = 'rgba(240,250,255,.9)'; g.lineWidth = 2; g.beginPath(); g.arc(x, py, rr + 2.5, Math.PI * .2, Math.PI * .8); g.stroke();
      }
      // watertight doors with a small round window, pipes beside them
      for (const dx of L.doors){
        if (!vis(dx - 30, dx + 60)) continue;
        g.fillStyle = '#b7b6ad'; g.fillRect(dx - 3, GROUND - 78, 42, 78);
        g.fillStyle = '#d2cfc4'; g.beginPath(); g.moveTo(dx, GROUND); g.lineTo(dx, GROUND - 68); g.quadraticCurveTo(dx, GROUND - 75, dx + 7, GROUND - 75); g.lineTo(dx + 29, GROUND - 75); g.quadraticCurveTo(dx + 36, GROUND - 75, dx + 36, GROUND - 68); g.lineTo(dx + 36, GROUND); g.fill();
        g.strokeStyle = 'rgba(70,70,64,.6)'; g.lineWidth = 1; g.stroke();
        g.fillStyle = '#4f3a16'; g.beginPath(); g.arc(dx + 18, GROUND - 56, 6, 0, 7); g.fill(); g.fillStyle = '#f2b55a'; g.beginPath(); g.arc(dx + 18, GROUND - 56, 4.5, 0, 7); g.fill();
        g.fillStyle = '#6d6a60'; g.fillRect(dx + 28, GROUND - 40, 5, 3);
        g.strokeStyle = '#8b8f92'; g.lineWidth = 4; g.beginPath(); g.moveTo(dx - 14, 46); g.lineTo(dx - 14, GROUND); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(dx - 15.5, 46); g.lineTo(dx - 15.5, GROUND); g.stroke();
        g.fillStyle = '#c0392b'; g.fillRect(dx + 46, GROUND - 70, 16, 22); g.fillStyle = '#efe6cf'; g.fillRect(dx + 48, GROUND - 66, 12, 3);   // fire hose box
      }
      // lamps under the deck above
      for (const lx of L.lamps){ if (!vis(lx - 40, lx + 40)) continue; glow(lx, 52, 46, .45); g.fillStyle = '#6e5220'; g.fillRect(lx - 1, 46, 2, 4); g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(lx, 53, 3.2, 0, 7); g.fill(); }
      // snow blown in along the foot of the wall
      g.fillStyle = 'rgba(240,248,252,.9)'; g.beginPath(); g.moveTo(xa, GROUND);
      for (let x = xa; x <= xb; x += 16) g.lineTo(x, GROUND - 3 - Math.abs(Math.sin(x * .013)) * 6);
      g.lineTo(xb, GROUND); g.fill();
      // the end of the promenade: a steep stairway up to the deck above, and the corner of the deckhouse
      if (vis(PE - 140, PE + 40)){
        const s0 = [PE - 118, GROUND], s1 = [PE - 14, 44], n = 15, sx = (s1[0] - s0[0]) / n, sy = (s1[1] - s0[1]) / n;
        g.fillStyle = 'rgba(0,0,0,.16)'; g.beginPath(); g.moveTo(s0[0] + 6, GROUND); g.lineTo(s1[0] + 6, s1[1]); g.lineTo(s1[0] + 14, s1[1]); g.lineTo(s1[0] + 14, GROUND); g.fill();
        for (let k = 1; k < n; k++){ const x = s0[0] + sx * k, y = s0[1] + sy * k; g.fillStyle = '#7a5a3a'; g.fillRect(x - 2, y - 2.5, 13, 3); g.fillStyle = '#f4f9fc'; g.fillRect(x - 2, y - 3.5, 13, 1.2); }
        g.strokeStyle = '#5f4429'; g.lineWidth = 3; g.beginPath(); g.moveTo(s0[0], s0[1]); g.lineTo(s1[0], s1[1]); g.stroke();
        g.strokeStyle = '#d9dee2'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(s0[0] + 2, s0[1] - 26); g.lineTo(s1[0] + 2, s1[1] - 26);
        for (let k = 0; k <= n; k += 3){ const x = s0[0] + sx * k + 2, y = s0[1] + sy * k; g.moveTo(x, y - 2); g.lineTo(x, y - 26); }
        g.stroke();
        g.fillStyle = '#e6e1d4'; g.fillRect(PE - 8, 30, 8, GROUND - 30); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(PE - 8, 30, 2, GROUND - 30);
      }
    }
    // ---- the open deck ----
    if (vis(PE, RUN.LEN + 400)){
      const xa = Math.max(x0 - 2, PE), xb = x0 + w + 2;
      // a funnel and lifeboats in their davits behind the railing
      if (vis(L.funnel - 10, L.funnel + 90)){
        const fx = L.funnel;
        const fg = g.createLinearGradient(fx, 0, fx + 84, 0); fg.addColorStop(0, '#7d6844'); fg.addColorStop(.35, '#b4935a'); fg.addColorStop(1, '#5f4d31');
        g.fillStyle = fg; g.fillRect(fx, -4, 84, RAIL - 30);
        g.fillStyle = '#0d0f12'; g.fillRect(fx, -4, 84, 26); g.fillStyle = 'rgba(240,248,252,.85)'; g.fillRect(fx, 22, 84, 2);
        g.fillStyle = 'rgba(0,0,0,.22)'; for (const y of [60, 100, 140]) g.fillRect(fx, y, 84, 2);
        g.fillStyle = '#d9d4c6'; g.fillRect(fx - 30, RAIL - 34, 144, 34);
      }
      for (const bx of L.boats){
        if (!vis(bx - 10, bx + 90)) continue;
        g.strokeStyle = '#d7dde2'; g.lineWidth = 3; g.beginPath(); g.moveTo(bx + 4, RAIL); g.quadraticCurveTo(bx + 4, RAIL - 46, bx + 18, RAIL - 46); g.moveTo(bx + 82, RAIL); g.quadraticCurveTo(bx + 82, RAIL - 46, bx + 68, RAIL - 46); g.stroke();
        g.lineWidth = 1; g.beginPath(); g.moveTo(bx + 18, RAIL - 46); g.lineTo(bx + 20, RAIL - 36); g.moveTo(bx + 68, RAIL - 46); g.lineTo(bx + 66, RAIL - 36); g.stroke();
        g.fillStyle = '#e9eef2'; g.beginPath(); g.moveTo(bx + 8, RAIL - 36); g.lineTo(bx + 78, RAIL - 36); g.quadraticCurveTo(bx + 72, RAIL - 16, bx + 43, RAIL - 16); g.quadraticCurveTo(bx + 14, RAIL - 16, bx + 8, RAIL - 36); g.fill();
        g.fillStyle = '#8f2a20'; g.fillRect(bx + 10, RAIL - 35, 66, 2); snow(bx + 8, RAIL - 37, 70, 2.5);
      }
      // the foremast with its rigging and the crow's nest
      if (vis(L.mast - 160, L.mast + 160)){
        const mx = L.mast;
        g.strokeStyle = 'rgba(40,46,52,.9)'; g.lineWidth = 1;
        for (let k = -3; k <= 3; k++){ if (!k) continue; g.beginPath(); g.moveTo(mx + 4, 20); g.lineTo(mx + 4 + k * 46, RAIL); g.stroke(); }
        g.strokeStyle = 'rgba(40,46,52,.5)'; for (let y = 40; y < RAIL; y += 9){ const s = (y - 20) / (RAIL - 20); g.beginPath(); g.moveTo(mx + 4 - 138 * s, y); g.lineTo(mx + 4 - 46 * s, y); g.stroke(); }
        const mg = g.createLinearGradient(mx, 0, mx + 9, 0); mg.addColorStop(0, '#6b4a2a'); mg.addColorStop(.5, '#9a7046'); mg.addColorStop(1, '#4e341c');
        g.fillStyle = mg; g.beginPath(); g.moveTo(mx, GROUND); g.lineTo(mx + 1.5, -4); g.lineTo(mx + 7.5, -4); g.lineTo(mx + 9, GROUND); g.fill();
        g.fillStyle = '#5a4126'; g.fillRect(mx - 34, 26, 77, 4); snow(mx - 34, 25, 77, 1.5);
        g.fillStyle = '#7a5428'; g.fillRect(mx - 10, 54, 29, 24); g.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 4; k++) g.fillRect(mx - 10, 58 + k * 5, 29, 1);
        snow(mx - 11, 53, 31, 2.5); g.fillStyle = '#d8b25a'; g.beginPath(); g.arc(mx + 22, 66, 3.4, 0, 7); g.fill();
        g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(mx + 4.5, 96, 3, 0, 7); g.fill(); glow(mx + 4.5, 96, 26, .5);
      }
      // the railing: white steel posts, a wooden top rail with snow on it and icicles under it (as far as the bow)
      const rb = Math.min(xb, BOW0);
      g.strokeStyle = '#e3e9ee'; g.lineWidth = 1.6;
      for (let x = Math.ceil(xa / 30) * 30; x < rb; x += 30){ g.beginPath(); g.moveTo(x + .5, RAIL + 4); g.lineTo(x + .5, GROUND); g.stroke(); }
      if (rb > xa){
        g.lineWidth = 1.2; for (const y of [RAIL + 20, RAIL + 36]){ g.beginPath(); g.moveTo(xa, y + .5); g.lineTo(rb, y + .5); g.stroke(); }
        const rail = g.createLinearGradient(0, RAIL, 0, RAIL + 6); rail.addColorStop(0, '#a4764a'); rail.addColorStop(1, '#6b4a2a');
        g.fillStyle = rail; g.fillRect(xa, RAIL, rb - xa, 6);
        g.fillStyle = '#f4f9fc'; g.fillRect(xa, RAIL - 2, rb - xa, 2.5);
        icicles(xa, rb, RAIL + 6, 13);
      }
      // life rings hanging on the railing
      for (const rx of L.rings){
        if (!vis(rx - 20, rx + 20)) continue;
        const cy = RAIL + 22;
        g.strokeStyle = '#d7c49a'; g.lineWidth = 1; g.beginPath(); g.moveTo(rx - 8, RAIL + 4); g.lineTo(rx - 10, cy - 6); g.moveTo(rx + 8, RAIL + 4); g.lineTo(rx + 10, cy - 6); g.stroke();
        g.lineWidth = 6.5; for (let k = 0; k < 8; k++){ g.strokeStyle = k % 2 ? '#f1ece2' : '#d0472c'; g.beginPath(); g.arc(rx, cy, 12, k * Math.PI / 4, (k + 1) * Math.PI / 4); g.stroke(); }
        g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.beginPath(); g.arc(rx, cy, 15.3, 0, 7); g.stroke();
        g.fillStyle = '#2a2418'; g.font = '700 4px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('TITANIC', rx, cy + 1.5); g.textAlign = 'start';
        g.strokeStyle = '#f4f9fc'; g.lineWidth = 2; g.beginPath(); g.arc(rx, cy, 13, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      }
      // ventilator cowls, benches, bollards with rope, and a cargo crane near the bow
      for (const vx of L.vents){
        if (!vis(vx - 20, vx + 40)) continue;
        g.fillStyle = '#e8e4da'; g.fillRect(vx, GROUND - 46, 12, 46);
        g.beginPath(); g.arc(vx + 14, GROUND - 48, 14, Math.PI * .55, Math.PI * 1.9); g.lineTo(vx + 12, GROUND - 40); g.fill();
        g.fillStyle = '#8f2a20'; g.beginPath(); g.ellipse(vx + 22, GROUND - 52, 6, 9, -.5, 0, 7); g.fill();
        snow(vx + 2, GROUND - 61, 18, 2); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(vx + 8, GROUND - 46, 4, 46);
      }
      for (const bx of L.benches){
        if (!vis(bx - 10, bx + 70)) continue;
        g.fillStyle = '#2e2e2e'; g.fillRect(bx + 4, GROUND - 16, 3, 16); g.fillRect(bx + 52, GROUND - 16, 3, 16); g.fillRect(bx + 2, GROUND - 32, 3, 18); g.fillRect(bx + 54, GROUND - 32, 3, 18);
        g.fillStyle = '#8a5f36'; for (let k = 0; k < 3; k++) g.fillRect(bx, GROUND - 18 + k * 2.5, 60, 2);
        for (let k = 0; k < 3; k++) g.fillRect(bx, GROUND - 32 + k * 4.5, 60, 3);
        snow(bx, GROUND - 19, 60, 2); snow(bx, GROUND - 33, 60, 1.5);
      }
      for (const bx of L.bollards){
        if (!vis(bx - 10, bx + 30)) continue;
        g.fillStyle = '#2b2f33'; g.fillRect(bx, GROUND - 10, 18, 4); g.fillRect(bx + 2, GROUND - 16, 5, 10); g.fillRect(bx + 11, GROUND - 16, 5, 10);
        g.fillStyle = '#c9b38a'; g.beginPath(); g.ellipse(bx + 9, GROUND - 3, 11, 3, 0, 0, 7); g.fill(); g.strokeStyle = '#9a855e'; g.lineWidth = .8; g.beginPath(); g.ellipse(bx + 9, GROUND - 3, 6, 1.6, 0, 0, 7); g.stroke();
        snow(bx + 1, GROUND - 17, 16, 1.2);
      }
      if (vis(L.crane - 60, L.crane + 120)){
        const cx = L.crane;
        g.fillStyle = '#3a4046'; g.fillRect(cx, GROUND - 70, 10, 70);
        g.strokeStyle = '#3a4046'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx + 5, GROUND - 60); g.lineTo(cx + 96, GROUND - 112); g.stroke();
        g.strokeStyle = '#22272b'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx + 96, GROUND - 112); g.lineTo(cx + 96, GROUND - 52); g.moveTo(cx + 5, GROUND - 70); g.lineTo(cx + 96, GROUND - 112); g.stroke();
        g.fillStyle = '#22272b'; g.fillRect(cx + 92, GROUND - 54, 8, 5);
        g.fillStyle = '#4b5258'; g.fillRect(cx - 18, GROUND - 22, 46, 22); g.fillStyle = '#2b2f33'; g.beginPath(); g.arc(cx + 5, GROUND - 14, 7, 0, 7); g.fill();
        snow(cx - 18, GROUND - 23, 46, 2); snow(cx, GROUND - 71, 10, 1.5);
      }
      // deck lamps on posts
      for (let lx = PE + 360; lx < RUN.LEN; lx += 520){
        if (!vis(lx - 40, lx + 40)) continue;
        g.fillStyle = '#2b2f33'; g.fillRect(lx - 1.5, RAIL - 30, 3, GROUND - RAIL + 30); glow(lx, RAIL - 34, 34, .5);
        g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(lx, RAIL - 34, 3.5, 0, 7); g.fill(); snow(lx - 4, RAIL - 39, 8, 1.2);
      }
      // two capstans for the anchor chains just before the bow
      for (const cx of [RUN.LEN - 150, RUN.LEN - 70]){
        if (!vis(cx - 20, cx + 20)) continue;
        g.fillStyle = '#1d2125'; g.fillRect(cx - 9, GROUND - 14, 18, 14); g.fillRect(cx - 12, GROUND - 17, 24, 4);
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(cx - 7, GROUND - 13, 3, 12); snow(cx - 12, GROUND - 17, 24, 1.5);
      }
    }
    // ---- the deck itself: frosted teak, its seams and butt joints, snow (more of it out in the open) ----
    const dg = g.createLinearGradient(0, GROUND, 0, H); dg.addColorStop(0, '#a58a6b'); dg.addColorStop(1, '#7a6550');
    g.fillStyle = dg; g.fillRect(x0 - 2, GROUND, w + 4, H - GROUND);
    g.fillStyle = 'rgba(200,220,235,.32)'; g.fillRect(x0 - 2, GROUND, w + 4, H - GROUND);   // a film of frost over the wood
    g.strokeStyle = 'rgba(55,42,30,.55)'; g.lineWidth = 1;
    for (let y = GROUND + 6.5, row = 0; y < H; y += 7, row++){
      g.beginPath(); g.moveTo(x0 - 2, y); g.lineTo(x0 + w + 2, y); g.stroke();
      for (let x = Math.floor((x0 - 120) / 120) * 120 + (row % 3) * 40; x < x0 + w; x += 120){ g.beginPath(); g.moveTo(x + .5, y - 7); g.lineTo(x + .5, y); g.stroke(); }
    }
    // patches of snow, each in its own cell of the deck so that a patch is whole even where two tiles meet
    for (let cell = Math.floor((x0 - 60) / 60); cell * 60 < x0 + w + 60; cell++){
      const Rc = seq(cell * 131 + 7), sx = cell * 60 + Rc() * 60, sy = GROUND + 6 + Rc() * 40, open = sx > PE, rw = 14 + Rc() * 26, rh = 2.2 + Rc() * 2.5;
      if (!open && Rc() < .6) continue;
      g.fillStyle = `rgba(240,248,252,${open ? .8 : .55})`; g.beginPath(); g.ellipse(sx, sy, rw, rh, 0, 0, 7); g.fill();
      if (Rc() < .5){ g.fillStyle = '#fff'; g.fillRect(sx + 6, sy - 1, 1.6, 1.6); }
    }
    g.fillStyle = 'rgba(240,248,252,.9)'; g.fillRect(x0 - 2, GROUND, w + 4, 1.5);
    // ---- the bow: the deck narrows to the stem, the railing sweeps round with it, and beyond is the black sea ----
    if (vis(BOW0, BOW + 600)){
      const edge = x => GROUND + (H - GROUND) * (1 - Math.sqrt(Math.max(0, 1 - Math.min(1, (x - BOW0) / (BOW - BOW0)) ** 2)));
      const xs = []; for (let x = BOW0; x < BOW; x += 3) xs.push(x); xs.push(BOW);
      // the anchor chains, from the capstans along the deck to the hawse pipes at the stem
      g.strokeStyle = '#2b2f33'; g.lineWidth = 2.2; g.setLineDash([3, 1.6]);
      for (const [cx, y] of [[RUN.LEN - 150, GROUND + 9], [RUN.LEN - 70, GROUND + 16]]){ g.beginPath(); g.moveTo(cx, GROUND - 2); g.quadraticCurveTo(cx + 10, y, cx + 40, y); g.lineTo(BOW - 90, y + 6); g.lineTo(BOW - 30, H - 8); g.stroke(); }
      g.setLineDash([]);
      g.fillStyle = '#04080f'; g.beginPath(); g.moveTo(BOW0, GROUND - .5); for (const x of xs) g.lineTo(x, edge(x)); g.lineTo(BOW + 600, H); g.lineTo(BOW + 600, GROUND - .5); g.fill();
      g.fillStyle = 'rgba(200,220,240,.16)'; for (let k = 0; k < 9; k++){ const x = BOW0 + 60 + k * 61, y = GROUND + 6 + (k * 17) % 40; if (y < edge(x) - 3) g.fillRect(x, y, 9 + (k % 3) * 5, 1); }
      // the gunwale along the edge of the deck, then the railing on top of it
      const along = d => { g.beginPath(); xs.forEach((x, k) => k ? g.lineTo(x, edge(x) - d) : g.moveTo(x, edge(x) - d)); g.stroke(); };
      g.strokeStyle = 'rgba(240,248,252,.9)'; g.lineWidth = 1.5; along(-.75);
      g.strokeStyle = '#e3e9ee'; g.lineWidth = 1.6; g.beginPath();
      for (let x = Math.ceil(BOW0 / 30) * 30; x < BOW - 8; x += 30){ g.moveTo(x + .5, edge(x) - (GROUND - RAIL) + 4); g.lineTo(x + .5, edge(x)); }
      g.stroke(); g.lineWidth = 1.2;
      for (const d of [18, 34]) along(d - .5);
      const top = GROUND - RAIL;
      g.fillStyle = 'rgba(220,240,252,.95)';
      for (let x = Math.ceil(BOW0 / 13) * 13; x < BOW - 20; x += 13){ const y = edge(x) - top + 6, l = 3 + ((x * 7919) % 7); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2.4, y); g.lineTo(x + 1.2, y + l); g.fill(); }
      g.strokeStyle = '#8a6038'; g.lineWidth = 6; along(top - 3);
      g.strokeStyle = '#f4f9fc'; g.lineWidth = 2.5; along(top + .75);
      // the jack staff at the stem, flying the line's red swallow-tailed flag with its white star stiff in the cold wind
      const jx = BOW - 6, jy = edge(BOW - 6), fy = jy - 104;
      g.fillStyle = '#d9d4c6'; g.fillRect(jx - 1.5, fy, 3, 104); g.beginPath(); g.arc(jx, fy, 2.4, 0, 7); g.fill();
      g.fillStyle = '#b8322a'; g.beginPath(); g.moveTo(jx + 1.5, fy + 1); g.lineTo(jx + 31, fy + 3); g.lineTo(jx + 22, fy + 9.5); g.lineTo(jx + 31, fy + 16); g.lineTo(jx + 1.5, fy + 18); g.fill();
      g.fillStyle = '#f4f6f8'; g.beginPath();
      for (let k = 0; k < 10; k++){ const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 1.9 : 4.6; g.lineTo(jx + 11 + Math.cos(a) * r, fy + 9.5 + Math.sin(a) * r); }
      g.fill();
    }
    g.restore();
  }

  BUILD.deckrun = api => {
    const { GROUND, H, LEN } = RUN, W = 640, SPEED = 230, TW = 512;
    const c = api.canvas(W, H), g = c.getContext('2d');
    const night = paintNight(W, 205, 170, 1912), layout = runLayout(api.rand);
    const scale = Math.max(1, c.width / W), tiles = new Map();
    const p = { x: 90, y: GROUND, vy: 0, hurt: 0 };
    let dist = 0, lives = 3, t = 0, breath = 0;
    const kinds = Object.keys(RUN_KINDS), obs = [];
    for (let x = 520; x < LEN - 200; x += 230 + api.rand() * 170){ const k = kinds[Math.floor(api.rand() * kinds.length)]; obs.push({ x, k, ...RUN_KINDS[k] }); }
    const flakes = Array.from({ length: 40 }, () => ({ x: api.rand() * W, y: api.rand() * H, s: .4 + api.rand() * .9 }));
    const jump = () => { if (p.y >= GROUND - .5 && !api.over){ p.vy = -610; api.sound('jump'); } };
    const Rn = Math.round;
    const body = () => ({ x: p.x - 7, y: p.y - 56, w: 14, h: 56 });
    // ### One tile of the ship, painted the first time it comes near the screen and forgotten once it is behind.
    function tile(i){
      if (!tiles.has(i)){
        const cv = document.createElement('canvas'); cv.width = Math.ceil(TW * scale); cv.height = Math.ceil(H * scale);
        const tg = cv.getContext('2d'); tg.scale(cv.width / TW, cv.height / H);
        paintRunTile(tg, i * TW, TW, layout); tiles.set(i, cv);
      }
      return tiles.get(i);
    }
    function drawObstacle(o, sx){
      const x = Rn(sx), y = GROUND - o.h, w = o.w, h = o.h;
      if (o.k === 'crate'){
        g.fillStyle = '#8a6136'; g.fillRect(x, y, w, h);
        g.fillStyle = '#6d4a26'; g.fillRect(x, y, w, 3); g.fillRect(x, y + h - 3, w, 3); g.fillRect(x, y, 3, h); g.fillRect(x + w - 3, y, 3, h);
        g.strokeStyle = '#5a3c1e'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 3, y + 3); g.lineTo(x + w - 3, y + h - 3); g.stroke();
        g.fillStyle = '#eef6fb'; g.fillRect(x, y, w, 4); g.fillStyle = '#ffffff'; g.fillRect(x + 2, y, w - 6, 2);
      } else if (o.k === 'trunk'){
        g.fillStyle = '#3d4a5c'; g.fillRect(x, y, w, h);
        g.fillStyle = '#b08a3e'; g.fillRect(x, y + 4, w, 2); g.fillRect(x, y + h - 6, w, 2); g.fillRect(x + 6, y, 3, h); g.fillRect(x + w - 9, y, 3, h);
        g.fillStyle = '#d8b25a'; g.fillRect(x + w / 2 - 3, y + 8, 6, 5);
        g.fillStyle = '#eef6fb'; g.fillRect(x, y, w, 3);
      } else if (o.k === 'barrel'){
        const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, '#5e3a1c'); gr.addColorStop(.45, '#8f5e30'); gr.addColorStop(1, '#4e2f16');
        g.fillStyle = gr; g.fillRect(x, y, w, h);
        g.fillStyle = '#2d3236'; g.fillRect(x, y + 5, w, 3); g.fillRect(x, y + h - 8, w, 3);
        g.fillStyle = '#eef6fb'; g.fillRect(x, y, w, 3);
      } else {
        const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, '#e9f7ff'); gr.addColorStop(1, '#6fa9cc');
        g.fillStyle = gr; g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x + 3, y + 3, w * .4, 2);
        g.strokeStyle = 'rgba(30,85,125,.9)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
        g.beginPath(); g.moveTo(x + w * .6, y); g.lineTo(x + w * .5, y + h); g.stroke();
      }
    }
    return {
      key(code, down){ if (down && (code === 'Space' || code === 'ArrowUp' || code === 'KeyW')) jump(); },
      point(x, y, type){ if (type === 'down') jump(); },
      start(){ api.status(`Lives: ♥♥♥ · Distance to the bow: ${LEN / 10} m`); },
      update(dt){
        t += dt; breath = (breath + dt) % 1.6;
        dist = Math.min(LEN, dist + SPEED * dt);
        p.vy += 1700 * dt; p.y = Math.min(GROUND, p.y + p.vy * dt); if (p.y >= GROUND) p.vy = 0;
        p.hurt = Math.max(0, p.hurt - dt);
        for (const f of flakes){ f.y += 30 * f.s * dt; f.x -= (SPEED * .6 + 20) * f.s * dt; if (f.y > H) f.y -= H; if (f.x < 0) f.x += W; }
        const me = body();
        for (const o of obs){
          if (o.hitDone) continue;
          const sx = o.x - dist + p.x;
          // the box that knocks you down is the drawn box, with one pixel of grace on each side
          if (p.hurt <= 0 && overlap(me, { x: sx + 1, y: GROUND - o.h + 1, w: o.w - 2, h: o.h - 1 })){
            o.hitDone = true; lives--; p.hurt = 1; api.sound('bad');
            if (lives <= 0) return api.lose('Three knocks. You slipped and went down on the icy deck.');
          }
        }
        api.status(`Lives: ${'♥'.repeat(lives)} · Distance to the bow: ${Math.ceil((LEN - dist) / 10)} m`);
        if (dist >= LEN) api.win('You reached the bow.');
      },
      draw(){
        g.drawImage(night, 0, 0, W, 205);
        // glints of starlight on the sea move slowly past
        g.fillStyle = 'rgba(200,220,240,.18)';
        for (let i = 0; i < 14; i++){ const x = ((i * 97 - dist * .15) % (W + 40) + W + 40) % (W + 40) - 20; g.fillRect(x, 176 + (i % 4) * 7, 10 + (i % 3) * 6, 1); }
        g.fillStyle = '#04080f'; g.fillRect(0, 205, W, GROUND - 205);   // the dark sea seen low through the railing
        // the ship, in tiles that scroll with the deck (world x = screen x - p.x + dist)
        const wx0 = dist - p.x, first = Math.floor(wx0 / TW), last = Math.floor((wx0 + W) / TW);
        for (let i = first; i <= last + 1; i++){ const cv = tile(i); if (i <= last) g.drawImage(cv, Rn(i * TW - wx0), 0, TW, H); }
        for (const k of [...tiles.keys()]) if (k < first - 1) tiles.delete(k);
        for (const o of obs){ const sx = o.x - dist + p.x; if (sx > -60 && sx < W + 60) drawObstacle(o, sx); }
        // the sailor, breathing out little clouds in the cold
        if (!(p.hurt > 0 && Math.floor(p.hurt * 10) % 2)){
          g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(p.x + 2, GROUND + 1, 11 - (GROUND - p.y) * .05, 2.2, 0, 0, 7); g.fill();
          const s = drawSailor(g, p.x, p.y, t, p.y < GROUND - .5, p.vy);
          if (breath < .5){ g.fillStyle = `rgba(235,245,255,${.55 - breath})`; g.beginPath(); g.arc(s.mouth[0] + 4 + breath * 20, s.mouth[1] - breath * 6, 2.5 + breath * 8, 0, 7); g.fill(); }
        }
        g.fillStyle = 'rgba(255,255,255,.8)'; for (const f of flakes){ g.beginPath(); g.arc(f.x, f.y, f.s * 1.3, 0, 7); g.fill(); }
        g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(20, 14, W - 40, 6); g.fillStyle = '#ff7a1a'; g.fillRect(20, 14, Rn((W - 40) * dist / LEN), 6);
      }
    };
  };

  // ### 5. Deck climb: bounce up through the ship, from the boiler rooms at the bottom, past the crew quarters, second class
  // ### and first class, to the boat deck with its funnels at the top. Each level is painted once, in detail, on its own
  // ### canvas when the game starts, so drawing a frame costs only five pictures and the platforms.
  const CLIMB_LEVELS = [
    { id: 'engine', name: 'Engine room' }, { id: 'crew', name: 'Crew quarters' }, { id: 'second', name: 'Second class' },
    { id: 'first', name: 'First class' }, { id: 'deck', name: 'Boat deck' }
  ];
  // ### Paints one level of the ship on g (w x h, the level's own coordinates). r is a fixed random sequence.
  function paintLevel(id, g, w, h, r){
    const rivets = (y0, y1, step, color) => { g.fillStyle = color; for (let y = y0; y < y1; y += step) for (let x = 6; x < w; x += 18) { g.beginPath(); g.arc(x, y, 1.3, 0, 7); g.fill(); } };
    const porthole = (x, y, rad, glass) => {
      g.fillStyle = '#b08a3e'; g.beginPath(); g.arc(x, y, rad + 3, 0, 7); g.fill();
      const gl = g.createRadialGradient(x - rad * .3, y - rad * .3, 1, x, y, rad); gl.addColorStop(0, glass[0]); gl.addColorStop(1, glass[1]);
      g.fillStyle = gl; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
      g.fillStyle = '#6e5424'; for (let k = 0; k < 6; k++){ const a = k * Math.PI / 3; g.beginPath(); g.arc(x + Math.cos(a) * (rad + 1.5), y + Math.sin(a) * (rad + 1.5), 1, 0, 7); g.fill(); }
    };
    const lamp = (x, y, color, glow) => {
      const gr = g.createRadialGradient(x, y, 1, x, y, glow); gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - glow, y - glow, glow * 2, glow * 2);
      g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
    };
    if (id === 'engine'){
      // riveted steel bulkheads in the heat of the furnaces
      const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#2a2522'); bg.addColorStop(1, '#3b2a20');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 2; for (let y = 40; y < h; y += 80){ g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let x = 60; x < w; x += 120){ g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      rivets(46, h, 80, 'rgba(160,140,120,.35)');
      // three Scotch boilers with glowing furnace doors at the bottom
      for (let k = 0; k < 3; k++){
        const bx = 20 + k * 112, by = h - 150;
        const bgr = g.createLinearGradient(bx, 0, bx + 96, 0); bgr.addColorStop(0, '#3a332e'); bgr.addColorStop(.45, '#6d625a'); bgr.addColorStop(1, '#2b2522');
        g.fillStyle = bgr; g.beginPath(); g.ellipse(bx + 48, by + 60, 48, 70, 0, 0, 7); g.fill();
        g.strokeStyle = '#2a2420'; g.lineWidth = 1.5; for (let a = 0; a < 3; a++){ g.beginPath(); g.ellipse(bx + 48, by + 60, 48, 70 - a * 20, 0, 0, 7); g.stroke(); }
        for (let d = 0; d < 2; d++){
          const fx = bx + 22 + d * 30, fy = by + 92;
          const fire = g.createRadialGradient(fx + 9, fy + 10, 1, fx + 9, fy + 10, 30); fire.addColorStop(0, 'rgba(255,190,80,.9)'); fire.addColorStop(1, 'rgba(255,90,20,0)');
          g.fillStyle = fire; g.fillRect(fx - 22, fy - 20, 62, 62);
          g.fillStyle = '#1b1612'; g.fillRect(fx, fy, 18, 20); g.fillStyle = '#ff9a30'; for (let s = 0; s < 4; s++) g.fillRect(fx + 2, fy + 3 + s * 4, 14, 2);
        }
        g.fillStyle = '#ddd'; g.beginPath(); g.arc(bx + 48, by + 22, 7, 0, 7); g.fill(); g.strokeStyle = '#c0392b'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(bx + 48, by + 22); g.lineTo(bx + 52, by + 17); g.stroke();
      }
      // coal heaps and a shovel
      g.fillStyle = '#121212'; for (let k = 0; k < 4; k++){ g.beginPath(); g.ellipse(40 + k * 95, h - 4, 34, 12, 0, Math.PI, 0); g.fill(); }
      // pipes with valves and gauges
      g.lineCap = 'round';
      for (let k = 0; k < 4; k++){
        const py = 40 + k * 78, col = ['#8a5a3a', '#6f7478', '#8a5a3a', '#5d6a72'][k];
        g.strokeStyle = col; g.lineWidth = 9; g.beginPath(); g.moveTo(-5, py); g.lineTo(w + 5, py); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-5, py - 3); g.lineTo(w + 5, py - 3); g.stroke();
        for (let x = 30 + k * 23; x < w; x += 110){ g.fillStyle = '#4b4b4b'; g.fillRect(x - 3, py - 7, 6, 14); }
        const vx = 70 + r() * (w - 140);
        g.strokeStyle = '#b03a2e'; g.lineWidth = 2.5; g.beginPath(); g.arc(vx, py - 15, 8, 0, 7); g.moveTo(vx - 8, py - 15); g.lineTo(vx + 8, py - 15); g.moveTo(vx, py - 23); g.lineTo(vx, py - 7); g.stroke();
      }
      g.strokeStyle = '#7d6a4c'; g.lineWidth = 7; g.beginPath(); g.moveTo(w - 30, 0); g.lineTo(w - 30, h - 160); g.quadraticCurveTo(w - 30, h - 140, w - 50, h - 140); g.stroke();
      for (let k = 0; k < 3; k++){ const gx = 40 + k * 130, gy = 150 + (k % 2) * 90; g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(gx, gy, 13, 0, 7); g.fill(); g.fillStyle = '#efe6cf'; g.beginPath(); g.arc(gx, gy, 10, 0, 7); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + 6 * Math.cos(r() * 6), gy + 6 * Math.sin(r() * 6)); g.stroke(); }
      // steam and the red glow of the stokehold
      for (let k = 0; k < 10; k++){ g.fillStyle = `rgba(220,220,220,${.05 + r() * .06})`; g.beginPath(); g.arc(r() * w, r() * h * .7, 14 + r() * 26, 0, 7); g.fill(); }
      const heat = g.createLinearGradient(0, h, 0, h - 220); heat.addColorStop(0, 'rgba(255,90,20,.32)'); heat.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = heat; g.fillRect(0, h - 220, w, 220);
      lamp(w * .3, 18, 'rgba(255,200,120,.5)', 40); lamp(w * .75, 18, 'rgba(255,200,120,.5)', 40);
    } else if (id === 'crew'){
      // painted steel, rivets, bunks, lockers and portholes
      g.fillStyle = '#7c8a7c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#5d6a5e'; g.fillRect(0, 0, w, 14); for (let y = 130; y < h; y += 130) g.fillRect(0, y, w, 6);
      g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1; for (let x = 0; x < w; x += 60){ g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      rivets(20, h, 65, 'rgba(40,50,40,.35)');
      for (let row = 0; row < 4; row++){
        const y0 = 24 + row * 130;
        // a two-high bunk with blankets and a pillow
        const bx = row % 2 ? 190 : 20;
        g.fillStyle = '#4a4f4a'; g.fillRect(bx, y0 + 10, 4, 96); g.fillRect(bx + 140, y0 + 10, 4, 96);
        for (let b = 0; b < 2; b++){
          const yy = y0 + 40 + b * 48;
          g.fillStyle = '#3d423d'; g.fillRect(bx, yy, 144, 5);
          g.fillStyle = ['#7a2e2a', '#2e4a6a', '#5b5236'][(row + b) % 3]; g.fillRect(bx + 4, yy - 9, 136, 9);
          g.fillStyle = '#e9e4d6'; g.fillRect(bx + 8, yy - 13, 26, 9);
        }
        // lockers
        const lx = row % 2 ? 22 : 196;
        for (let l = 0; l < 4; l++){
          g.fillStyle = '#5f6c6f'; g.fillRect(lx + l * 34, y0 + 24, 31, 86);
          g.fillStyle = 'rgba(0,0,0,.35)'; for (let v = 0; v < 4; v++) g.fillRect(lx + l * 34 + 6, y0 + 32 + v * 4, 19, 1.5);
          g.fillStyle = '#c9b46a'; g.fillRect(lx + l * 34 + 24, y0 + 64, 3, 8);
        }
        porthole(row % 2 ? 160 : 180, y0 + 6, 9, ['#3c5f85', '#0d1b2c']);
        lamp(row % 2 ? 100 : 270, y0 + 2, 'rgba(255,220,140,.55)', 34);
      }
      // a coat hanging on a hook, a sign
      g.fillStyle = '#efe6cf'; g.fillRect(w - 118, 2, 108, 12); g.fillStyle = '#2a2418'; g.font = '700 9px Arial, sans-serif'; g.fillText('CREW ONLY · E DECK', w - 113, 11);
    } else if (id === 'second'){
      // oak panelling, white ceiling beams, cabin doors, a library corner
      const bg = g.createLinearGradient(0, 0, w, 0); bg.addColorStop(0, '#6b4526'); bg.addColorStop(.5, '#865a33'); bg.addColorStop(1, '#6b4526');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 45){ g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(255,220,170,.06)'; g.fillRect(x + 6, 0, 30, h); }
      g.strokeStyle = 'rgba(40,20,8,.35)'; g.lineWidth = 1; for (let k = 0; k < 120; k++){ const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 4, y + 10, x, y + 22); g.stroke(); }
      for (let y = 0; y < h; y += 130){ g.fillStyle = '#eee7d6'; g.fillRect(0, y, w, 10); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, y + 10, w, 3); }
      for (let row = 0; row < 4; row++){
        const y0 = 14 + row * 130;
        // two cabin doors with brass numbers
        for (let d = 0; d < 2; d++){
          if (row === 3 && d === 1) continue;   // the bookcase stands there
          const dx = row % 2 ? 40 + d * 200 : 110 + d * 160;
          g.fillStyle = '#4a2e18'; g.fillRect(dx, y0 + 18, 48, 96); g.strokeStyle = '#c9a052'; g.lineWidth = 1.5; g.strokeRect(dx + 6, y0 + 26, 36, 36); g.strokeRect(dx + 6, y0 + 68, 36, 38);
          g.fillStyle = '#d8b25a'; g.beginPath(); g.arc(dx + 40, y0 + 70, 2.5, 0, 7); g.fill();
          g.font = '700 10px Georgia, serif'; g.fillText('D' + (40 + row * 4 + d * 2), dx + 14, y0 + 14);
        }
        // wall lamps with pleated shades
        for (let l = 0; l < 2; l++){ const lx = row % 2 ? 150 + l * 160 : 70 + l * 200; lamp(lx, y0 + 40, 'rgba(255,214,150,.5)', 30); g.fillStyle = '#efe0c0'; g.beginPath(); g.moveTo(lx - 7, y0 + 34); g.lineTo(lx + 7, y0 + 34); g.lineTo(lx + 10, y0 + 44); g.lineTo(lx - 10, y0 + 44); g.fill(); }
        porthole(row % 2 ? 330 : 30, y0 + 50, 10, ['#5b7fa6', '#13253a']);
      }
      // a bookcase in the library
      g.fillStyle = '#3c2412'; g.fillRect(236, h - 108, 90, 96);
      for (let s = 0; s < 3; s++) for (let b = 0; b < 9; b++){ g.fillStyle = ['#7a2e2a', '#2e4a6a', '#5b5236', '#3a5a3a', '#8a6a2a'][(s + b) % 5]; g.fillRect(240 + b * 9.5, h - 102 + s * 29, 8, 24); }
      g.fillStyle = '#2f5a3a'; g.fillRect(0, h - 12, w, 12);
    } else if (id === 'first'){
      // the Grand Staircase: white and gold panels, arched windows, the clock "Honour and Glory", a chandelier, red carpet
      g.fillStyle = '#efe6cf'; g.fillRect(0, 0, w, h);
      for (let x = 10; x < w; x += 70) for (let y = 10; y < h; y += 100){
        g.strokeStyle = '#c9a052'; g.lineWidth = 2; g.strokeRect(x, y, 56, 84); g.strokeStyle = 'rgba(160,120,50,.4)'; g.lineWidth = 1; g.strokeRect(x + 5, y + 5, 46, 74);
        g.strokeStyle = 'rgba(160,120,50,.5)'; g.beginPath(); g.moveTo(x + 28, y + 24); g.bezierCurveTo(x + 14, y + 34, x + 42, y + 50, x + 28, y + 60); g.stroke();
      }
      // arched windows with the glow of the sea at night
      for (let k = 0; k < 2; k++){
        const ax = 40 + k * 220, ay = 60;
        g.fillStyle = '#c9a052'; g.beginPath(); g.moveTo(ax - 4, ay + 120); g.lineTo(ax - 4, ay + 30); g.arc(ax + 36, ay + 30, 40, Math.PI, 0); g.lineTo(ax + 76, ay + 120); g.fill();
        const gl = g.createLinearGradient(0, ay, 0, ay + 120); gl.addColorStop(0, '#1b2f52'); gl.addColorStop(1, '#4f6f9a');
        g.fillStyle = gl; g.beginPath(); g.moveTo(ax, ay + 116); g.lineTo(ax, ay + 30); g.arc(ax + 36, ay + 30, 36, Math.PI, 0); g.lineTo(ax + 72, ay + 116); g.fill();
        g.strokeStyle = '#c9a052'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(ax + 36, ay - 6); g.lineTo(ax + 36, ay + 116); g.moveTo(ax, ay + 60); g.lineTo(ax + 72, ay + 60); g.stroke();
      }
      // the carved clock
      const cx = w / 2, cy = 260;
      g.fillStyle = '#7a5428'; g.fillRect(cx - 60, cy - 46, 120, 92);
      g.fillStyle = '#9a6f38'; g.beginPath(); g.ellipse(cx - 40, cy, 14, 36, 0, 0, 7); g.ellipse(cx + 40, cy, 14, 36, 0, 0, 7); g.fill();
      g.fillStyle = '#f7f1df'; g.beginPath(); g.arc(cx, cy, 22, 0, 7); g.fill(); g.strokeStyle = '#3a2a10'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 22, 0, 7); g.moveTo(cx, cy); g.lineTo(cx, cy - 15); g.moveTo(cx, cy); g.lineTo(cx + 10, cy + 4); g.stroke();
      g.fillStyle = '#3a2a10'; g.font = 'italic 9px Georgia, serif'; g.textAlign = 'center'; g.fillText('Honour and Glory', cx, cy + 40); g.textAlign = 'start';
      // a chandelier
      const chx = w / 2, chy = 60;
      g.strokeStyle = '#b08a3e'; g.lineWidth = 2; g.beginPath(); g.moveTo(chx, 0); g.lineTo(chx, chy); g.stroke();
      for (let k = -3; k <= 3; k++){ g.beginPath(); g.moveTo(chx, chy); g.quadraticCurveTo(chx + k * 10, chy + 18, chx + k * 14, chy + 8); g.stroke(); lamp(chx + k * 14, chy + 6, 'rgba(255,230,160,.55)', 18); }
      for (let k = 0; k < 14; k++){ g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(chx - 36 + k * 5.5, chy + 22 + Math.sin(k) * 3, 1.6, 0, 7); g.fill(); }
      // oil paintings and the gilded balustrade at the bottom
      g.fillStyle = '#b08a3e'; g.fillRect(30, 360, 70, 56); g.fillRect(w - 100, 360, 70, 56);
      g.fillStyle = '#4f6a5a'; g.fillRect(36, 366, 58, 44); g.fillStyle = '#7a4a3a'; g.fillRect(w - 94, 366, 58, 44);
      g.fillStyle = '#e0c48a'; g.beginPath(); g.arc(65, 392, 6, 0, 7); g.fill(); g.fillStyle = '#32503e'; g.fillRect(w - 94, 396, 58, 14);
      g.fillStyle = '#8c1d1d'; g.fillRect(0, h - 26, w, 26); g.fillStyle = '#c9a052'; g.fillRect(0, h - 28, w, 3);
      for (let x = 6; x < w; x += 16){ g.fillStyle = '#c9a052'; g.fillRect(x, h - 60, 3, 32); g.beginPath(); g.arc(x + 1.5, h - 60, 3, 0, 7); g.fill(); }
      g.fillStyle = '#7a5428'; g.fillRect(0, h - 64, w, 5);
    } else {
      // the boat deck at night: stars, funnels with smoke, lifeboats in their davits, ventilators, a mast and the railing
      const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#081329'); sky.addColorStop(.7, '#1e3560'); sky.addColorStop(1, '#3a5480');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 120; k++){ g.fillStyle = `rgba(255,255,255,${.3 + r() * .7})`; g.fillRect(r() * w, r() * h * .7, 1.5, 1.5); }
      g.fillStyle = '#f3ecd0'; g.beginPath(); g.arc(w - 60, 60, 18, 0, 7); g.fill();
      for (let k = 0; k < 4; k++){
        const fx = 22 + k * 84, fy = h - 330;
        g.fillStyle = 'rgba(60,60,66,.55)'; for (let s = 0; s < 5; s++){ g.beginPath(); g.arc(fx + 26 - s * 10, fy - 14 - s * 18, 12 + s * 5, 0, 7); g.fill(); }
        const fg = g.createLinearGradient(fx, 0, fx + 56, 0); fg.addColorStop(0, '#b07c2a'); fg.addColorStop(.4, '#e0aa4c'); fg.addColorStop(1, '#9a6a24');
        g.fillStyle = fg; g.fillRect(fx, fy, 56, 230); g.fillStyle = '#151515'; g.fillRect(fx, fy, 56, 40);
        g.fillStyle = 'rgba(0,0,0,.25)'; for (let b = 0; b < 3; b++) g.fillRect(fx, fy + 70 + b * 50, 56, 2);
      }
      // the officers' quarters and the wheelhouse
      g.fillStyle = '#ece8dc'; g.fillRect(0, h - 120, w, 70); g.fillStyle = '#7a5428'; for (let x = 10; x < w; x += 26) g.fillRect(x, h - 104, 14, 16);
      // lifeboats in davits
      for (let k = 0; k < 4; k++){
        const lx = 14 + k * 88, ly = h - 150;
        g.strokeStyle = '#ddd'; g.lineWidth = 3; g.beginPath(); g.moveTo(lx, ly + 40); g.quadraticCurveTo(lx, ly - 8, lx + 14, ly - 8); g.moveTo(lx + 70, ly + 40); g.quadraticCurveTo(lx + 70, ly - 8, lx + 56, ly - 8); g.stroke();
        g.fillStyle = '#f5f2ea'; g.beginPath(); g.moveTo(lx + 4, ly + 4); g.lineTo(lx + 66, ly + 4); g.quadraticCurveTo(lx + 60, ly + 22, lx + 35, ly + 22); g.quadraticCurveTo(lx + 10, ly + 22, lx + 4, ly + 4); g.fill();
        g.fillStyle = '#8f2a20'; g.fillRect(lx + 6, ly + 4, 58, 3);
      }
      // ventilator cowls
      for (let k = 0; k < 3; k++){ const vx = 60 + k * 110, vy = h - 70; g.fillStyle = '#f0ebe0'; g.fillRect(vx, vy - 26, 8, 26); g.beginPath(); g.arc(vx + 10, vy - 28, 10, Math.PI * .6, Math.PI * 2.1); g.fill(); g.fillStyle = '#8f2a20'; g.beginPath(); g.arc(vx + 12, vy - 30, 5, 0, 7); g.fill(); }
      g.fillStyle = '#b98a57'; g.fillRect(0, h - 50, w, 50);
      g.strokeStyle = '#8f6539'; g.lineWidth = 1; for (let y = h - 44; y < h; y += 8){ g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    }
  }
  // ### How each level's platforms look: steel grating, steel shelves, oak planks, red carpet on gilded marble, teak.
  function paintPlatform(g, level, x, y, w){
    if (level === 'engine'){
      g.fillStyle = '#4a4a4a'; g.fillRect(x, y, w, 8);
      g.strokeStyle = '#2a2a2a'; g.lineWidth = 1; for (let k = 4; k < w; k += 6){ g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k - 4, y + 8); g.stroke(); }
      g.fillStyle = '#e0b030'; g.fillRect(x, y, w, 2);
      g.strokeStyle = '#7a7a7a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 2, y - 12); g.lineTo(x + w - 2, y - 12); g.moveTo(x + 2, y - 12); g.lineTo(x + 2, y); g.moveTo(x + w - 2, y - 12); g.lineTo(x + w - 2, y); g.stroke();
    } else if (level === 'crew'){
      g.fillStyle = '#5c6466'; g.fillRect(x, y, w, 8); g.fillStyle = '#879092'; g.fillRect(x, y, w, 2);
      g.fillStyle = '#2f3537'; for (let k = 5; k < w; k += 12){ g.beginPath(); g.arc(x + k, y + 5, 1.2, 0, 7); g.fill(); }
      g.fillStyle = '#3f4547'; g.fillRect(x + 6, y + 8, 3, 6); g.fillRect(x + w - 9, y + 8, 3, 6);
    } else if (level === 'second'){
      const og = g.createLinearGradient(0, y, 0, y + 9); og.addColorStop(0, '#a87442'); og.addColorStop(1, '#5e3a1c');
      g.fillStyle = og; g.fillRect(x, y, w, 9);
      g.strokeStyle = 'rgba(40,20,8,.5)'; g.lineWidth = 1; for (let k = 18; k < w; k += 22){ g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k, y + 9); g.stroke(); }
      g.strokeStyle = '#c9a052'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x + w, y - 10); g.stroke();
      g.lineWidth = 1.2; for (let k = 4; k < w; k += 10){ g.beginPath(); g.moveTo(x + k, y - 10); g.lineTo(x + k, y); g.stroke(); }
    } else if (level === 'first'){
      g.fillStyle = '#f2ece0'; g.fillRect(x, y + 4, w, 6); g.fillStyle = '#c9a052'; g.fillRect(x, y + 9, w, 2);
      g.fillStyle = '#9c1f22'; g.fillRect(x + 3, y, w - 6, 5); g.fillStyle = '#d6b45a'; g.fillRect(x + 3, y, w - 6, 1);
      g.strokeStyle = '#c9a052'; g.lineWidth = 1.5; for (let k = 6; k < w; k += 12){ g.beginPath(); g.moveTo(x + k, y); g.quadraticCurveTo(x + k + 3, y - 6, x + k, y - 12); g.stroke(); }
      g.fillStyle = '#7a5428'; g.fillRect(x, y - 14, w, 3);
    } else {
      g.fillStyle = '#c4935e'; g.fillRect(x, y, w, 9);
      g.strokeStyle = '#8f6539'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y + 4.5); g.lineTo(x + w, y + 4.5); g.stroke();
      g.strokeStyle = '#f1ece2'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + w, y - 9); g.stroke();
      for (let k = 4; k < w; k += 12){ g.beginPath(); g.moveTo(x + k, y - 9); g.lineTo(x + k, y); g.stroke(); }
    }
  }
  BUILD.deckclimb = api => {
    const W = 360, H = 480, GOAL = 2000, BOTTOM = H - 30, TOP = -GOAL - 80;
    const c = api.canvas(W, H), g = c.getContext('2d');
    // the five levels share the height from the boiler floor to the boat deck; the deck level also holds the sky above it
    const bandH = Math.ceil((BOTTOM - TOP) / 5);
    const levelAt = y => CLIMB_LEVELS[clampN(Math.floor((BOTTOM - y) / bandH), 0, 4)].id;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bands = CLIMB_LEVELS.map((lv, i) => {
      const top = BOTTOM - (i + 1) * bandH - (i === 4 ? 400 : 0), h = BOTTOM - i * bandH - top;
      const cv = document.createElement('canvas'); cv.width = W * dpr; cv.height = h * dpr;
      const bg = cv.getContext('2d'); bg.scale(dpr, dpr);
      paintLevel(lv.id, bg, W, h, seq(1912 + i * 7));
      return { ...lv, top, h, cv };
    });
    const p = { x: W / 2, y: H - 60, vx: 0, vy: -760 };
    let camY = 0, best = 0, steer = 0, aim = null, shown = '', face = 1, t = 0;
    const plats = [{ x: 0, y: BOTTOM, w: W, move: 0, floor: true }];
    for (let y = H - 110; y > -GOAL - 40; y -= 62 + api.rand() * 34){
      const w = 70 + api.rand() * 30;
      plats.push({ x: api.rand() * (W - w), y, w, move: api.rand() < .2 ? (api.rand() < .5 ? -60 : 60) : 0, spring: api.rand() < .08 });
    }
    plats.push({ x: 0, y: TOP, w: W, move: 0, top: true });
    plats.forEach(pl => { pl.level = pl.top ? 'deck' : levelAt(pl.y); });
    return {
      key(code, down){
        if (code === 'ArrowLeft' || code === 'KeyA') steer = down ? -1 : (steer === -1 ? 0 : steer);
        if (code === 'ArrowRight' || code === 'KeyD') steer = down ? 1 : (steer === 1 ? 0 : steer);
        if (down) aim = null;
      },
      point(x, y, type){ if (type === 'move' || type === 'down') aim = x; },
      start(){ api.status('Engine room · climb to the boat deck.'); },
      update(dt){
        const target = aim !== null ? clampN((aim - p.x) * 6, -330, 330) : steer * 330;
        p.vx += (target - p.vx) * Math.min(1, dt * 10);
        p.x += p.vx * dt; if (p.x < -10) p.x += W + 20; if (p.x > W + 10) p.x -= W + 20;
        if (Math.abs(p.vx) > 30) face = Math.sign(p.vx);
        t += dt;
        const prevY = p.y;
        p.vy += 1500 * dt; p.y += p.vy * dt;
        for (const pl of plats){
          if (pl.move){ pl.x += pl.move * dt; if (pl.x < 0 || pl.x + pl.w > W) pl.move = -pl.move; }
          if (p.vy > 0 && prevY <= pl.y && p.y >= pl.y && p.x > pl.x - 8 && p.x < pl.x + pl.w + 8){
            if (pl.top){ p.y = pl.y; p.vy = 0; return api.win('You made it out onto the boat deck.'); }
            p.y = pl.y; p.vy = pl.spring ? -1150 : -760; api.sound(pl.spring ? 'good' : 'jump');
          }
        }
        camY = Math.min(camY, p.y - H * .45);
        best = Math.max(best, H - 60 - p.y);
        const here = CLIMB_LEVELS.find(l => l.id === levelAt(p.y)).name;
        if (here !== shown && shown) api.sound('tick');
        shown = here;
        api.status(`${here} · ${Math.max(0, Math.round(best / 10))} m of ${GOAL / 10} m`);
        if (p.y - camY > H + 40) api.lose('You fell back down into the boiler room.');
      },
      draw(){
        g.fillStyle = '#05080c'; g.fillRect(0, 0, W, H);
        for (const b of bands) if (b.top - camY < H && b.top + b.h - camY > 0) g.drawImage(b.cv, 0, b.top - camY, W, b.h);
        // the steel deck between two levels
        g.fillStyle = '#1d1f21';
        for (let i = 1; i < 5; i++){ const y = BOTTOM - i * bandH - camY; if (y > -10 && y < H + 10){ g.fillRect(0, y - 5, W, 10); g.fillStyle = '#5a5e62'; g.fillRect(0, y - 5, W, 2); g.fillStyle = '#1d1f21'; } }
        g.save(); g.translate(0, -camY);
        for (const pl of plats){
          if (pl.y - camY < -30 || pl.y - camY > H + 30) continue;
          if (pl.floor){ g.fillStyle = '#2a2420'; g.fillRect(0, pl.y, W, 40); g.fillStyle = '#e0b030'; g.fillRect(0, pl.y, W, 2); continue; }
          if (pl.top){ g.fillStyle = '#c4935e'; g.fillRect(0, pl.y, W, 14); continue; }
          paintPlatform(g, pl.level, pl.x, pl.y, pl.w);
          if (pl.spring) drawBuoy(g, pl.x + pl.w / 2, pl.y - 4, 7);
        }
        // the climber: the same sailor as on the deck run, facing the way he moves, in a little warm light so that his
        // navy uniform stands out against the dark engine room and the night sky
        const lit = g.createRadialGradient(p.x, p.y - 24, 2, p.x, p.y - 24, 34); lit.addColorStop(0, 'rgba(255,226,170,.22)'); lit.addColorStop(1, 'rgba(255,226,170,0)');
        g.fillStyle = lit; g.fillRect(p.x - 34, p.y - 58, 68, 68);
        g.save(); g.translate(p.x, p.y); g.scale(face * .74, .74);
        drawSailorPose(g, 0, 0, t, climbPose(p.vy));
        g.restore();
        g.restore();
        // the level you are in, and how far there is still to climb
        g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(W - 16, 20, 8, H - 40);
        CLIMB_LEVELS.forEach((lv, i) => { const y = 20 + (H - 40) * (1 - (i + 1) / 5); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(W - 19, y, 14, 1); });
        g.fillStyle = '#ff7a1a'; const f = clampN(best / GOAL, 0, 1); g.fillRect(W - 16, 20 + (H - 40) * (1 - f), 8, (H - 40) * f);
        g.fillStyle = 'rgba(10,13,15,.75)'; g.fillRect(8, 8, 128, 22);
        g.fillStyle = '#ff7a1a'; g.font = '700 12px "JetBrains Mono", monospace'; g.fillText(shown.toUpperCase() || 'ENGINE ROOM', 14, 23);
      }
    };
  };

  // ### 6. Seagull: fly over the black, icy sea where the Titanic sank, between icebergs and clouds; the ship sails in the
  // ### distance with all her lights on. What you can hit is what you see: the outline of each iceberg and the round puffs
  // ### of each cloud.
  BUILD.seagull = api => {
    const W = 640, H = 360, SEA = 300, GAP = 128, SPEED = 175, NEED = 10, TOP = 16;
    const c = api.canvas(W, H), g = c.getContext('2d');
    const night = paintNight(W, H, SEA, 1415);
    const b = { x: 150, y: 160, vy: 0, f: 0 };
    let started = false, passed = 0, scroll = 0;
    const pipes = [];
    for (let i = 0; i < NEED + 2; i++){
      const gap = 95 + api.rand() * (SEA - 95 - GAP - 30);
      pipes.push({ x: 520 + i * 230, gap, clouds: cloudStack(gap, api.rand) });
    }
    const floes = Array.from({ length: 10 }, (_, i) => ({ x: i * 70 + api.rand() * 40, y: SEA + 10 + api.rand() * 50, w: 10 + api.rand() * 22 }));
    const flap = () => { if (api.over) return; started = true; b.vy = -330; api.sound('jump'); };
    const bergOf = (pp, x) => icebergPoly(x + 2, SEA + 6, 54, SEA + 6 - (pp.gap + GAP));
    function drawClouds(clouds, x0){
      for (const cl of clouds){
        const cx = x0 + cl.dx, cy = cl.dy;
        // the shaded underside first, then the moonless-night grey of the cloud, then a cold rim of starlight on top
        g.fillStyle = '#3c4a5c'; for (const p of cl.puffs){ g.beginPath(); g.arc(cx + p.dx, cy + p.dy + 2, p.r, 0, 7); g.fill(); }
        g.fillStyle = '#6a7b8f'; for (const p of cl.puffs){ g.beginPath(); g.arc(cx + p.dx, cy + p.dy, p.r - 1, 0, 7); g.fill(); }
        g.fillStyle = 'rgba(190,210,230,.35)'; for (const p of cl.puffs){ g.beginPath(); g.arc(cx + p.dx - 2, cy + p.dy - 3, p.r * .6, 0, 7); g.fill(); }
      }
    }
    return {
      key(code, down){ if (down && (code === 'Space' || code === 'ArrowUp' || code === 'KeyW')) flap(); },
      point(x, y, type){ if (type === 'down') flap(); },
      start(){ api.status(`Flap to take off. Gaps: 0 of ${NEED}`); },
      update(dt){
        b.f += dt * (started ? 14 : 6);
        if (!started){ b.y = 160 + Math.sin(b.f * .5) * 6; return; }
        scroll += SPEED * dt;
        for (const f of floes){ f.x -= SPEED * .9 * dt; if (f.x < -40) f.x += W + 80; }
        b.vy = Math.min(520, b.vy + 1100 * dt); b.y += b.vy * dt;
        if (b.y < TOP){ b.y = TOP; b.vy = 0; }
        for (const pp of pipes){
          const x = pp.x - scroll;
          if (!pp.done && x + 50 < b.x){ pp.done = true; passed++; api.sound('tick'); api.status(`Gaps: ${passed} of ${NEED}`); if (passed >= NEED) return api.win('Ten gaps. The seagull is through.'); }
          if (x > b.x + 60 || x < b.x - 80) continue;
          const poly = bergOf(pp, x);
          const hitIce = [[0, 0], [7, 0], [-7, 0], [0, 5], [0, -5], [5, 4], [-5, 4]].some(([dx, dy]) => inPoly(poly, b.x + dx, b.y + dy));
          if (hitIce || hitsClouds(pp.clouds, x + 25, b.x, b.y, 6)) return api.lose('The seagull crashed.');
        }
        if (b.y > SEA - 4) api.lose('The seagull fell into the icy sea.');
      },
      draw(){
        g.drawImage(night, 0, 0, W, H);
        // the Titanic far away with all her lights on, drifting slowly
        g.save(); g.globalAlpha = .9;
        drawTitanic(g, ((380 - scroll * .08) % (W + 330) + W + 330) % (W + 330) - 300, SEA - 1, .9, { lights: true });
        g.fillStyle = 'rgba(4,10,20,.45)'; g.fillRect(0, 150, W, SEA - 150);   // the night over the ship
        g.restore();
        // reflections of the ship's lights and floating ice
        for (const f of floes){ g.fillStyle = 'rgba(225,240,250,.75)'; g.beginPath(); g.ellipse(f.x, f.y, f.w, f.w * .18, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(120,170,200,.4)'; g.fillRect(f.x - f.w * .6, f.y + 1, f.w * 1.2, 1); }
        for (const pp of pipes){
          const x = pp.x - scroll; if (x < -80 || x > W + 60) continue;
          drawClouds(pp.clouds, x + 25);
          const poly = bergOf(pp, x), top = pp.gap + GAP;
          // the much bigger part of the iceberg under the water, then the part you can hit
          g.fillStyle = 'rgba(120,180,210,.18)'; g.beginPath(); g.moveTo(x - 10, SEA + 6); g.lineTo(x + 66, SEA + 6); g.lineTo(x + 50, H); g.lineTo(x + 4, H); g.fill();
          drawIceberg(g, x + 2, SEA + 6, 54, SEA + 6 - top);
          g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(poly[3][0] - 1, poly[3][1] + 2, 2, 6);
        }
        drawGull(g, b.x, b.y, 1.8, b.f, '#ffffff');
        g.fillStyle = '#f2b134'; g.beginPath(); g.moveTo(b.x + 3, b.y - 1); g.lineTo(b.x + 9, b.y + 1); g.lineTo(b.x + 3, b.y + 3); g.fill();
      }
    };
  };

  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  function mix(a, b, t){
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  // ---------- The shell: timer, input, loop ----------
  // ### open(host, id, opts) builds game `id` inside the element host and starts it. opts.onEnd(won, reason) is called once,
  // ### a moment after the game is decided; opts.sound(name) plays a short effect. The returned stop() ends it silently
  // ### (when the player pauses or closes the card), with no result.
  function open(host, id, opts){
    if (!BUILD[id]) throw new Error('Unknown mini game: ' + id);
    opts = opts || {};
    const rand = opts.rand || Math.random;
    host.innerHTML = `<div class="mg" data-game="${id}"><div class="mg-bar"><div class="mg-timer"><i></i></div><output class="mg-secs">${TIME}</output></div>
      <div class="mg-stage"></div><p class="mg-status" aria-live="polite"></p></div>`;
    const stage = host.querySelector('.mg-stage'), bar = host.querySelector('.mg-timer i'), secs = host.querySelector('.mg-secs'), statusEl = host.querySelector('.mg-status');
    let left = TIME, raf = 0, last = 0, timers = [], canvas = null, logical = null, stopped = false, lastStatus = '', resizer = null, game = null;
    const api = {
      rand, stage, over: false,
      status(t){ if (t !== lastStatus){ statusEl.textContent = t; lastStatus = t; } },
      sound(n){ if (opts.sound) opts.sound(n); },
      later(fn, ms){ timers.push(setTimeout(() => { if (!api.over && !stopped) fn(); }, ms)); },
      penalty(s){ left = Math.max(0, left - s); },
      // ### The canvas always has exactly as many pixels as it shows on the screen (fit() runs again when its size changes),
      // ### so the games stay sharp at any size and on high-density screens. The games draw in their own w x h units.
      canvas(w, h){
        canvas = document.createElement('canvas'); logical = { w, h };
        canvas.className = 'mg-canvas'; canvas.style.aspectRatio = `${w} / ${h}`;
        stage.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const fit = () => {
          const r = canvas.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
          const bw = Math.max(w, Math.round((r.width || w) * dpr)), bh = Math.round(bw * h / w);
          if (canvas.width !== bw || canvas.height !== bh){ canvas.width = bw; canvas.height = bh; }
          ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0);
          if (game && game.draw) game.draw();
        };
        fit();
        if (typeof ResizeObserver === 'function'){ resizer = new ResizeObserver(fit); resizer.observe(canvas); }
        return canvas;
      },
      win(reason){ finish(true, reason); },
      lose(reason){ finish(false, reason); }
    };
    game = BUILD[id](api) || {};
    function finish(won, reason){
      if (api.over) return;
      api.over = true; api.status(reason || (won ? 'Won!' : 'Lost.'));
      host.querySelector('.mg').classList.add(won ? 'won' : 'lost');
      api.sound(won ? 'win' : 'lose');
      if (game.draw) game.draw();
      timers.push(setTimeout(() => { if (!stopped){ cleanup(); if (opts.onEnd) opts.onEnd(won, reason); } }, 900));
    }
    const toLogical = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * logical.w, (e.clientY - r.top) / r.height * logical.h]; };
    const onDown = e => { if (!api.over && game.point){ e.preventDefault(); const [x, y] = toLogical(e); game.point(x, y, 'down'); } };
    const onMove = e => { if (!api.over && game.point){ const [x, y] = toLogical(e); game.point(x, y, 'move'); } };
    const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyW'];
    const onKey = e => {
      if (!GAME_KEYS.includes(e.code)) return;
      e.preventDefault();
      if (game.key && !api.over && !(e.repeat && e.type === 'keydown' && (e.code === 'Space' || e.code === 'ArrowUp'))) game.key(e.code, e.type === 'keydown');
    };
    if (canvas){ canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); }
    addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true);
    function loop(now){
      if (stopped) return;
      raf = requestAnimationFrame(loop);
      // the 30 s follow the real clock; the game itself moves in small steps, so a slow frame never lets you skip an iceberg
      const real = Math.min(.25, Math.max(0, (now - last) / 1000)); last = now;
      if (!api.over){
        left = Math.max(0, left - real);
        bar.style.transform = `scaleX(${left / TIME})`;
        const s = String(Math.ceil(left)); if (secs.textContent !== s) secs.textContent = s;
        secs.classList.toggle('low', left <= 5);
        for (let done = 0; game.update && done < real - 1e-6 && !api.over; done += 1 / 60) game.update(Math.min(1 / 60, real - done));
        if (!api.over && left <= 0) finish(false, 'Time is up.');
      }
      if (game.draw) game.draw();
    }
    function cleanup(){
      stopped = true; cancelAnimationFrame(raf); timers.forEach(clearTimeout); timers = [];
      removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKey, true);
      if (resizer) resizer.disconnect();
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (game.start) game.start();
    if (game.draw) game.draw();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return { stop(){ if (!stopped){ api.over = true; cleanup(); } }, get timeLeft(){ return left; } };
  }

  return Object.freeze({ TIME, INFO, GAMES, DIFFS, pickGames, tttWinner, tttBot, placeFleet, fleetSunk, bsBot, around, waterAround, pickDiffs, hitDiff, overlap, icebergPoly, inPoly, cloudStack, hitsClouds, RUN_KINDS, RUN, runLayout, CLIMB_LEVELS, open });
});
