// Story mode "The Necklace Job": acts, items, endings and retries (src/core.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');

// Plays through the story the way game.js does: begin an act, maybe pick things up, finish or fail
function playthrough(steps){
  const story = Core.newStory();
  for (const step of steps) step(story);
  return story;
}

test('a new story starts in act 1 with no items', () => {
  const s = Core.newStory();
  assert.equal(s.act, 0);
  assert.equal(s.letter, false);
  assert.equal(s.clasp, false);
  assert.deepEqual(s.times, []);
});

test('the three acts are played on the three maps in order', () => {
  const s = Core.newStory();
  for (let i = 0; i < Core.STORY_ACTS; i++){ assert.ok(Core.beginAct(s, i)); assert.equal(s.act, i); }
});

test('rejected: acts outside 1-3 and non-numbers do not change the story', () => {
  const s = Core.newStory();
  Core.beginAct(s, 1);
  for (const bad of [-1, 3, 7, 1.5, NaN, '2', null, undefined]){
    assert.equal(Core.beginAct(s, bad), false, String(bad));
    assert.equal(s.act, 1);
  }
  assert.equal(Core.beginAct(null, 0), false);
});

test('Ending A: the letter found in act 1 reveals the real culprit', () => {
  const s = playthrough([
    st => Core.beginAct(st, 0), st => { st.letter = true; },
    st => Core.beginAct(st, 1), st => { st.clasp = true; },
    st => Core.beginAct(st, 2)
  ]);
  assert.equal(Core.storyEnding(s), 'A');
});

test('Ending B: without the letter the detective is framed', () => {
  const s = playthrough([st => Core.beginAct(st, 0), st => Core.beginAct(st, 1), st => { st.clasp = true; }, st => Core.beginAct(st, 2)]);
  assert.equal(Core.storyEnding(s), 'B');
});

test('the letter only counts if the act it was found in was finished', () => {
  const s = Core.newStory();
  Core.beginAct(s, 0);
  s.letter = true;                 // found it ...
  Core.beginAct(s, Core.retryAct(s)); // ... but got busted and retried act 1
  assert.equal(s.letter, false);
  assert.equal(s.act, 0);
  // found it and then finished the act: it carries over into later acts and their retries
  s.letter = true;
  Core.beginAct(s, 1);
  assert.equal(Core.retryAct(s), 1);
  assert.equal(s.letter, true);
  assert.equal(Core.storyEnding(s), 'A');
});

test('the toll in act 2 rejects the player without the clasp and opens with it', () => {
  const s = Core.newStory();
  Core.beginAct(s, 1);
  assert.equal(Core.finishOpen(s), false);
  s.clasp = true;
  assert.equal(Core.finishOpen(s), true);
  // retrying act 2 takes the clasp away again
  Core.beginAct(s, Core.retryAct(s));
  assert.equal(Core.finishOpen(s), false);
  // other acts and free ride always let you finish
  Core.beginAct(s, 0); assert.equal(Core.finishOpen(s), true);
  Core.beginAct(s, 2); assert.equal(Core.finishOpen(s), true);
  assert.equal(Core.finishOpen(null), true);
});

test('radio lines play once each, in order, when their time comes', () => {
  const lines = [[5, 'a'], [9, 'b'], [32, 'c']];
  let r = Core.dueRadio(lines, 0, 4.9);
  assert.deepEqual(r, { due: [], idx: 0 });
  r = Core.dueRadio(lines, r.idx, 10);
  assert.deepEqual(r.due.map(l => l[1]), ['a', 'b']);
  r = Core.dueRadio(lines, r.idx, 10);
  assert.deepEqual(r.due, [], 'nothing repeats');
  r = Core.dueRadio(lines, r.idx, 999);
  assert.deepEqual(r, { due: [[32, 'c']], idx: 3 });
  assert.deepEqual(Core.dueRadio(lines, 3, 9999).due, [], 'past the end stays quiet');
});
