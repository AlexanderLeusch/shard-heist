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
    battleship: { title: 'Sink the <em>fleet</em>', name: 'Battleship', how: 'Fire at the enemy waters on the right. A hit lets you fire again. Sink all three of the bot’s ships before it sinks yours.' },
    spotdiff: { title: 'Spot the <em>difference</em>', name: 'Spot the difference', how: 'Two photographs of the Titanic, five differences. Click them in either picture. A wrong click costs 2 seconds.' },
    tictactoe: { title: 'Anchors and <em>icebergs</em>', name: 'Tic-tac-toe', how: 'You play the anchors, the bot plays the icebergs. Get three in a row. A draw starts a new round.' },
    deckrun: { title: 'Run the <em>deck</em>', name: 'Deck run', how: 'Run to the bow. Jump over deck chairs, crates and barrels with Space, ↑ or a click. Three knocks and you are out.' },
    deckclimb: { title: 'Climb the <em>decks</em>', name: 'Deck climb', how: 'Bounce from deck to deck up to the funnels. Steer with ← → or the mouse. Do not fall into the sea.' },
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
  // ### Battleship: a fleet of straight ships on an n x n grid, no two ships on the same cell. A ship is a list of cell numbers.
  function placeFleet(n, sizes, rand){
    const used = new Set(), ships = [];
    for (const size of sizes){
      for (let tries = 0; tries < 500; tries++){
        const across = rand() < .5, r = Math.floor(rand() * (across ? n : n - size + 1)), c = Math.floor(rand() * (across ? n - size + 1 : n));
        const cells = Array.from({ length: size }, (_, k) => across ? r * n + c + k : (r + k) * n + c);
        if (cells.some(x => used.has(x))) continue;
        cells.forEach(x => used.add(x)); ships.push(cells); break;
      }
    }
    return ships;
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
  // ### An iceberg: a jagged white lump, darker on its shaded side. Its base sits at y.
  function drawIceberg(g, x, y, w, h, flip){
    g.fillStyle = '#e8f4f8';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * .12, y - h * .55); g.lineTo(x + w * .3, y - h * .7); g.lineTo(x + w * .45, y - h); g.lineTo(x + w * .62, y - h * .62); g.lineTo(x + w * .8, y - h * .72); g.lineTo(x + w, y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(120,170,195,.45)';
    g.beginPath(); g.moveTo(x + w * .45, y - h); g.lineTo(x + w * .62, y - h * .62); g.lineTo(x + w * .8, y - h * .72); g.lineTo(x + w, y); g.lineTo(x + w * .5, y); g.closePath(); g.fill();
    if (flip) return;
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
      [...gTheirs.children].forEach((el, i) => {
        const s = shipAt(theirs, i), shot = myShots.has(i);
        el.className = 'bs-cell' + (shot ? (s ? ' hit' : ' miss') : '') + (s && sunk(s, myShots) ? ' ship sunk' : '');
        el.disabled = shot || turn !== 'me';
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
      if (myShots.has(c)) return;
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

  // ### 4. Deck run: run along the boat deck to the bow and jump over what is in the way.
  BUILD.deckrun = api => {
    const W = 640, H = 300, GROUND = 250, LEN = 4400, SPEED = 230;
    const c = api.canvas(W, H), g = c.getContext('2d');
    const p = { x: 90, y: GROUND, vy: 0, hurt: 0 };
    let dist = 0, lives = 3, t = 0;
    const KINDS = [{ k: 'chair', w: 42, h: 24 }, { k: 'crate', w: 30, h: 34 }, { k: 'barrel', w: 26, h: 28 }, { k: 'rope', w: 38, h: 14 }];
    const obs = [];
    for (let x = 520; x < LEN - 200; x += 230 + api.rand() * 170) obs.push({ x, ...KINDS[Math.floor(api.rand() * KINDS.length)] });
    const jump = () => { if (p.y >= GROUND - .5 && !api.over){ p.vy = -610; api.sound('jump'); } };
    return {
      key(code, down){ if (down && (code === 'Space' || code === 'ArrowUp' || code === 'KeyW')) jump(); },
      point(x, y, type){ if (type === 'down') jump(); },
      start(){ api.status(`Lives: ${lives} · Distance to the bow: ${LEN} m`); },
      update(dt){
        t += dt;
        dist = Math.min(LEN, dist + SPEED * dt);
        p.vy += 1700 * dt; p.y = Math.min(GROUND, p.y + p.vy * dt); if (p.y >= GROUND) p.vy = 0;
        p.hurt = Math.max(0, p.hurt - dt);
        const box = { x: p.x - 9, y: p.y - 40, w: 18, h: 40 };
        for (const o of obs){
          if (o.hitDone) continue;
          const sx = o.x - dist + p.x;
          if (p.hurt <= 0 && overlap(box, { x: sx + 3, y: GROUND - o.h + 3, w: o.w - 6, h: o.h - 3 })){
            o.hitDone = true; lives--; p.hurt = 1; api.sound('bad');
            if (lives <= 0) return api.lose('Three knocks. You went down on the deck.');
          }
        }
        api.status(`Lives: ${'♥'.repeat(lives)} · Distance to the bow: ${Math.ceil((LEN - dist) / 10)} m`);
        if (dist >= LEN) api.win('You reached the bow.');
      },
      draw(){
        const sky = g.createLinearGradient(0, 0, 0, 180); sky.addColorStop(0, '#f2a65a'); sky.addColorStop(1, '#ffd9a0');
        g.fillStyle = sky; g.fillRect(0, 0, W, 180);
        g.fillStyle = '#ffe7b0'; g.beginPath(); g.arc(520, 150, 26, 0, 7); g.fill();
        g.fillStyle = '#2f5f86'; g.fillRect(0, 160, W, 40);
        g.strokeStyle = 'rgba(255,230,190,.35)'; for (let i = 0; i < 12; i++){ const x = ((i * 97 - dist * .2) % W + W) % W; g.beginPath(); g.moveTo(x, 172 + i % 3 * 8); g.lineTo(x + 18, 172 + i % 3 * 8); g.stroke(); }
        // funnels and lifeboats passing behind (parallax)
        for (let i = 0; i < 6; i++){
          const fx = ((i * 260 - dist * .55) % 1560 + 1560) % 1560 - 160;
          g.fillStyle = '#d39a3a'; g.fillRect(fx, 40, 46, 160); g.fillStyle = '#151515'; g.fillRect(fx, 40, 46, 22);
        }
        g.fillStyle = '#ece8dc'; g.fillRect(0, 196, W, 20);
        g.fillStyle = '#9aa0a3'; for (let i = 0; i < 8; i++){ const lx = ((i * 120 - dist * .8) % 960 + 960) % 960 - 120; g.beginPath(); g.ellipse(lx + 40, 190, 42, 9, 0, 0, Math.PI); g.fill(); }
        // the deck: planks and the railing
        g.fillStyle = '#b98a57'; g.fillRect(0, GROUND, W, H - GROUND);
        g.strokeStyle = '#8f6539'; g.lineWidth = 1; for (let y = GROUND + 8; y < H; y += 9){ g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
        for (let i = 0; i < 20; i++){ const x = ((i * 48 - dist) % 960 + 960) % 960 - 20; g.beginPath(); g.moveTo(x, GROUND); g.lineTo(x - 12, H); g.stroke(); }
        g.strokeStyle = '#f1ece2'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 222); g.lineTo(W, 222); g.stroke();
        for (let i = 0; i < 24; i++){ const x = ((i * 34 - dist) % 816 + 816) % 816 - 10; g.beginPath(); g.moveTo(x, 222); g.lineTo(x, GROUND); g.stroke(); }
        // the bow
        const bx = LEN - dist + p.x + 40;
        if (bx < W + 40){ g.fillStyle = '#16181a'; g.beginPath(); g.moveTo(bx, GROUND); g.lineTo(bx + 120, 200); g.lineTo(bx + 120, H); g.lineTo(bx, H); g.fill(); g.fillStyle = '#c0392b'; g.fillRect(bx + 20, 150, 4, 100); g.fillRect(bx + 24, 150, 24, 14); }
        // obstacles
        for (const o of obs){
          const sx = o.x - dist + p.x; if (sx < -60 || sx > W + 60) continue;
          const y = GROUND - o.h;
          if (o.k === 'chair'){ g.fillStyle = '#6b3f1f'; g.fillRect(sx, y + 12, o.w, 6); g.fillRect(sx + o.w - 8, y, 6, o.h); g.fillRect(sx + 2, y + 18, 4, 6); g.fillRect(sx + o.w - 12, y + 18, 4, 6); }
          else if (o.k === 'crate'){ g.fillStyle = '#9c6b34'; g.fillRect(sx, y, o.w, o.h); g.strokeStyle = '#5e3d18'; g.lineWidth = 2; g.strokeRect(sx + 1, y + 1, o.w - 2, o.h - 2); g.beginPath(); g.moveTo(sx, y); g.lineTo(sx + o.w, y + o.h); g.stroke(); }
          else if (o.k === 'barrel'){ g.fillStyle = '#7a4a22'; g.fillRect(sx, y, o.w, o.h); g.fillStyle = '#333'; g.fillRect(sx, y + 5, o.w, 3); g.fillRect(sx, y + o.h - 8, o.w, 3); }
          else { g.fillStyle = '#d7c49a'; g.beginPath(); g.ellipse(sx + o.w / 2, y + o.h / 2 + 2, o.w / 2, o.h / 2, 0, 0, 7); g.fill(); g.strokeStyle = '#a8946a'; g.beginPath(); g.ellipse(sx + o.w / 2, y + o.h / 2 + 2, o.w / 4, o.h / 4, 0, 0, 7); g.stroke(); }
        }
        // the runner: an inmate in an orange jumpsuit
        if (!(p.hurt > 0 && Math.floor(p.hurt * 10) % 2)){
          const run = p.y < GROUND ? 0 : Math.sin(t * 16) * 7;
          g.strokeStyle = '#ff7a1a'; g.lineWidth = 6; g.lineCap = 'round';
          g.beginPath(); g.moveTo(p.x, p.y - 16); g.lineTo(p.x + run, p.y); g.moveTo(p.x, p.y - 16); g.lineTo(p.x - run, p.y); g.stroke();
          g.beginPath(); g.moveTo(p.x, p.y - 16); g.lineTo(p.x + 2, p.y - 34); g.stroke();
          g.beginPath(); g.moveTo(p.x + 2, p.y - 30); g.lineTo(p.x + 10 - run * .6, p.y - 20); g.moveTo(p.x + 2, p.y - 30); g.lineTo(p.x - 6 + run * .6, p.y - 20); g.stroke();
          g.fillStyle = '#e8c39e'; g.beginPath(); g.arc(p.x + 3, p.y - 41, 6, 0, 7); g.fill();
        }
        // progress to the bow
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(20, 14, W - 40, 6); g.fillStyle = '#ff7a1a'; g.fillRect(20, 14, (W - 40) * dist / LEN, 6);
      }
    };
  };

  // ### 5. Deck climb: bounce up from deck to deck to the top of the funnels; fall and you are in the sea.
  BUILD.deckclimb = api => {
    const W = 360, H = 480, GOAL = 2000;
    const c = api.canvas(W, H), g = c.getContext('2d');
    const p = { x: W / 2, y: H - 60, vx: 0, vy: -760 };
    let camY = 0, best = 0, steer = 0, aim = null;
    const plats = [{ x: 0, y: H - 30, w: W, move: 0 }];
    for (let y = H - 110; y > -GOAL - 40; y -= 62 + api.rand() * 34){
      const w = 70 + api.rand() * 30;
      plats.push({ x: api.rand() * (W - w), y, w, move: api.rand() < .2 ? (api.rand() < .5 ? -60 : 60) : 0, spring: api.rand() < .08 });
    }
    plats.push({ x: 0, y: -GOAL - 80, w: W, move: 0, top: true });
    return {
      key(code, down){
        if (code === 'ArrowLeft' || code === 'KeyA') steer = down ? -1 : (steer === -1 ? 0 : steer);
        if (code === 'ArrowRight' || code === 'KeyD') steer = down ? 1 : (steer === 1 ? 0 : steer);
        if (down) aim = null;
      },
      point(x, y, type){ if (type === 'move' || type === 'down') aim = x; },
      start(){ api.status('Climb to the funnels.'); },
      update(dt){
        const target = aim !== null ? clampN((aim - p.x) * 6, -330, 330) : steer * 330;
        p.vx += (target - p.vx) * Math.min(1, dt * 10);
        p.x += p.vx * dt; if (p.x < -10) p.x += W + 20; if (p.x > W + 10) p.x -= W + 20;
        const prevY = p.y;
        p.vy += 1500 * dt; p.y += p.vy * dt;
        for (const pl of plats){
          if (pl.move){ pl.x += pl.move * dt; if (pl.x < 0 || pl.x + pl.w > W) pl.move = -pl.move; }
          if (p.vy > 0 && prevY <= pl.y && p.y >= pl.y && p.x > pl.x - 8 && p.x < pl.x + pl.w + 8){
            if (pl.top){ p.y = pl.y; p.vy = 0; return api.win('You reached the funnels.'); }
            p.y = pl.y; p.vy = pl.spring ? -1150 : -760; api.sound(pl.spring ? 'good' : 'jump');
          }
        }
        camY = Math.min(camY, p.y - H * .45);
        best = Math.max(best, H - 60 - p.y);
        api.status(`Height: ${Math.max(0, Math.round(best / 10))} m of ${GOAL / 10} m`);
        if (p.y - camY > H + 40) api.lose('You fell into the sea.');
      },
      draw(){
        const k = clampN(-camY / GOAL, 0, 1);
        const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, mix('#f6b26b', '#0e1b33', k)); sky.addColorStop(1, mix('#ffe0b0', '#3b5a85', k));
        g.fillStyle = sky; g.fillRect(0, 0, W, H);
        g.save(); g.translate(0, -camY);
        // the sea at the bottom
        g.fillStyle = '#21486e'; g.fillRect(0, H - 30, W, 400);
        // the hull side behind the decks: portholes in rows
        g.fillStyle = 'rgba(20,22,24,.55)'; g.fillRect(30, -GOAL - 60, W - 60, GOAL + H);
        g.fillStyle = 'rgba(255,214,140,.35)';
        for (let y = H - 60; y > -GOAL; y -= 40) for (let x = 44; x < W - 44; x += 22) g.fillRect(x, y, 4, 4);
        // the funnels at the top
        for (let i = 0; i < 4; i++){ const fx = 30 + i * 82; g.fillStyle = '#d39a3a'; g.fillRect(fx, -GOAL - 230, 52, 150); g.fillStyle = '#151515'; g.fillRect(fx, -GOAL - 230, 52, 26); }
        for (const pl of plats){
          if (pl.y - camY < -30 || pl.y - camY > H + 30) continue;
          g.fillStyle = pl.top ? '#ece8dc' : '#b98a57'; g.fillRect(pl.x, pl.y, pl.w, 9);
          g.strokeStyle = '#f1ece2'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(pl.x, pl.y - 9); g.lineTo(pl.x + pl.w, pl.y - 9); g.stroke();
          for (let x = pl.x + 4; x < pl.x + pl.w; x += 12){ g.beginPath(); g.moveTo(x, pl.y - 9); g.lineTo(x, pl.y); g.stroke(); }
          if (pl.spring) drawBuoy(g, pl.x + pl.w / 2, pl.y - 4, 7);
        }
        // the climber
        g.fillStyle = '#ff7a1a'; g.fillRect(p.x - 8, p.y - 26, 16, 20); g.fillRect(p.x - 7, p.y - 7, 5, 7); g.fillRect(p.x + 2, p.y - 7, 5, 7);
        g.fillStyle = '#e8c39e'; g.beginPath(); g.arc(p.x, p.y - 32, 7, 0, 7); g.fill();
        g.restore();
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(W - 14, 20, 6, H - 40); g.fillStyle = '#ff7a1a'; const f = clampN(best / GOAL, 0, 1); g.fillRect(W - 14, 20 + (H - 40) * (1 - f), 6, (H - 40) * f);
      }
    };
  };

  // ### 6. Seagull: flap through the gaps between icebergs and storm clouds, the Titanic sailing in the background.
  BUILD.seagull = api => {
    const W = 640, H = 360, SEA = 300, GAP = 128, SPEED = 175, NEED = 10;
    const c = api.canvas(W, H), g = c.getContext('2d');
    const b = { x: 150, y: 160, vy: 0, f: 0 };
    let started = false, passed = 0, scroll = 0;
    const pipes = [];
    for (let i = 0; i < NEED + 2; i++) pipes.push({ x: 520 + i * 230, gap: 95 + api.rand() * (SEA - 95 - GAP - 30) });
    const flap = () => { if (api.over) return; started = true; b.vy = -330; api.sound('jump'); };
    return {
      key(code, down){ if (down && (code === 'Space' || code === 'ArrowUp' || code === 'KeyW')) flap(); },
      point(x, y, type){ if (type === 'down') flap(); },
      start(){ api.status(`Flap to take off. Gaps: 0 of ${NEED}`); },
      update(dt){
        b.f += dt * (started ? 14 : 6);
        if (!started){ b.y = 160 + Math.sin(b.f * .5) * 6; return; }
        scroll += SPEED * dt;
        b.vy = Math.min(520, b.vy + 1100 * dt); b.y += b.vy * dt;
        if (b.y < 8){ b.y = 8; b.vy = 0; }
        const box = { x: b.x - 10, y: b.y - 6, w: 20, h: 10 };
        for (const pp of pipes){
          const x = pp.x - scroll;
          if (!pp.done && x + 50 < b.x){ pp.done = true; passed++; api.sound('tick'); api.status(`Gaps: ${passed} of ${NEED}`); if (passed >= NEED) return api.win('Ten gaps. The seagull is through.'); }
          if (overlap(box, { x: x + 4, y: 0, w: 42, h: pp.gap - 6 }) || overlap(box, { x: x + 2, y: pp.gap + GAP + 8, w: 46, h: SEA })) return api.lose('The seagull crashed.');
        }
        if (b.y > SEA - 4) api.lose('The seagull fell into the sea.');
      },
      draw(){
        const sky = g.createLinearGradient(0, 0, 0, SEA); sky.addColorStop(0, '#25385e'); sky.addColorStop(.6, '#e48a62'); sky.addColorStop(1, '#ffcf8f');
        g.fillStyle = sky; g.fillRect(0, 0, W, SEA);
        g.fillStyle = '#ffe2a8'; g.beginPath(); g.arc(470, SEA - 10, 34, 0, 7); g.fill();
        // the Titanic far away, drifting slowly
        drawTitanic(g, ((380 - scroll * .08) % (W + 330) + W + 330) % (W + 330) - 300, SEA - 2, .9, { silhouette: 'rgba(40,30,40,.75)' });
        const sea = g.createLinearGradient(0, SEA, 0, H); sea.addColorStop(0, '#2c5577'); sea.addColorStop(1, '#0e2236');
        g.fillStyle = sea; g.fillRect(0, SEA, W, H - SEA);
        g.strokeStyle = 'rgba(255,220,180,.35)'; g.lineWidth = 1.5;
        for (let i = 0; i < 16; i++){ const x = ((i * 71 - scroll * .9) % (W + 40) + W + 40) % (W + 40) - 20; const y = SEA + 8 + (i % 4) * 12; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 3, x + 16, y); g.stroke(); }
        for (const pp of pipes){
          const x = pp.x - scroll; if (x < -60 || x > W + 10) continue;
          // a storm cloud hanging down from the top
          g.fillStyle = '#3b3f4a'; g.fillRect(x + 6, 0, 38, pp.gap - 14);
          g.beginPath(); for (let k = 0; k < 4; k++) g.arc(x + 6 + k * 12.6, pp.gap - 16, 11, 0, 7); g.fill();
          // an iceberg rising from the sea
          drawIceberg(g, x - 4, SEA + 6, 58, SEA + 6 - (pp.gap + GAP));
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
    let left = TIME, raf = 0, last = 0, timers = [], canvas = null, logical = null, stopped = false, lastStatus = '';
    const api = {
      rand, stage, over: false,
      status(t){ if (t !== lastStatus){ statusEl.textContent = t; lastStatus = t; } },
      sound(n){ if (opts.sound) opts.sound(n); },
      later(fn, ms){ timers.push(setTimeout(() => { if (!api.over && !stopped) fn(); }, ms)); },
      penalty(s){ left = Math.max(0, left - s); },
      canvas(w, h){
        canvas = document.createElement('canvas'); logical = { w, h };
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = w * dpr; canvas.height = h * dpr; canvas.className = 'mg-canvas';
        canvas.style.aspectRatio = `${w} / ${h}`;
        canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
        stage.appendChild(canvas); return canvas;
      },
      win(reason){ finish(true, reason); },
      lose(reason){ finish(false, reason); }
    };
    const game = BUILD[id](api) || {};
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
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (game.start) game.start();
    if (game.draw) game.draw();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return { stop(){ if (!stopped){ api.over = true; cleanup(); } }, get timeLeft(){ return left; } };
  }

  return Object.freeze({ TIME, INFO, GAMES, DIFFS, pickGames, tttWinner, tttBot, placeFleet, fleetSunk, bsBot, pickDiffs, hitDiff, overlap, open });
});
