// Player input: menu actions, menu picks, keys and stored data (src/core.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');

const STATES = ['menu', 'play', 'pause', 'done', 'over'];
const allowedIn = (action, story) => STATES.filter(state => Core.actionAllowed(action, { state, story }));

test('accepted: each menu action works in the states whose cards show it', () => {
  assert.deepEqual(allowedIn('go', null), ['menu']);
  assert.deepEqual(allowedIn('resume', null), ['pause']);
  assert.deepEqual(allowedIn('again', null), ['pause', 'done', 'over']);
  assert.deepEqual(allowedIn('menu', null), ['menu', 'pause', 'done', 'over']);
  assert.deepEqual(allowedIn('story', null), ['menu', 'done']);
  const story = Core.newStory();
  assert.deepEqual(allowedIn('act', story), ['menu', 'done']);
  assert.deepEqual(allowedIn('retry-act', story), ['pause', 'over']);
  assert.deepEqual(allowedIn('next-act', story), ['done']);
});

test('rejected: nothing on a card can run while driving', () => {
  for (const a of ['go', 'story', 'again', 'resume', 'menu', 'act', 'next-act', 'retry-act']) assert.equal(Core.actionAllowed(a, { state: 'play', story: Core.newStory() }), false, a);
});

test('rejected: story actions without a story, and no act after the last one', () => {
  for (const a of ['act', 'next-act', 'retry-act']) assert.deepEqual(allowedIn(a, null), [], a);
  const story = Core.newStory();
  Core.beginAct(story, 2);
  assert.equal(Core.actionAllowed('next-act', { state: 'done', story }), false);
});

test('rejected: unknown, empty or malformed actions', () => {
  for (const a of ['', 'delete', 'GO', 'constructor', '__proto__', undefined, null, 42]) assert.equal(Core.actionAllowed(a, { state: 'menu', story: null }), false, String(a));
  assert.equal(Core.actionAllowed('go', undefined), false);
  assert.equal(Core.actionAllowed('go', { state: 'loading' }), false);
});

test('menu picks: known maps and vehicles are accepted, everything else is rejected', () => {
  const sel = { mode: 'city', veh: 'car' };
  assert.ok(Core.applyPick(sel, 'mode', 'highway'));
  assert.ok(Core.applyPick(sel, 'veh', 'truck'));
  assert.deepEqual(sel, { mode: 'highway', veh: 'truck' });
  for (const [field, val] of [['mode', 'moon'], ['veh', 'tank'], ['veh', 'constructor'], ['mode', '__proto__'], ['mode', 'toString'], ['color', 'red'], ['__proto__', 'city'], ['mode', null], ['veh', 1]]){
    assert.equal(Core.applyPick(sel, field, val), false, `${field}=${val}`);
  }
  assert.deepEqual(sel, { mode: 'highway', veh: 'truck' }, 'rejected picks change nothing');
  assert.equal(Object.getPrototypeOf(sel), Object.prototype);
});

test('stored selection: valid data is restored, tampered data falls back to defaults', () => {
  assert.deepEqual(Core.parsePick('{"mode":"country","veh":"bike"}'), { mode: 'country', veh: 'bike' });
  assert.deepEqual(Core.parsePick('{"mode":"country","veh":"jet"}'), { mode: 'country', veh: 'car' });
  const fallback = { mode: 'city', veh: 'car' };
  for (const raw of [null, undefined, '', 'not json', '{', '[]', '"city"', '42', 'null', '{"mode":"constructor","veh":"__proto__"}', '{"mode":"hasOwnProperty"}', '{"__proto__":{"mode":"x"}}', 'x'.repeat(5000)]){
    assert.deepEqual(Core.parsePick(raw), fallback, String(raw).slice(0, 40));
  }
});

test('stored best times: only plausible positive seconds are accepted', () => {
  assert.equal(Core.parseBest('83.4'), 83.4);
  assert.equal(Core.parseBest(' 120 '), 120);
  for (const raw of [null, '', 'abc', '-5', '0', 'NaN', 'Infinity', '1e9', '99999', '12abc', '0x10', '[]']) assert.equal(Core.parseBest(raw), null, String(raw));
});

test('keys: WASD and arrows drive, space is the handbrake, other keys do nothing', () => {
  assert.equal(Core.KEY_MAP.KeyW, 'up');
  assert.equal(Core.KEY_MAP.ArrowDown, 'down');
  assert.equal(Core.KEY_MAP.KeyA, 'left');
  assert.equal(Core.KEY_MAP.ArrowRight, 'right');
  assert.equal(Core.KEY_MAP.Space, 'brake');
  const own = k => Object.prototype.hasOwnProperty.call(Core.KEY_MAP, k);
  for (const k of ['KeyQ', 'Enter', 'KeyP', 'toString', 'constructor', '__proto__']) assert.equal(own(k), false, k);
  assert.deepEqual([...new Set(Object.values(Core.KEY_MAP))].sort(), ['brake', 'down', 'left', 'right', 'up']);
});

test('the rules module is frozen so the game cannot change it by accident', () => {
  assert.ok(Object.isFrozen(Core));
  assert.throws(() => { 'use strict'; Core.parsePick = () => ({}); });
});
