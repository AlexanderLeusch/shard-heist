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
  // ### The code is a year: 1912, the year the "unsinkable" Titanic sank. Three spots in the room each hide one of the three
  // ### things you need, behind a short mini game: the crooked tile (the car key), the steamed-up mirror (the first two
  // ### digits) and the scratches by the door (the last two). A spot gives its clue only once its mini game is won.
  const TIME_LIMIT = 600, WRONG_CODE_PENALTY = 30, WEDGE_GRACE = 60, CODE = '1912', SAVE_KEY = 'escape-room-save';
  const ITEMS = { mop: 'Mop', carkey: 'Car key' };
  const CLUES = {
    tile: { title: 'Behind the crooked tile', text: 'The tile comes away. In a hollow behind it: a car key on a worn leather fob. Someone hid it here for you.' },
    mirror: { title: 'Writing in the steam', text: 'The steam clears around figures someone traced on the mirror: “UNSINKABLE? 19 _ _”. The first two digits of the code: 1 and 9.' },
    scratches: { title: 'Scratched into the wall by the door', text: '“The ‘unsinkable’ went down on her first voyage.” Below it, gouged deep into a tile: “_ _ 1 2”. The last two digits of the code: 1 and 2.' }
  };
  // ### The six Titanic mini games (drawn and played by minigames.js). Each new game deals three different ones to the
  // ### three spots; which three is chosen by room.js, because the rules have no randomness of their own.
  const GAMES = ['battleship', 'spotdiff', 'tictactoe', 'deckrun', 'deckclimb', 'seagull'];
  const SPOTS = { tile: 'stall', mirror: 'sinks', scratches: 'door' };
  const GRAFFITI = '“She was unsinkable. She sailed only once. — The year opens the floor.”';
  const WARNINGS = [[300, 'Officer Hale, outside: “Five minutes!”'], [120, 'Officer Hale: “Two minutes. Hurry it up in there.”'], [60, 'Keys jingle outside the door. One minute left.'], [30, 'Hale: “Thirty seconds, 4471!”']];

  // ### Scenes are the five places in the washroom. Each lists where you can go (exits) and what you can do (hotspots).
  // ### A hotspot is [action, target, label]. Which hotspots are visible right now is decided by visibleHotspots().
  const SCENES = {
    door: { title: 'The Door', text: 'A steel door with a small barred window. Officer Hale waits on the other side. Someone has scratched words into the wall beside it. In the corner: a mop in a bucket.',
      exits: ['sinks', 'stall'],
      hotspots: [['go', 'sinks', 'Sinks'], ['go', 'stall', 'Toilet stall'], ['play', 'scratches', 'Scratches by the door'], ['read', 'scratches', 'Scratches by the door'], ['take', 'mop', 'Mop and bucket'], ['wedge', null, 'Jam the door with the mop']] },
    sinks: { title: 'The Sinks', text: 'Two steel sinks under a polished metal mirror. An empty soap dish, a hot tap that still works.',
      exits: ['door', 'stall'],
      hotspots: [['go', 'door', 'Back to the door'], ['go', 'stall', 'Toilet stall'], ['tap', null, 'Hot tap'], ['play', 'mirror', 'Mirror'], ['read', 'mirror', 'Mirror']] },
    stall: { title: 'The Stall', text: 'A steel prison toilet. Words are scratched into the wall. One tile behind the toilet sits crooked. And in the floor: a hatch.',
      exits: ['door', 'sinks', 'hatch'],
      hotspots: [['go', 'door', 'Back to the door'], ['go', 'sinks', 'Sinks'], ['read', 'graffiti', 'Scratches on the wall'], ['play', 'tile', 'Crooked tile'], ['take', 'carkey', 'Car key behind the tile'], ['go', 'hatch', 'Hatch in the floor']] },
    hatch: { title: 'The Hatch', text: 'A steel trapdoor, held shut by a combination lock with four wheels. Cold air seeps up through the gap.',
      exits: ['stall'],
      hotspots: [['go', 'stall', 'Stand up'], ['lock', null, 'Combination lock']] },
    tunnel: { title: 'The Tunnel', text: 'A ladder into the dark. Somewhere below, water drips.', exits: [], hotspots: [] }
  };
  const ENDINGS = {
    A: { title: 'Ending A · Out', text: 'The lock clicks. You lower yourself into the dark and pull the hatch shut above you. Taped to the ladder is a note in neat handwriting: “Took you long enough. A car is waiting at the end of the tunnel. — H.” Officer Hale wanted you out. The question is why.' },
    B: { title: 'Ending B · Back to the cell', text: 'The door bangs open. Officer Hale and two officers drag you back to cell 4471. The hatch stays shut, and so does the case.' }
  };

  const copy = s => ({ ...s, inventory: s.inventory.slice(), clues: s.clues.slice(), lock: s.lock.slice(), warned: s.warned.slice(), games: s.games.slice() });
  // ### Three different mini games, one for each spot in the order tile, mirror, scratches.
  const validGames = g => Array.isArray(g) && g.length === 3 && g.every(x => GAMES.includes(x)) && new Set(g).size === 3;
  const spotIndex = spot => Object.keys(SPOTS).indexOf(spot);
  const result = (state, ok, message, cue) => ({ state, ok, message, cue: cue || (ok ? 'ok' : 'nope') });
  const reject = (state, message) => result(state, false, message, 'nope');

  function newState(){
    return { scene: 'intro', time: TIME_LIMIT, inventory: [], clues: [], tileOpen: false, steam: false, wedged: false, graceUsed: false,
      lock: [0, 0, 0, 0], wrongTries: 0, ending: null, warned: [], games: GAMES.slice(0, 3) };
  }
  const has = (s, item) => s.inventory.includes(item);
  const ended = s => s.ending !== null;

  // ---------- Which hotspots can be used right now ----------
  // ### The interface only offers what these functions allow, and the rules check every action again anyway.
  function visibleHotspots(s){
    const sc = SCENES[s.scene];
    if (!sc || ended(s)) return [];
    return sc.hotspots.filter(([action, target]) => {
      if (action === 'take') return !has(s, target) && !(target === 'mop' && s.wedged) && !(target === 'carkey' && !s.tileOpen);
      if (action === 'wedge') return has(s, 'mop') && !s.wedged;
      if (action === 'play') return !s.clues.includes(target);
      if (action === 'read' && target !== 'graffiti') return s.clues.includes(target);
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
      if (target !== undefined && !validGames(target)) return reject(s, 'Each spot needs a different mini game.');
      const n = copy(s); n.scene = 'door';
      if (target !== undefined) n.games = target.slice();
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
        if (!here) return reject(s, target === 'carkey' && s.scene === 'stall' ? 'The tile is still in place.' : `There is no ${ITEMS[target].toLowerCase()} here.`);
        const n = copy(s); n.inventory.push(target);
        const took = { mop: 'You lift the mop out of the bucket. The handle is long and solid.',
          carkey: 'A car key on a worn leather fob. Someone hid it here for you. You pocket it.' };
        return result(n, true, took[target], 'take');
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
        if (target === 'graffiti'){
          if (s.scene !== 'stall') return reject(s, 'You cannot see that from here.');
          return result(s, true, GRAFFITI, 'paper');
        }
        if (!Object.prototype.hasOwnProperty.call(CLUES, target) || target === 'tile') return reject(s, 'There is nothing to read there.');
        if (s.scene !== SPOTS[target]) return reject(s, 'You cannot see that from here.');
        if (!s.clues.includes(target)) return reject(s, 'You have not won this clue yet. Try the mini game first.');
        return result(s, true, CLUES[target].text, 'paper');
      }
      // ### play: the player wants to try the mini game behind a spot. It changes nothing; the answer's cue "game" tells
      // ### room.js to open the game named in s.games. The mirror only has something to play for while it is steamed up.
      // ### win: the mini game was won. The spot gives its clue (the tile also comes off the wall), once.
      case 'play':
      case 'win': {
        if (!Object.prototype.hasOwnProperty.call(SPOTS, target)) return reject(s, 'There is no mini game there.');
        if (s.scene !== SPOTS[target]) return reject(s, 'You cannot reach that from here.');
        if (s.clues.includes(target)) return reject(s, target === 'tile' ? 'The tile is already off.' : 'You already have this clue. It is in your clue notes.');
        if (target === 'mirror' && !s.steam){
          if (action === 'win') return reject(s, 'The mirror is dry. Let the hot water run first.');
          return result(s, true, 'Just your own tired face in the scratched metal. The glass looks smeared, as if someone wrote on it.', 'ok');
        }
        const game = s.games[spotIndex(target)];
        if (action === 'play') return result(s, true, game, 'game');
        const n = copy(s); n.clues.push(target);
        if (target === 'tile') n.tileOpen = true;
        return result(n, true, CLUES[target].text, target === 'tile' ? 'scrape' : 'paper');
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
      && Array.isArray(s.inventory) && s.inventory.length <= 3 && s.inventory.every(i => Object.prototype.hasOwnProperty.call(ITEMS, i)) && new Set(s.inventory).size === s.inventory.length
      && Array.isArray(s.clues) && s.clues.length <= 3 && s.clues.every(c => Object.prototype.hasOwnProperty.call(CLUES, c)) && new Set(s.clues).size === s.clues.length
      && Array.isArray(s.lock) && s.lock.length === 4 && s.lock.every(d => Number.isInteger(d) && d >= 0 && d <= 9)
      && Array.isArray(s.warned) && s.warned.every(w => WARNINGS.some(([at]) => at === w))
      && validGames(s.games)
      && s.tileOpen === s.clues.includes('tile')
      && ['tileOpen', 'steam', 'wedged', 'graceUsed'].every(k => typeof s[k] === 'boolean')
      && Number.isInteger(s.wrongTries) && s.wrongTries >= 0
      && (s.ending === null || s.ending === 'A' || s.ending === 'B')
      && !(s.wedged && s.inventory.includes('mop'))
      && !(s.inventory.includes('carkey') && !s.tileOpen)
      // only an ending leads to the cell or the tunnel; the grace minute needs the jammed door, and the car key needs the tile off
      && (s.ending === 'A' ? s.scene === 'tunnel' : s.ending === 'B' ? s.scene === 'cell' : s.scene !== 'tunnel' && s.scene !== 'cell')
      && !(s.graceUsed && !s.wedged)
      // the clock only runs down: every wrong code took 30 s from it, and only the grace minute sets it back, to one minute
      && s.wrongTries <= (TIME_LIMIT + WEDGE_GRACE) / WRONG_CODE_PENALTY + 1
      && s.time <= (s.graceUsed ? WEDGE_GRACE : Math.max(0, TIME_LIMIT - s.wrongTries * WRONG_CODE_PENALTY))
      && (s.graceUsed || s.warned.every(w => s.time <= w));
    if (!ok) return null;
    return { scene: s.scene, time: s.time, inventory: s.inventory.slice(), clues: s.clues.slice(), tileOpen: s.tileOpen, steam: s.steam,
      wedged: s.wedged, graceUsed: s.graceUsed, lock: s.lock.slice(), wrongTries: s.wrongTries, ending: s.ending, warned: s.warned.slice(), games: s.games.slice() };
  }
  const canContinue = s => !!s && s.scene !== 'intro' && !ended(s);
  // ### The player's volume, 0 to 1, stored as text. Anything else is refused and the volume stays at full.
  const VOLUME_KEY = 'escape-room-volume';
  function parseVolume(raw){
    if (typeof raw !== 'string' || !/^(0(\.\d+)?|1(\.0+)?)$/.test(raw)) return 1;
    return Number(raw);
  }

  return Object.freeze({
    TIME_LIMIT, WRONG_CODE_PENALTY, WEDGE_GRACE, CODE, SAVE_KEY, ITEMS, CLUES, SCENES, ENDINGS, WARNINGS, GAMES, SPOTS, GRAFFITI,
    newState, visibleHotspots, perform, tick, restore, canContinue, VOLUME_KEY, parseVolume
  });
});
