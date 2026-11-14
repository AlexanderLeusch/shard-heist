// Online accounts and the shared leaderboard (room-2-chase/js/online.js), run against a fake Supabase: no real data is touched
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../../room-2-chase/js/online.js');

const UID = '11111111-2222-3333-4444-555555555555';
const T0 = Date.UTC(2026, 10, 14, 12);
// A fake Supabase: answers by path, records every request
function fake(routes){
  const calls = [];
  const fetch = async (url, opts) => {
    const u = new URL(url), key = opts.method + ' ' + u.pathname + (u.searchParams.get('grant_type') ? '?' + u.searchParams.get('grant_type') : '');
    calls.push({ key, url, opts, body: opts.body ? JSON.parse(opts.body) : undefined });
    const r = routes[key];
    if (!r) throw new Error('offline');
    const [status, body] = typeof r === 'function' ? r(opts) : r;
    return { ok: status >= 200 && status < 300, status, text: async () => body === undefined ? '' : JSON.stringify(body) };
  };
  const mem = {};
  const store = { get: k => mem[k] ?? null, set: (k, v) => { mem[k] = v; } };
  return { fetch, calls, store, mem };
}
const login = (exp = T0 / 1000 + 3600) => ({ access_token: 'a'.repeat(40), refresh_token: 'r1', expires_at: exp, user: { id: UID, email: 'alex@example.com' } });

test('email and password are checked before anything is sent', () => {
  assert.equal(O.cleanEmail('  Alex@Example.COM '), 'alex@example.com');
  for (const bad of ['', 'alex', 'alex@', '@x.pt', 'a b@x.pt', 'alex@x', 42, null]) assert.equal(O.cleanEmail(bad), '', String(bad));
  assert.match(O.passwordProblem('short'), /at least 8/);
  assert.match(O.passwordProblem('x'.repeat(73)), /at most 72/);
  assert.equal(O.passwordProblem('long enough'), '');
});

test('a saved login is read back only when complete; anything else means signed out', () => {
  assert.deepEqual(O.parseSession(JSON.stringify(login())), { ...login(), user: { ...login().user, anon: false } });
  assert.equal(O.parseSession(JSON.stringify({ ...login(), user: { id: UID, is_anonymous: true } })).user.anon, true, 'a name-only account is marked');
  for (const bad of [null, '', '{', '[]', JSON.stringify({ ...login(), user: { id: 'not-a-uuid' } }), JSON.stringify({ ...login(), access_token: 'x' }), JSON.stringify({ ...login(), expires_at: 'soon' }), 'x'.repeat(30000)])
    assert.equal(O.parseSession(bad), null);
  assert.equal(O.needsRefresh(login(T0 / 1000 + 30), T0), true, 'ends within a minute: renew');
  assert.equal(O.needsRefresh(login(), T0), false);
});

test('answers from Supabase become short, clear messages', () => {
  assert.match(O.errorText(400, { error_code: 'invalid_credentials' }), /Email or password is wrong/);
  assert.match(O.errorText(422, { error_code: 'user_already_exists' }), /already an account/);
  assert.match(O.errorText(409, { code: '23505' }), /name is taken/);
  assert.match(O.errorText(429, {}), /Too many tries/);
  assert.match(O.errorText(0), /not reachable.*kept on this device/);
  assert.match(O.errorText(500, { message: 'internal stack trace' }), /Something went wrong/);
  assert.ok(!/stack trace/.test(O.errorText(500, { message: 'internal stack trace' })), 'never the raw technical text');
});

test('board rows are checked, sorted and cut; impossible rows are dropped', () => {
  const rows = O.toRows([
    { name: 'B', time: '61.50', veh: 'bike', stars: 3, driver_id: UID },
    { name: 'A', time: 58, veh: 'car', stars: 2 },
    { name: 'X', time: 5, veh: 'car', stars: 1 }, { name: '', time: 70 }, { name: 'Y', time: 'fast' }, null,
    { name: 'Z', time: 80, veh: 'rocket', stars: 9 }
  ]);
  assert.deepEqual(rows.map(r => r.name), ['A', 'B', 'Z']);
  assert.equal(rows[1].time, 61.5);
  assert.equal(rows[2].veh, 'car'); assert.equal(rows[2].stars, 1);
  assert.deepEqual(O.toRows('nope'), []);
  assert.equal(O.toRows(Array.from({ length: 80 }, (_, i) => ({ name: 'n' + i, time: 20 + i }))).length, 50);
});

test('a run is only sent with a known map and vehicle and a possible time', () => {
  assert.deepEqual(O.runBody({ mode: 'city', time: 61.236, veh: 'car', stars: 3 }), { mode: 'city', time: 61.24, veh: 'car', stars: 3 });
  for (const bad of [{ mode: 'moon', time: 60, veh: 'car' }, { mode: 'city', time: 3, veh: 'car' }, { mode: 'city', time: 1000, veh: 'car' }, { mode: 'city', time: 60, veh: 'tank' }, null])
    assert.equal(O.runBody(bad), null);
});

