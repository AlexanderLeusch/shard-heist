// Room 1, the escape room: the story and the rules as pure functions, with no DOM, no three.js and no randomness.
// ### room.js loads this file as window.EscapeRules and the Node tests load it with require(). It follows the structure of
// ### the original Plot Twist project: the state is a plain object, perform(state, action, target) returns a NEW state for
// ### an accepted action and the SAME state (unchanged) for a rejected one, together with a message for the player.
// ### tick() runs the ten-minute clock. Nothing here knows how the room is drawn.
(function (root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EscapeRules = factory();
})(typeof self !== 'undefined' ? self : this, function (){
  'use strict';

  // ---------- Fixed story content ----------
  // ### The code is a year: 1912, the year the "unsinkable" Titanic sank. Three clues in the room point to it, and one of
  // ### them (the graffiti) also gives the missing digit to players who do not know the history.
  const TIME_LIMIT = 600, WRONG_CODE_PENALTY = 30, WEDGE_GRACE = 60, CODE = '1912', SAVE_KEY = 'escape-room-save';
  const ITEMS = { spoon: 'Spoon', mop: 'Mop' };
  const CLUES = {
    mirror: { title: 'Writing in the steam', text: 'Someone traced letters on the mirror. In the steam they read: “UNSINKABLE?”' },
    graffiti: { title: 'Scratched into the stall wall', text: '“She was unsinkable. She sailed only once. — The year opens the floor.”' },
    scrap: { title: 'Newspaper scrap behind the tile', text: '“…the ‘unsinkable’ liner went down on her first voyage. 15 April 19▒2. More than 1,500 lost…”' }
  };
  const WARNINGS = [[300, 'Officer Hale, outside: “Five minutes!”'], [120, 'Officer Hale: “Two minutes. Hurry it up in there.”'], [60, 'Keys jingle outside the door. One minute left.'], [30, 'Hale: “Thirty seconds, 4471!”']];

  // ### Scenes are the five places in the washroom. Each lists where you can go (exits) and what you can do (hotspots).
  // ### A hotspot is [action, target, label]. Which hotspots are visible right now is decided by visibleHotspots().
  const SCENES = {
    door: { title: 'The Door', text: 'A steel door with a small barred window. Officer Hale waits on the other side. In the corner: a mop in a bucket.',
      exits: ['sinks', 'stall'],
      hotspots: [['go', 'sinks', 'Sinks'], ['go', 'stall', 'Toilet stall'], ['take', 'mop', 'Mop and bucket'], ['wedge', null, 'Jam the door with the mop']] },
    sinks: { title: 'The Sinks', text: 'Two steel sinks under a polished metal mirror. A soap dish, a hot tap that still works.',
      exits: ['door', 'stall'],
      hotspots: [['go', 'door', 'Back to the door'], ['go', 'stall', 'Toilet stall'], ['take', 'spoon', 'Soap dish'], ['tap', null, 'Hot tap'], ['read', 'mirror', 'Mirror']] },
    stall: { title: 'The Stall', text: 'A steel prison toilet. Words are scratched into the wall. One tile behind the toilet sits crooked. And in the floor: a hatch.',
      exits: ['door', 'sinks', 'hatch'],
      hotspots: [['go', 'door', 'Back to the door'], ['go', 'sinks', 'Sinks'], ['read', 'graffiti', 'Scratches on the wall'], ['pry', null, 'Crooked tile'], ['read', 'scrap', 'Paper behind the tile'], ['go', 'hatch', 'Hatch in the floor']] },
    hatch: { title: 'The Hatch', text: 'A steel trapdoor, held shut by a combination lock with four wheels. Cold air seeps up through the gap.',
      exits: ['stall'],
      hotspots: [['go', 'stall', 'Stand up'], ['lock', null, 'Combination lock']] },
    tunnel: { title: 'The Tunnel', text: 'A ladder into the dark. Somewhere below, water drips.', exits: [], hotspots: [] }
  };
  const ENDINGS = {
    A: { title: 'Ending A · Out', text: 'The lock clicks. You lower yourself into the dark and pull the hatch shut above you. Taped to the ladder is a note in neat handwriting: “Took you long enough. A car is waiting at the end of the tunnel. — H.” Officer Hale wanted you out. The question is why.' },
    B: { title: 'Ending B · Back to the cell', text: 'The door bangs open. Officer Hale and two officers drag you back to cell 4471. The hatch stays shut, and so does the case.' }
  };

  const copy = s => ({ ...s, inventory: s.inventory.slice(), clues: s.clues.slice(), lock: s.lock.slice(), warned: s.warned.slice() });
  const result = (state, ok, message, cue) => ({ state, ok, message, cue: cue || (ok ? 'ok' : 'nope') });
  const reject = (state, message) => result(state, false, message, 'nope');

  function newState(){
    return { scene: 'intro', time: TIME_LIMIT, inventory: [], clues: [], tileOpen: false, steam: false, wedged: false, graceUsed: false,
      lock: [0, 0, 0, 0], wrongTries: 0, ending: null, warned: [] };
  }
  const has = (s, item) => s.inventory.includes(item);
  const ended = s => s.ending !== null;

  // ---------- Which hotspots can be used right now ----------
  // ### The interface only offers what these functions allow, and the rules check every action again anyway.
  function visibleHotspots(s){
    const sc = SCENES[s.scene];
    if (!sc || ended(s)) return [];
    return sc.hotspots.filter(([action, target]) => {
      if (action === 'take') return !has(s, target) && !(target === 'mop' && s.wedged);
      if (action === 'wedge') return has(s, 'mop') && !s.wedged;
      if (action === 'pry') return !s.tileOpen;
      if (action === 'read' && target === 'scrap') return s.tileOpen;
      return true;
    }).map(([action, target, label]) => ({ action, target, label }));
  }

  // ---------- Actions ----------
  // ### Every action checks first whether it is allowed. A refused action returns the old state untouched, so nothing is
  // ### saved and nothing changes; the message tells the player why.
  function perform(s, action, target){
    if (action === 'new') return result(newState(), true, 'A new night begins.', 'ok');
    if (ended(s)) return reject(s, 'The story is over. Start a new game to play again.');
    if (action === 'start'){
      if (s.scene !== 'intro') return reject(s, 'The clock is already running.');
      const n = copy(s); n.scene = 'door';
      return result(n, true, 'The lock clicks behind you. Ten minutes.', 'door');
    }
    if (s.scene === 'intro') return reject(s, 'Read the briefing first.');
    const here = visibleHotspots(s).some(h => h.action === action && (h.target === (target === undefined ? null : target)));

    switch (action){
      case 'go': {
        if (!SCENES[s.scene].exits.includes(target)) return reject(s, 'You cannot get there from here.');
        const n = copy(s); n.scene = target;
        return result(n, true, SCENES[target].text, 'step');
      }
      case 'take': {
        if (!Object.prototype.hasOwnProperty.call(ITEMS, target)) return reject(s, 'There is nothing like that here.');
        if (has(s, target) || (target === 'mop' && s.wedged)) return reject(s, `You already have the ${ITEMS[target].toLowerCase()}.`);
        if (!here) return reject(s, `There is no ${ITEMS[target].toLowerCase()} here.`);
        const n = copy(s); n.inventory.push(target);
        return result(n, true, target === 'spoon' ? 'A bent metal spoon, left in the soap dish. You slip it into your sleeve.' : 'You lift the mop out of the bucket. The handle is long and solid.', 'take');
      }
      case 'wedge': {
        if (s.scene !== 'door') return reject(s, 'You need to be at the door for that.');
        if (s.wedged) return reject(s, 'The door is already jammed.');
        if (!has(s, 'mop')) return reject(s, 'You need something long and solid to jam the door.');
        const n = copy(s); n.inventory = n.inventory.filter(i => i !== 'mop'); n.wedged = true;
        return result(n, true, 'You jam the mop handle under the door handle. That should hold Hale off for a while.', 'wedge');
      }
      case 'tap': {
        if (s.scene !== 'sinks') return reject(s, 'There is no tap here.');
        const n = copy(s); n.steam = !s.steam;
        return result(n, true, n.steam ? 'Hot water hisses into the sink. Steam creeps up the mirror.' : 'You turn the hot tap off.', 'water');
      }
      case 'read': {
        if (!Object.prototype.hasOwnProperty.call(CLUES, target)) return reject(s, 'There is nothing to read there.');
        if (!here) return reject(s, target === 'scrap' ? 'The tile is still in place.' : 'You cannot see that from here.');
        if (target === 'mirror' && !s.steam) return result(s, true, 'Just your own tired face in the scratched metal. The glass looks smeared, as if someone wrote on it.', 'ok');
        const n = copy(s); if (!n.clues.includes(target)) n.clues.push(target);
        return result(n, true, CLUES[target].text, 'paper');
      }
      case 'pry': {
        if (s.scene !== 'stall') return reject(s, 'There is no loose tile here.');
        if (s.tileOpen) return reject(s, 'The tile is already off.');
        if (!has(s, 'spoon')) return reject(s, 'The tile wobbles, but your fingers cannot get behind it. Something thin and hard would do.');
        const n = copy(s); n.tileOpen = true;
        return result(n, true, 'You work the spoon into the grout. The tile comes away. Behind it: a folded scrap of newspaper.', 'scrape');
      }
      case 'turn': {
        if (s.scene !== 'hatch') return reject(s, 'Kneel down at the hatch to reach the lock.');
        const [i, dir] = Array.isArray(target) ? target : [];
        if (!Number.isInteger(i) || i < 0 || i > 3 || (dir !== 1 && dir !== -1)) return reject(s, 'The lock only has four wheels.');
        const n = copy(s); n.lock[i] = (n.lock[i] + dir + 10) % 10;
        return result(n, true, '', 'tick');
      }
      case 'try': {
        if (s.scene !== 'hatch') return reject(s, 'Kneel down at the hatch to reach the lock.');
        if (s.lock.join('') === CODE){
          const n = copy(s); n.scene = 'tunnel'; n.ending = 'A';
          return result(n, true, ENDINGS.A.text, 'open');
        }
        // A wrong code is a refused action for the lock, but the noise costs time: this is the one accepted penalty
        const n = copy(s); n.wrongTries++; n.time = Math.max(0, n.time - WRONG_CODE_PENALTY);
        return result(n, true, `Clunk. The lock holds. Outside, Hale: “What was that noise?” (−${WRONG_CODE_PENALTY} s)`, 'clunk');
      }
      default:
        return reject(s, 'That is not possible.');
    }
  }

  // ---------- The clock ----------
  // ### Runs only while playing. At zero, a jammed door (the earlier decision) buys one minute of grace; without it, or
  // ### after it, Hale opens the door and the game ends with Ending B. Warnings are announced once each.
  function tick(s, dt){
    if (s.scene === 'intro' || ended(s) || !(dt > 0)) return { state: s, message: '' };
    const n = copy(s);
    n.time = Math.max(0, n.time - Math.min(dt, 1));
    let message = '', cue = '';
    for (const [at, text] of WARNINGS){
      if (n.time <= at && !n.warned.includes(at)){ n.warned.push(at); message = text; cue = 'warn'; }
    }
    if (n.time <= 0){
      if (n.wedged && !n.graceUsed){
        n.graceUsed = true; n.time = WEDGE_GRACE;
        message = 'The handle rattles. Hale: “Why won’t this open?” The mop holds. For now.'; cue = 'rattle';
      } else {
        n.ending = 'B'; n.scene = 'cell';
        message = ENDINGS.B.text; cue = 'bang';
      }
    }
    return { state: n, message, cue };
  }

  // ---------- Saving and loading ----------
  // ### Progress is saved in the browser after every accepted action. Saved data comes from outside the program, so
  // ### restore() checks every field and returns null for anything that does not look exactly like a real save.
  function restore(raw){
    if (typeof raw !== 'string' || raw.length > 2000) return null;
    let s; try { s = JSON.parse(raw); } catch (e) { return null; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const scenes = Object.keys(SCENES).concat('intro', 'cell');
    const ok = typeof s.scene === 'string' && scenes.includes(s.scene)
      && Number.isFinite(s.time) && s.time >= 0 && s.time <= TIME_LIMIT
      && Array.isArray(s.inventory) && s.inventory.length <= 2 && s.inventory.every(i => Object.prototype.hasOwnProperty.call(ITEMS, i)) && new Set(s.inventory).size === s.inventory.length
      && Array.isArray(s.clues) && s.clues.length <= 3 && s.clues.every(c => Object.prototype.hasOwnProperty.call(CLUES, c))
      && Array.isArray(s.lock) && s.lock.length === 4 && s.lock.every(d => Number.isInteger(d) && d >= 0 && d <= 9)
      && Array.isArray(s.warned) && s.warned.every(w => WARNINGS.some(([at]) => at === w))
      && ['tileOpen', 'steam', 'wedged', 'graceUsed'].every(k => typeof s[k] === 'boolean')
      && Number.isInteger(s.wrongTries) && s.wrongTries >= 0
      && (s.ending === null || s.ending === 'A' || s.ending === 'B')
      && !(s.wedged && s.inventory.includes('mop'))
      && !(s.clues.includes('scrap') && !s.tileOpen);
    if (!ok) return null;
    return { scene: s.scene, time: s.time, inventory: s.inventory.slice(), clues: s.clues.slice(), tileOpen: s.tileOpen, steam: s.steam,
      wedged: s.wedged, graceUsed: s.graceUsed, lock: s.lock.slice(), wrongTries: s.wrongTries, ending: s.ending, warned: s.warned.slice() };
  }
  const canContinue = s => !!s && s.scene !== 'intro' && !ended(s);

  return Object.freeze({
    TIME_LIMIT, WRONG_CODE_PENALTY, WEDGE_GRACE, CODE, SAVE_KEY, ITEMS, CLUES, SCENES, ENDINGS, WARNINGS,
    newState, visibleHotspots, perform, tick, restore, canContinue
  });
});
