// ### Unit tests for the six Titanic mini games (room-1-escape/js/minigames.js): dealing, the bots, the fleets and the
// ### spot-the-difference circles. The drawing and the controls are played in the browser tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../room-1-escape/js/minigames.js');
const R = require('../../room-1-escape/js/rules.js');

// a small seeded random number generator, so every run of these tests sees the same numbers
const seeded = a => () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };

test('there are six games, the same six the rules know, each at most 30 seconds', () => {
  assert.deepEqual(M.GAMES, R.GAMES);
  assert.equal(M.TIME, 30);
  for (const g of M.GAMES) assert.ok(M.INFO[g].title && M.INFO[g].how && M.INFO[g].name, g);
});

test('every new game deals three different mini games, and over many games all six come up', () => {
  const seen = new Set(), rand = seeded(7);
  for (let i = 0; i < 200; i++){
    const g = M.pickGames(rand);
    assert.equal(g.length, 3);
    assert.equal(new Set(g).size, 3, 'no game twice in one round');
    g.forEach(x => seen.add(x));
    assert.ok(R.perform(R.newState(), 'start', g).ok, 'the rules accept every deal');
  }
  assert.equal(seen.size, 6);
});

test('tic-tac-toe: lines, draws, and a bot that always wins when it can and can be beaten', () => {
  assert.equal(M.tttWinner(['X', 'X', 'X', '', '', '', '', '', '']), 'X');
  assert.equal(M.tttWinner(['O', '', '', '', 'O', '', '', '', 'O']), 'O');
  assert.equal(M.tttWinner(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']), 'draw');
  assert.equal(M.tttWinner(Array(9).fill('')), null);
  assert.equal(M.tttBot(['O', 'O', '', 'X', 'X', '', '', '', ''], () => .99), 2, 'takes the win instead of blocking');
  assert.equal(M.tttBot(['X', 'X', '', '', 'O', '', '', '', ''], () => 0), 2, 'blocks when it decides to');
  assert.equal(M.tttBot(Array(9).fill('X'), Math.random), -1, 'no move on a full board');
  // a player who plays the first free cell that wins, else blocks, else the centre, else the first free: wins some games
  const rand = seeded(3); let wins = 0;
  for (let n = 0; n < 200; n++){
    const b = Array(9).fill('');
    while (!M.tttWinner(b)){
      const free = b.map((c, i) => c ? -1 : i).filter(i => i >= 0);
      const fin = who => free.find(i => { const t = b.slice(); t[i] = who; return M.tttWinner(t) === who; });
      let m = fin('X'); if (m === undefined) m = fin('O'); if (m === undefined) m = !b[4] ? 4 : free[0];
      b[m] = 'X';
      if (M.tttWinner(b)) break;
      const bm = M.tttBot(b, rand);
      assert.equal(b[bm], '', 'the bot plays a free cell');
      b[bm] = 'O';
    }
    if (M.tttWinner(b) === 'X') wins++;
  }
  assert.ok(wins > 40, `the bot can be beaten (${wins} of 200)`);
});

test('battleship: fleets of three straight ships that never overlap, and a bot that only fires at new cells', () => {
  const rand = seeded(11);
  for (let i = 0; i < 100; i++){
    const f = M.placeFleet(6, [3, 2, 2], rand);
    assert.deepEqual(f.map(s => s.length), [3, 2, 2]);
    const all = f.flat();
    assert.equal(new Set(all).size, 7, 'no two ships on one cell');
    assert.ok(all.every(c => c >= 0 && c < 36));
    for (const s of f){
      const rows = new Set(s.map(c => Math.floor(c / 6))), cols = new Set(s.map(c => c % 6));
      assert.ok(rows.size === 1 || cols.size === 1, 'straight');
      const step = rows.size === 1 ? 1 : 6;
      s.slice(1).forEach((c, k) => assert.equal(c - s[k], step, 'no gaps'));
    }
    const shots = new Set();
    while (!M.fleetSunk(f, shots)){ const c = M.bsBot(6, f, shots, rand); assert.ok(!shots.has(c) && c >= 0 && c < 36); shots.add(c); }
    assert.ok(shots.size <= 36);
  }
});

test('spot the difference: five differences each game, found only once and only near the right place', () => {
  const d = M.pickDiffs(seeded(5));
  assert.equal(d.length, 5);
  assert.equal(new Set(d.map(x => x.id)).size, 5);
  const found = d.map(() => false);
  assert.equal(M.hitDiff(d, found, d[2].x + 3, d[2].y - 3), 2);
  found[2] = true;
  assert.equal(M.hitDiff(d, found, d[2].x, d[2].y), -1, 'a found difference does not count twice');
  assert.equal(M.hitDiff(d, found, -100, -100), -1, 'a click far away is wrong');
  assert.ok(M.DIFFS.every(x => x.x - x.r >= 0 && x.x + x.r <= 310 && x.y - x.r >= 0 && x.y + x.r <= 290), 'every circle lies inside the picture');
});

test('overlap of two boxes, used by the three action games', () => {
  assert.ok(M.overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }));
  assert.ok(!M.overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), 'touching edges do not count');
});
