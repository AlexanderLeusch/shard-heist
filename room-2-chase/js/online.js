/* Shard Heist: online accounts and the shared leaderboard.
   ### Players can create an online account (email and password) and pick a driver name; their finished runs then go on a
   ### leaderboard that everybody sees, on every device. The data lives in a Supabase project (a hosted Postgres database with
   ### login, see supabase/schema.sql). This file talks to it over its two web APIs with plain fetch, so it needs no library:
   ###   - Auth (/auth/v1): the quick way is a name only: an anonymous account is made for this browser and the name is put on
   ###     it, with no email and no password. Players who want the same driver on several devices can use email and password
   ###     instead (sign up, sign in). Supabase keeps the passwords; we never store them. The login is renewed before it ends.
   ###   - Data (/rest/v1): read the boards, add your driver name, add your run.
   ### The key below is the PUBLISHABLE key: it is meant to be in web pages. What a player may do is decided by the rules
   ### (Row Level Security) in the database, not by this file, so a changed copy of the page can't write someone else's runs.
   ### When Supabase can't be reached, every call ends with { ok: false } and the game keeps its local leaderboard. */
(function (root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShardOnline = factory();
})(typeof self !== 'undefined' ? self : this, function (){
  'use strict';

  const CONFIG = Object.freeze({
    url: 'https://nqjeonoudywpdwivfuyp.supabase.co',
    key: 'sb_publishable_3zLfMmeP2TAZuHRnFcRdIg_YYPRUKvp',
    store: 'shard-heist-session',
    timeout: 8000,
    keep: 50
  });
  const MODES = ['city', 'highway', 'country'], VEHS = ['car', 'bike', 'truck'];
  const PW_MIN = 8, EMAIL_MAX = 254;

  // ---------- Pure helpers (tested in tests/room-2/online.test.js) ----------
  // An email address as typed, trimmed and in lower case; '' when it can't be one
  function cleanEmail(raw){
    if (typeof raw !== 'string') return '';
    const e = raw.trim().toLowerCase();
    return e.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
  }
  // Why a password is refused, or '' when it is fine (Supabase checks it again)
  function passwordProblem(pw){
    if (typeof pw !== 'string' || pw.length < PW_MIN) return `Use at least ${PW_MIN} characters for the password.`;
    if (pw.length > 72) return 'Use at most 72 characters for the password.';
    return '';
  }
  // ### Reads a saved login back. Anything that is not a complete login is dropped, so the player is simply signed out.
  function parseSession(raw){
    if (typeof raw !== 'string' || raw.length > 20000) return null;
    let s; try { s = JSON.parse(raw); } catch (e) { return null; }
    if (!s || typeof s !== 'object') return null;
    const ok = typeof s.access_token === 'string' && s.access_token.length > 20 && typeof s.refresh_token === 'string' && s.refresh_token.length > 0
      && Number.isFinite(s.expires_at) && s.user && typeof s.user.id === 'string' && /^[0-9a-f-]{36}$/i.test(s.user.id);
    return ok ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, user: { id: s.user.id, email: typeof s.user.email === 'string' ? s.user.email : '', anon: s.user.anon === true || s.user.is_anonymous === true } } : null;
  }
  // The login part of an Auth answer; expires_at in seconds, worked out from expires_in when it is missing
  function sessionFrom(body, nowMs){
    if (!body || typeof body !== 'object') return null;
    const exp = Number.isFinite(body.expires_at) ? body.expires_at : Math.floor(nowMs / 1000) + (Number.isFinite(body.expires_in) ? body.expires_in : 3600);
    return parseSession(JSON.stringify({ access_token: body.access_token, refresh_token: body.refresh_token, expires_at: exp, user: body.user }));
  }
  // A login that ends within a minute is renewed first
  const needsRefresh = (session, nowMs) => !!session && session.expires_at * 1000 - nowMs < 60000;
  // ### Turns an answer from Supabase into a short message for the player (never the raw technical text).
  function errorText(status, body){
    const code = body && (body.error_code || body.code || body.error) || '', msg = String(body && (body.msg || body.message || body.error_description) || '');
    if (status === 0) return 'The online leaderboard is not reachable right now. Your time is kept on this device.';
    if (code === 'invalid_credentials' || code === 'invalid_grant' || /invalid login/i.test(msg)) return 'Email or password is wrong.';
    if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(msg)) return 'There is already an account with this email. Sign in instead.';
    if (code === 'weak_password') return 'This password is too weak. Pick a longer one.';
    if (code === 'email_address_invalid' || code === 'validation_failed') return 'This email address is not valid.';
    if (code === '23505') return 'This driver name is taken. Pick another one.';
    if (code === '23514') return 'This name or time is not allowed.';
    if (/rate limit|over_request/i.test(code + msg) || status === 429) return 'Too many tries. Wait a minute and try again.';
    if (status === 401 || status === 403 || code === '42501') return 'Your login has ended. Please sign in again.';
    return 'Something went wrong online. Your time is kept on this device.';
  }
  // ### Rows from a board view, checked and in the shape the game's leaderboard uses: { name, time, veh, stars, id }, fastest first.
  function toRows(list){
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const r of list){
      if (!r || typeof r !== 'object' || typeof r.name !== 'string' || !r.name) continue;
      const time = Number(r.time);
      if (!Number.isFinite(time) || time < 10 || time > 900) continue;
      out.push({ name: r.name.slice(0, 16), time, veh: VEHS.includes(r.veh) ? r.veh : 'car', stars: [1, 2, 3].includes(Number(r.stars)) ? Number(r.stars) : 1, id: typeof r.driver_id === 'string' ? r.driver_id : '' });
    }
    return out.sort((a, b) => a.time - b.time).slice(0, CONFIG.keep);
  }
  // ### A PostgREST filter that finds a name without case: ilike, with its two wildcards (_ and %) escaped so they match themselves
  const nameFilter = name => 'ilike.' + encodeURIComponent(String(name).replace(/[\\%_]/g, c => '\\' + c));
  // The run as the database takes it: time in seconds with two decimals
  function runBody(run){
    if (!run || !MODES.includes(run.mode) || !VEHS.includes(run.veh)) return null;
    const time = Math.round(Number(run.time) * 100) / 100;
    if (!Number.isFinite(time) || time < 10 || time > 900) return null;
    const stars = [1, 2, 3].includes(run.stars) ? run.stars : 1;
    return { mode: run.mode, time, veh: run.veh, stars };
  }

  // ---------- The client ----------
  // ### fetchFn, store ({ get, set }) and now are passed in, so the tests can run it against a fake Supabase.
  function createClient(opts){
    const o = Object.assign({ url: CONFIG.url, key: CONFIG.key, timeout: CONFIG.timeout }, opts || {});
    const doFetch = o.fetch, now = o.now || (() => Date.now()), store = o.store || { get: () => null, set: () => {} };
    let session = parseSession(store.get(CONFIG.store));
    const save = s => { session = s; store.set(CONFIG.store, s ? JSON.stringify(s) : ''); };

    // One request; never throws: { ok, status, body }
    async function call(path, { method = 'GET', body, auth = false, prefer } = {}){
      if (typeof doFetch !== 'function') return { ok: false, status: 0, body: null };
      const headers = { apikey: o.key, Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth && session) headers.Authorization = 'Bearer ' + session.access_token;
      if (prefer) headers.Prefer = prefer;
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), o.timeout) : null;
      try {
        const res = await doFetch(o.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined, credentials: 'omit' });
        // the body is read inside the time limit too; a body that is cut off or is not JSON counts as a failed call, never as an empty answer
        const t = await res.text();
        let data = null;
        if (t){ try { data = JSON.parse(t); } catch (e) { return { ok: false, status: res.status, body: null }; } }
        return { ok: res.ok, status: res.status, body: data };
      } catch (e) { return { ok: false, status: 0, body: null }; }
      finally { if (timer) clearTimeout(timer); }
    }
    const fail = r => ({ ok: false, status: r.status, error: errorText(r.status, r.body) });

    // ### Renews the login when it is about to end. A refused renewal signs the player out.
    async function fresh(){
      if (!session) return false;
      if (!needsRefresh(session, now())) return true;
      const r = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
      if (r.ok){ const s = sessionFrom(r.body, now()); if (s){ save(s); return true; } }
      if (r.status === 400 || r.status === 401) save(null);
      return false;
    }
    async function authWith(path, email, password){
      const e = cleanEmail(email);
      if (!e) return { ok: false, status: 400, error: 'This email address is not valid.' };
      const pw = passwordProblem(password);
      if (pw) return { ok: false, status: 400, error: pw };
      const r = await call(path, { method: 'POST', body: { email: e, password } });
      if (!r.ok) return fail(r);
      const s = sessionFrom(r.body, now());
      if (!s) return { ok: false, status: r.status, error: 'Please confirm your email first, then sign in.' };
      save(s);
      return { ok: true, user: s.user };
    }
    // The driver name of the signed-in account ('' when it has none yet)
    async function driverName(){
      if (!(await fresh())) return { ok: false, status: 401, error: errorText(401) };
      const r = await call('/rest/v1/drivers?select=name&id=eq.' + encodeURIComponent(session.user.id), { auth: true });
      if (!r.ok) return fail(r);
      return { ok: true, name: Array.isArray(r.body) && r.body[0] && typeof r.body[0].name === 'string' ? r.body[0].name : '' };
    }
    // Whether a driver name is already used by someone (any case); null when that can't be checked right now
    async function nameTaken(name){
      const r = await call('/rest/v1/drivers?select=name&limit=1&name=' + nameFilter(name));
      return r.ok && Array.isArray(r.body) ? r.body.length > 0 : null;
    }
    async function setDriverName(name){
      if (typeof name !== 'string' || !name) return { ok: false, status: 400, error: 'Enter a driver name.' };
      if (!(await fresh())) return { ok: false, status: 401, error: errorText(401) };
      const r = await call('/rest/v1/drivers', { method: 'POST', auth: true, body: { name }, prefer: 'return=minimal' });
      return r.ok ? { ok: true, name } : fail(r);
    }
    return {
      get user(){ return session ? session.user : null; },
      nameTaken,
      // ### The quick start: checks the name is free, makes an anonymous account for this browser and gives it the name.
      // ### A taken name is refused before any account is made.
      async playAs(name){
        if (typeof name !== 'string' || !name) return { ok: false, status: 400, error: 'Enter a driver name.' };
        const taken = await nameTaken(name);
        if (taken === null) return { ok: false, status: 0, error: errorText(0) };
        if (taken) return { ok: false, status: 409, error: errorText(409, { code: '23505' }) };
        if (!session){
          const a = await call('/auth/v1/signup', { method: 'POST', body: { data: {} } });
          if (!a.ok) return fail(a);
          const s = sessionFrom(a.body, now());
          if (!s) return { ok: false, status: a.status, error: errorText(a.status, a.body) };
          save(s);
        }
        return setDriverName(name);
      },
      signUp: (email, pw) => authWith('/auth/v1/signup', email, pw),
      signIn: (email, pw) => authWith('/auth/v1/token?grant_type=password', email, pw),
      async signOut(){
        if (session) await call('/auth/v1/logout', { method: 'POST', auth: true });
        save(null);
        return { ok: true };
      },
      driverName,
      // Gives a signed-in account its driver name (already cleaned by Core.cleanName); a taken name is refused by the database
      setDriverName,
      // ### Adds one finished run under the signed-in account.
      async submitRun(run){
        const body = runBody(run);
        if (!body) return { ok: false, status: 400, error: errorText(400, { code: '23514' }) };
        if (!(await fresh())) return { ok: false, status: 401, error: errorText(401) };
        const r = await call('/rest/v1/runs', { method: 'POST', auth: true, body, prefer: 'return=minimal' });
        return r.ok ? { ok: true } : fail(r);
      },
      // ### Both boards of one map: everybody's best run of all time and of this calendar month. Needs no login.
      async boards(mode){
        if (!MODES.includes(mode)) return { ok: false, status: 400, error: errorText(400) };
        const q = '?select=name,time,veh,stars,driver_id&mode=eq.' + mode + '&order=time.asc,created_at.asc&limit=' + CONFIG.keep;
        const [a, m] = await Promise.all([call('/rest/v1/board_all' + q), call('/rest/v1/board_month' + q)]);
        if (!a.ok) return fail(a);
        if (!m.ok) return fail(m);
        return { ok: true, all: toRows(a.body), month: toRows(m.body) };
      }
    };
  }

  return Object.freeze({ CONFIG, PW_MIN, nameFilter, cleanEmail, passwordProblem, parseSession, sessionFrom, needsRefresh, errorText, toRows, runBody, createClient });
});