test('sign in keeps the login; a wrong password is refused with a clear message', async () => {
  const f = fake({ 'POST /auth/v1/token?password': o => JSON.parse(o.body).password === 'right-password' ? [200, login()] : [400, { error_code: 'invalid_credentials' }] });
  const c = O.createClient({ fetch: f.fetch, store: f.store, now: () => T0 });
  const bad = await c.signIn('alex@example.com', 'wrong-password');
  assert.equal(bad.ok, false); assert.match(bad.error, /wrong/); assert.equal(c.user, null);
  const ok = await c.signIn(' Alex@Example.com ', 'right-password');
  assert.equal(ok.ok, true); assert.equal(c.user.id, UID);
  assert.equal(f.calls.at(-1).body.email, 'alex@example.com');
  assert.equal(O.parseSession(f.mem['shard-heist-session']).user.id, UID, 'saved, so the next visit is signed in');
  const again = O.createClient({ fetch: f.fetch, store: f.store, now: () => T0 });
  assert.equal(again.user.id, UID);
});

test('bad input never reaches Supabase', async () => {
  const f = fake({});
  const c = O.createClient({ fetch: f.fetch, store: f.store, now: () => T0 });
  assert.match((await c.signUp('not-an-email', 'long enough')).error, /not valid/);
  assert.match((await c.signUp('a@b.pt', 'short')).error, /at least 8/);
  assert.equal((await c.submitRun({ mode: 'city', time: 60, veh: 'car', stars: 3 })).ok, false, 'signed out: no run');
  assert.equal((await c.setDriverName('Alex')).ok, false, 'signed out: no name');
  assert.equal(f.calls.length, 0);
});

test('a run is sent with the login, without an owner or date (the database sets those)', async () => {
  const f = fake({ 'POST /rest/v1/runs': [201] });
  f.store.set('shard-heist-session', JSON.stringify(login()));
  const c = O.createClient({ fetch: f.fetch, store: f.store, now: () => T0 });
  const r = await c.submitRun({ mode: 'highway', time: 88.888, veh: 'truck', stars: 2 });
  assert.equal(r.ok, true);
  const call = f.calls[0];
  assert.equal(call.opts.headers.Authorization, 'Bearer ' + 'a'.repeat(40));
  assert.equal(call.opts.headers.apikey, O.CONFIG.key);
  assert.deepEqual(call.body, { mode: 'highway', time: 88.89, veh: 'truck', stars: 2 });
  assert.equal(call.opts.credentials, 'omit');
});

test('an ending login is renewed first; a refused renewal signs the player out', async () => {
  const f = fake({ 'POST /auth/v1/token?refresh_token': [200, { ...login(T0 / 1000 + 7200), access_token: 'b'.repeat(40) }], 'POST /rest/v1/runs': [201] });
  f.store.set('shard-heist-session', JSON.stringify(login(T0 / 1000 + 10)));
  const c = O.createClient({ fetch: f.fetch, store: f.store, now: () => T0 });
  assert.equal((await c.submitRun({ mode: 'city', time: 60, veh: 'car', stars: 1 })).ok, true);
  assert.deepEqual(f.calls.map(x => x.key), ['POST /auth/v1/token?refresh_token', 'POST /rest/v1/runs']);
  assert.equal(f.calls[1].opts.headers.Authorization, 'Bearer ' + 'b'.repeat(40));

  const g = fake({ 'POST /auth/v1/token?refresh_token': [400, { error_code: 'refresh_token_not_found' }] });
  g.store.set('shard-heist-session', JSON.stringify(login(T0 / 1000 + 10)));
  const d = O.createClient({ fetch: g.fetch, store: g.store, now: () => T0 });
  const r = await d.submitRun({ mode: 'city', time: 60, veh: 'car', stars: 1 });
  assert.equal(r.ok, false); assert.match(r.error, /sign in again/);
  assert.equal(d.user, null);
});

test('a taken driver name and a refused run come back as messages', async () => {
  const f = fake({ 'POST /rest/v1/drivers': [409, { code: '23505' }], 'POST /rest/v1/runs': [403, { code: '42501' }] });
  f.store.set('shard-heist-session', JSON.stringify(login()));
  const c = O.createClient({ fetch: f.fetch, store: f.store, now: () => T0 });
  assert.match((await c.setDriverName('Alex')).error, /taken/);
  assert.match((await c.submitRun({ mode: 'city', time: 60, veh: 'car', stars: 1 })).error, /sign in again/);
});

test('the boards are read without a login; when Supabase is down the answer is ok: false, never an exception', async () => {
  const rows = [{ name: 'Alex', time: '70.00', veh: 'car', stars: 3, driver_id: UID }];
  const f = fake({ 'GET /rest/v1/board_all': [200, rows], 'GET /rest/v1/board_month': [200, []] });
  const c = O.createClient({ fetch: f.fetch, store: f.store, now: () => T0 });
  const r = await c.boards('city');
  assert.equal(r.ok, true); assert.equal(r.all[0].time, 70); assert.deepEqual(r.month, []);
  assert.equal(f.calls[0].opts.headers.Authorization, undefined);
  assert.match(f.calls[0].url, /mode=eq\.city/);
  assert.equal((await c.boards('moon')).ok, false);
  const down = O.createClient({ fetch: fake({}).fetch, store: f.store, now: () => T0 });
  const d = await down.boards('city');
  assert.equal(d.ok, false); assert.match(d.error, /not reachable/);
  assert.equal((await O.createClient({ fetch: null }).boards('city')).ok, false, 'no fetch at all');
});

test('sign out forgets the login on this device', async () => {
  const f = fake({ 'POST /auth/v1/logout': [204] });
  f.store.set('shard-heist-session', JSON.stringify(login()));
  const c = O.createClient({ fetch: f.fetch, store: f.store, now: () => T0 });
  await c.signOut();
  assert.equal(c.user, null);
  assert.equal(O.parseSession(f.mem['shard-heist-session']), null);
});

test('the page holds only the publishable key, never a secret one', () => {
  assert.match(O.CONFIG.key, /^sb_publishable_/);
  assert.match(O.CONFIG.url, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
});

test('play with a name only: a free name gets an anonymous account for this browser, with no email and no password', async () => {
  const anon = { ...login(), user: { id: UID, is_anonymous: true } };
  const f = fake({ 'GET /rest/v1/drivers': [200, []], 'POST /auth/v1/signup': [200, anon], 'POST /rest/v1/drivers': [201] });
  const c = O.createClient({ fetch: f.fetch, store: f.store, now: () => T0 });
  const r = await c.playAs('Alex');
  assert.equal(r.ok, true); assert.equal(r.name, 'Alex');
  assert.equal(c.user.anon, true);
  assert.deepEqual(f.calls.map(x => x.key), ['GET /rest/v1/drivers', 'POST /auth/v1/signup', 'POST /rest/v1/drivers']);
  assert.deepEqual(f.calls[1].body, { data: {} }, 'no email, no password');
  assert.equal(f.calls[2].opts.headers.Authorization, 'Bearer ' + 'a'.repeat(40));
});

test('a taken name is refused before any account is made; offline, nothing is made either', async () => {
  const f = fake({ 'GET /rest/v1/drivers': [200, [{ name: 'alex' }]] });
  const c = O.createClient({ fetch: f.fetch, store: f.store, now: () => T0 });
  const r = await c.playAs('Alex');
  assert.equal(r.ok, false); assert.match(r.error, /taken/);
  assert.equal(c.user, null);
  assert.deepEqual(f.calls.map(x => x.key), ['GET /rest/v1/drivers']);
  const d = O.createClient({ fetch: fake({}).fetch, store: fake({}).store, now: () => T0 });
  assert.match((await d.playAs('Alex')).error, /not reachable/);
  assert.equal(d.user, null);
  assert.equal((await c.playAs('')).ok, false);
});

test('names are matched without case and the two wildcards of the search match only themselves', () => {
  assert.equal(O.nameFilter('Alex'), 'ilike.Alex');
  assert.equal(O.nameFilter('a_b'), 'ilike.a%5C_b', '_ would match any letter');
  assert.equal(O.nameFilter('Ana Rita'), 'ilike.Ana%20Rita');
});

test('a cut-off or broken answer counts as a failed call, never as an empty one (so a slow start never looks signed out)', async () => {
  const session = JSON.stringify(login());
  const cut = { get: () => session, set: () => {} };
  const aborted = O.createClient({ store: cut, now: () => T0, fetch: async () => ({ ok: true, status: 200, text: async () => { throw new Error('aborted'); } }) });
  const a = await aborted.driverName();
  assert.equal(a.ok, false); assert.match(a.error, /not reachable/);
  const broken = O.createClient({ store: cut, now: () => T0, fetch: async () => ({ ok: true, status: 200, text: async () => '[{"name":"Al' }) });
  assert.equal((await broken.driverName()).ok, false);
  const fine = O.createClient({ store: cut, now: () => T0, fetch: async () => ({ ok: true, status: 200, text: async () => '[{"name":"Alex"}]' }) });
  assert.deepEqual(await fine.driverName(), { ok: true, name: 'Alex' });
});
