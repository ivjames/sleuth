/* ===========================================================================
   SLEUTH — A Murder Mystery
   A browser clone of Eric N. Miller's 1983 DOS whodunit (Norland Software).

   The case is randomized every game: murderer, weapon, room, victim, the house
   (a one-story estate or a two-story mansion with stairs), and the location of
   the magnifying glass. You solve it by:
     • finding the bloodstains-> reveals the ROOM (a guest may be staring at
                                 the floor there — usually, but not always)
     • finding the weapon     -> reveals the WEAPON (examine needs the glass)
     • cross-examining alibis -> reveals the MURDERER (one liar; nobody backs
                                 up their story)
   Question people too often and the killer grows suspicious. Run out of time,
   or accuse the wrong person, and you die.
   =========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   Static data
   -------------------------------------------------------------------------- */

// The house is the exact hand-drawn one-story floorplan below — a monospaced
// block-glyph map (█ full outer walls, ▀▄▌▐ + corners for interior half-walls,
// ─ staircase steps, spaces are floor). You walk it as a dot: any block glyph is
// solid, spaces are open floor. Rooms are named zones laid over that floor.
const MAP = [
  "████████████████████████████████████████",
  "█      ▐    ▌               ▌   ▌      █",
  "█      ▐    ▌               ▌          █",
  "█           ▙▄▄▄▄▄▄  ▄▄▄▄▄▄▄▌   ▌      █",
  "█      ▐                        ▙▄▄▄▄▄▄█",
  "█      ▐                        ▌      █",
  "█▀▀▀▀▀▀▜    ▛▀▀▀▀▀▀▌ ▛▀▀▀▀▀▜    ▌      █",
  "█      ▐           ▌ ▌     ▐           █",
  "█▄▄▄▄▄▄▟    ▙▄▄▄▄▄▄▌ ▌     ▐    ▌      █",
  "█      ▐             ▌          ▙▄▄▄▄▄▄█",
  "█           ▛▀▀▀▀▀▀▀▀▌     ▐    ▌      █",
  "█      ▐             ▌     ▐           █",
  "█      ▐────▌        ▌     ▐────▌      █",
  "█      ▐────▌        ▌     ▐────▌      █",
  "█████████  ██████████████████  █████████",
];
const MAPW = 40, MAPH = MAP.length;

// Named rooms. Each is a zone centred on a floor tile; every reachable floor tile
// joins the nearest centre it can actually walk to. The Sewing Room sits behind
// sealed walls with no doorway — only the SECRET PASSAGE reaches it.
const ZONE_DEFS = [
  ['Parlor', 3, 3], ['Sewing Room', 3, 7], ['Study', 3, 11],
  ['West Hall', 9, 5], ['Grand Foyer', 20, 1], ['Dining Hall', 16, 7],
  ['Ballroom', 24, 10], ['Music Room', 16, 12], ['East Hall', 29, 6],
  ['Master Bedroom', 35, 2], ['Bathroom', 35, 6], ['Kitchen', 35, 11],
];
const START_TILE = { x: 9, y: 13 };   // you begin at the front door (left stair)
const SEALED_ROOM = 1;                 // Sewing Room — reached only by the passage

// Room flavour, drawn from the original's own descriptions where we have them.
const ROOM_FLAVOR = {
  'Parlor':         'A large sofa sits in the middle of the room; through the window you can see the front lawn. An antique silver teapot rests on a side table.',
  'Sewing Room':    'Many overstuffed chairs sit in a circle. It feels forgotten — no ordinary door leads here.',
  'Study':          'Leather-bound books line the shelves and a heavy oak desk faces the door.',
  'West Hall':      'You are walking through the west hall; the walls are papered in a tasteful floral design.',
  'Grand Foyer':    'A wide entrance hall. Portraits of stern ancestors watch you from the walls.',
  'Dining Hall':    'A long teak table runs from one end of the room to the other, a wet bar near the entrance. A silver serving platter is perched on its edge.',
  'Ballroom':       'The room is bare except for a waxed parquet floor that stretches wide and empty.',
  'Music Room':     'A grand piano sits in the corner, its lid raised over silent keys.',
  'East Hall':      'You are walking through the east hall; small crystal lamps light the walls.',
  'Master Bedroom': 'A Scandinavian bed dominates the room. A teak dresser spans the west wall, and a jewel-encrusted mirror lies at the foot of the bed.',
  'Bathroom':       'A hot tub occupies one corner and a large mirror covers the east wall. A soap tray sits beside the jacuzzi.',
  'Kitchen':        'The room is equipped for large cooking tasks — this family prizes fine cuisine. A bright brass pot hangs from the ceiling.',
};

// The current game's mansion, (re)built by buildMansion() at the start of each
// game. Rooms have a stable global index; ROOMS[i] is the name, ADJ[i] maps a
// direction (N/S/E/W within a floor, U/D via stairs) to the neighbouring index.
let ROOMS = [];          // global index -> room name
let ADJ = [];            // global index -> { N,S,E,W,U,D: index }
let FLOORS = [];         // per floor -> { name, w, h, cells, tiles, owner, W, H }
let ROOM_META = [];      // global index -> { floor, r, c, stair, rect, stairTile }
let STORIES = 1;

// Tile floorplan: each room is a walled rectangle, neighbours joined by a
// doorway gap in the shared wall — an overhead line-drawn map you walk with a
// dot, like the original. Rooms share walls (1 tile thick).
const TILE = { WALL: 0, FLOOR: 1, STAIR: 3, PASSAGE: 4 };
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isWalkGlyph = ch => ch === ' ' || ch === '─';

// Parse the block-glyph MAP into a walkable floorplan and lay the named rooms over
// it. tiles[y][x] is WALL / FLOOR / STAIR; owner[y][x] is the room that owns that
// floor tile (a multi-source flood from each room centre, so every tile joins the
// nearest room it can actually reach — the sealed Sewing Room stays its own island).
function buildHouse() {
  ROOMS = []; ADJ = []; FLOORS = []; ROOM_META = []; STORIES = 1;

  const glyph = MAP.map(r => Array.from(r.padEnd(MAPW, ' ')));
  const walk = (x, y) => x >= 0 && y >= 0 && x < MAPW && y < MAPH && isWalkGlyph(glyph[y][x]);
  const tiles = glyph.map(row => row.map(ch => ch === ' ' ? TILE.FLOOR : ch === '─' ? TILE.STAIR : TILE.WALL));
  const owner = Array.from({ length: MAPH }, () => new Array(MAPW).fill(-1));
  const dist  = Array.from({ length: MAPH }, () => new Array(MAPW).fill(Infinity));

  ZONE_DEFS.forEach(([name]) => { ROOMS.push(name); ADJ.push({}); ROOM_META.push({ floor: 0, stair: false }); });

  // multi-source BFS: seed each room's centre, spread over floor, nearest centre wins
  const q = [];
  ZONE_DEFS.forEach(([n, cx, cy], i) => { if (walk(cx, cy)) { owner[cy][cx] = i; dist[cy][cx] = 0; q.push([cx, cy]); } });
  for (let h = 0; h < q.length; h++) {
    const [x, y] = q[h];
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (walk(nx, ny) && dist[ny][nx] > dist[y][x] + 1) { dist[ny][nx] = dist[y][x] + 1; owner[ny][nx] = owner[y][x]; q.push([nx, ny]); }
    }
  }

  // per-room bounding box + representative interior tile (its centre)
  const bb = ZONE_DEFS.map(() => ({ x0: MAPW, y0: MAPH, x1: -1, y1: -1 }));
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    const o = owner[y][x];
    if (o >= 0) { const b = bb[o]; if (x < b.x0) b.x0 = x; if (y < b.y0) b.y0 = y; if (x > b.x1) b.x1 = x; if (y > b.y1) b.y1 = y; }
  }
  ZONE_DEFS.forEach(([n, cx, cy], i) => {
    const b = bb[i];
    ROOM_META[i].rect = { x: b.x1 < 0 ? cx : b.x0, y: b.y1 < 0 ? cy : b.y0, w: Math.max(1, b.x1 - b.x0 + 1), h: Math.max(1, b.y1 - b.y0 + 1), floor: 0 };
    ROOM_META[i].center = { x: cx, y: cy };
  });

  // room graph: rooms whose floor tiles touch are neighbours; direction from centres
  const link = (a, b) => {
    if (a === b || Object.values(ADJ[a]).includes(b)) return;
    const A = ROOM_META[a].center, B = ROOM_META[b].center;
    const dx = B.x - A.x, dy = B.y - A.y, horiz = Math.abs(dx) >= Math.abs(dy);
    const prefer = horiz ? (dx >= 0 ? ['E', 'W'] : ['W', 'E']) : (dy >= 0 ? ['S', 'N'] : ['N', 'S']);
    const alt    = horiz ? (dy >= 0 ? ['S', 'N'] : ['N', 'S']) : (dx >= 0 ? ['E', 'W'] : ['W', 'E']);
    const put = ([da, db]) => (ADJ[a][da] == null && ADJ[b][db] == null) && (ADJ[a][da] = b, ADJ[b][db] = a, true);
    put(prefer) || put(alt) || (ADJ[a]['x' + b] = b, ADJ[b]['x' + a] = a);  // last resort: keep them linked
  };
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    const o = owner[y][x]; if (o < 0) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) { const nx = x + dx, ny = y + dy; if (walk(nx, ny) && owner[ny][nx] >= 0 && owner[ny][nx] !== o) link(o, owner[ny][nx]); }
  }

  FLOORS.push({ name: '', W: MAPW, H: MAPH, tiles, owner, glyph });
}

// which room can be reached from START_TILE via the room graph (the sealed room
// is excluded until the passage opens). Used to keep essential clues reachable.
function reachableRooms() {
  const start = FLOORS[0].owner[START_TILE.y][START_TILE.x];
  const seen = new Set([start]), st = [start];
  while (st.length) { const c = st.pop(); for (const k of Object.keys(ADJ[c])) { const nb = ADJ[c][k]; if (k !== 'P' && !seen.has(nb)) { seen.add(nb); st.push(nb); } } }
  return seen;
}

const DIR_WORD = { N: 'north', S: 'south', E: 'east', W: 'west', U: 'upstairs', D: 'downstairs' };
const roomAt = (floor, x, y) => {
  const f = FLOORS[floor];
  if (!f || y < 0 || y >= f.H || x < 0 || x >= f.W) return -1;
  return f.owner[y][x];
};

// There is no body — the murder room is betrayed by what it leaves on the floor.
// `scene` is what a close look at the stains reveals; `klass` is the category it
// points to (several weapons share a category on purpose, so the scene narrows
// the field and finding the actual weapon gives certainty).
const WEAPONS = [
  { name: 'Knife',        scene: 'clean, deep bloodstains and a slash torn across the rug', klass: 'a bladed weapon' },
  { name: 'Revolver',     scene: 'a bullet hole in the panelling and powder scorch marks',  klass: 'a firearm' },
  { name: 'Candlestick',  scene: 'a wide arc of blood spatter — a heavy swinging blow',      klass: 'a blunt weapon' },
  { name: 'Lead Pipe',    scene: 'heavy blood spatter pooled across the floorboards',        klass: 'a blunt weapon' },
  { name: 'Rope',         scene: 'almost no blood — only deep heel-scuffs and frayed fibres', klass: 'a strangling weapon' },
  { name: 'Wrench',       scene: 'a heavy crushing stain and a greasy tool-mark',            klass: 'a blunt weapon' },
  { name: 'Poison',       scene: 'no blood at all — a spilled glass and a bitter-almond smell', klass: 'poison' },
  { name: 'Letter Opener',scene: 'a small, neat pool of blood',                              klass: 'a slim blade' },
];

const DECOYS = [
  'a torn photograph',      'muddy footprints on the rug', 'an overturned chair',
  'a half-empty wine glass','a smouldering cigar',         'a cryptic note',
  'a shattered vase',       'a bloodstained handkerchief',  'a dropped glove',
];
const DECOY_FLAVOR = {
  'a torn photograph':          'Two faces, one torn away. Old grudges, perhaps — but no help here.',
  'muddy footprints on the rug':'Fresh mud, size ten. They lead in circles. A dead end.',
  'an overturned chair':        'Knocked over in a hurry. Tells you nothing you can use.',
  'a half-empty wine glass':    'Lipstick on the rim. The vintage is excellent. The clue is not.',
  'a smouldering cigar':        'Still warm. Someone was here recently, but it names no one.',
  'a cryptic note':             '"Meet me at midnight." Unsigned, undated. Frustrating.',
  'a shattered vase':           'Ming, and ruined. A shame, but not evidence.',
  'a bloodstained handkerchief':'Monogrammed "R" — the victim\'s own. A red herring.',
  'a dropped glove':            'Fine kid leather. Could belong to anyone at the party.',
};

const DIFF = {
  easy:   { turns: 60, suspThreshold: 7, label: 'Rookie' },
  normal: { turns: 44, suspThreshold: 5, label: 'Detective' },
  hard:   { turns: 30, suspThreshold: 3, label: 'Master Sleuth' },
};

// map marker for the discovered crime scene (red, unlike the plain glass/weapon marks)
const BLOOD_MARK = '<span class="bad">✖</span>';

// what you first notice on the floor of the murder room (weapon-appropriate)
function sceneNoun(weapon) {
  if (/poison/i.test(weapon.name)) return 'a spilled glass and a dark patch on the floor';
  if (/rope/i.test(weapon.name))   return 'deep scuff marks on the floor';
  return 'dark stains on the floorboards';
}

/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */

const rnd     = n => Math.floor(Math.random() * n);
const pick    = arr => arr[rnd(arr.length)];
const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// direction -> neighbouring room index, for the current mansion (N/S/E/W + stairs)
const neighbors = i => ADJ[i] || {};
const $ = sel => document.querySelector(sel);

/* --------------------------------------------------------------------------
   Game state
   -------------------------------------------------------------------------- */

let G = null; // current game

function newGame(names, diffKey) {
  const diff = DIFF[diffKey] || DIFF.normal;

  // The party is EIGHT guests, as in the original — deduped, padded from the
  // defaults if you named fewer, trimmed if you named more. One of the eight is
  // chosen (at random) as the deceased; the remaining seven are the suspects,
  // one of whom is the murderer. In customized play that means one of the names
  // you entered — perhaps your own — turns up dead.
  let guests = [];
  for (const s of names.map(x => x.trim()).filter(Boolean)) if (!guests.includes(s)) guests.push(s);
  const fillers = ['Lord Ashford','Lady Vaughn','Dr. Crane','Miss Ivory','Captain Reed','Mr. Bishop','Mrs. Pearl','Sir Blake'];
  for (const f of fillers) { if (guests.length >= 8) break; if (!guests.includes(f)) guests.push(f); }
  guests = guests.slice(0, 8);                       // exactly eight guests

  const victim   = pick(guests);                     // one of the eight is the deceased
  let suspects   = guests.filter(n => n !== victim); // the remaining seven are suspects

  // The house is the fixed one-story estate (the hand-drawn floorplan).
  buildHouse();

  // Essential clues go in rooms you can actually walk to (the sealed Sewing Room
  // is off-limits until the passage opens, so it never hides a must-find clue).
  const reach = [...reachableRooms()];
  const pickReach = () => pick(reach);

  const murderRoom = pickReach();
  const weapon     = pick(WEAPONS);
  const glassRoom  = pickReach();

  // hide the bloodied weapon somewhere reachable (the killer stashed it)
  let weaponRoom = pickReach();

  // choose the murderer
  const murdererName = pick(suspects);

  /* ---- Build the alibi network (this is what makes the case solvable) ----
     Every innocent is grouped with at least one other innocent, and each names
     the others in their group. The murderer alone claims a room + witness that
     nobody corroborates: the "witness" they name never places them there.      */
  const innocents = suspects.filter(n => n !== murdererName);
  const groups = [];
  {
    const pool = shuffle(innocents);
    while (pool.length) {
      if (pool.length === 3 || pool.length === 1) { groups.push(pool.splice(0, pool.length === 1 ? 1 : 3)); }
      else groups.push(pool.splice(0, 2));
    }
    // avoid a lone innocent with no corroborator: merge a singleton into another group
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].length === 1 && groups.length > 1) {
        const target = groups.find((g, gi) => gi !== i);
        target.push(groups[i][0]); groups.splice(i, 1);
      }
    }
  }

  // assign each group a distinct true room (not the murder room)
  const availRooms = shuffle([...Array(ROOMS.length).keys()].filter(r => r !== murderRoom));
  const people = {}; // name -> record
  people[murdererName] = { name: murdererName, isMurderer: true, trueRoom: murderRoom, group: [] };

  groups.forEach((grp, gi) => {
    const room = availRooms[gi % availRooms.length];
    grp.forEach(n => { people[n] = { name: n, isMurderer: false, trueRoom: room, group: grp.filter(x => x !== n) }; });
  });

  // the murderer's lie: claim to have been in a room that DOES hold innocents,
  // and name one of those innocents as an "alibi witness" (who will deny it)
  const witnessGroup = groups.find(g => g.length >= 1) || innocents;
  const claimWitness = pick(witnessGroup);
  const claimRoom    = people[claimWitness].trueRoom;
  people[murdererName].claimRoom = claimRoom;
  people[murdererName].claimWitness = claimWitness;

  // build objects per room. There is no body — the murder room is marked only
  // by what's on the floor (blood, or in a poisoning, a spilled glass).
  const objects = {}; // roomIndex -> object
  objects[murderRoom] = { kind: 'blood', label: sceneNoun(weapon), examined: false };
  if (!objects[weaponRoom]) objects[weaponRoom] = { kind: 'weapon', label: 'a suspicious bundle', examined: false };
  else weaponRoom = murderRoom; // weapon left at the scene; the stain chip is already there
  const weaponAtScene = (weaponRoom === murderRoom);

  // scatter a few decoys in empty rooms
  const decoyRooms = shuffle([...Array(ROOMS.length).keys()].filter(r => r !== murderRoom && r !== weaponRoom && r !== glassRoom));
  const chosenDecoys = shuffle(DECOYS).slice(0, 4);
  chosenDecoys.forEach((d, i) => { if (decoyRooms[i] != null) objects[decoyRooms[i]] = { kind: 'decoy', label: d, examined: false }; });

  // suspects' CURRENT positions (they roam; separate from their alibi trueRoom).
  // They use ordinary doors, never the passage, so they stay in reachable rooms.
  const positions = {};
  suspects.forEach(n => { positions[n] = pickReach(); });

  // A secret passage: a hidden panel (found by probing the wallpaper) opens a
  // shortcut to the sealed Sewing Room — the one room with no ordinary doorway.
  // It stays hidden (no ADJ link, no tile) until you discover it.
  const panelRoom = pick(reach.filter(r => r !== SEALED_ROOM && r !== murderRoom)) ?? pickReach();
  const exitRoom  = SEALED_ROOM;
  const passage = { panelRoom, exitRoom, found: false, probes: 0, used: false };

  G = {
    diff, diffKey,
    stories: STORIES,        // 1 or 2 — the house drawn this game
    suspects, murdererName, weapon, victim,
    murderRoom, weaponRoom, weaponAtScene, glassRoom,
    people, objects, positions, passage,
    player: FLOORS[0].owner[START_TILE.y][START_TILE.x],  // ROOM you're standing in
    pfloor: 0,                                            // one story: always floor 0
    px: START_TILE.x, py: START_TILE.y,                   // the dot's tile (front door)
    hasGlass: false,
    turnsLeft: diff.turns,
    suspicion: 0,
    hunting: false,          // killer actively looking for you
    questioned: {},          // name -> count
    over: false,
    // discoveries
    knownRoom: null,         // room name once the bloodstains are found
    knownWeapon: null,       // weapon name once weapon examined
    woundHint: null,
    visited: new Set([FLOORS[0].owner[START_TILE.y][START_TILE.x]]),
    markers: {},             // roomIndex -> Set of symbols discovered
    notes: [],               // alibi notes {name, text}
  };
  return G;
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

function addMarker(room, sym) {
  if (!G.markers[room]) G.markers[room] = new Set();
  G.markers[room].add(sym);
}

function log(text, cls = 'evt') {
  const el = document.createElement('div');
  el.className = 'line ' + cls;
  el.innerHTML = text;
  const box = $('#log');
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const BLOCK_RE = /[█▀▄▌▐▙▟▛▜▖▗▘▝▚▞]/;   // any wall glyph in the map

// Draw the hand-drawn floorplan exactly as authored (block glyphs and all), with
// the player as a dot walking the open floor and the guests as lettered dots.
function renderMap() {
  const map = $('#map');
  map.innerHTML = '';

  // overlays: guests (their initial) placed within their current room, then you
  const overlay = {};
  const perRoom = {};
  G.suspects.forEach(n => {
    const ri = G.positions[n], m = ROOM_META[ri];
    const off = (perRoom[ri] = (perRoom[ri] || 0) + 1) - 1;
    const gx = m.center.x + (off % 2), gy = m.center.y + ((off / 2) | 0);
    overlay[gy + ',' + gx] = { ch: '☻', cls: 'g-guest' };   // anonymous guests, as the original (CP437 smiley)
  });
  overlay[G.py + ',' + G.px] = { ch: '@', cls: 'g-you' };
  // open-passage endpoints show a '=' where you can slip through
  const P = G.passage;
  if (P.found) [P.panelRoom, P.exitRoom].forEach(r => {
    const t = ROOM_META[r].passageTile; if (t && !overlay[t.y + ',' + t.x]) overlay[t.y + ',' + t.x] = { ch: '=', cls: 'g-pass' };
  });

  FLOORS.forEach((f) => {
    const wrap = document.createElement('div');
    wrap.className = 'floor';
    const pre = document.createElement('pre');
    pre.className = 'floormap';
    let html = '';
    for (let y = 0; y < f.H; y++) {
      let run = '', runCls = null;
      const flush = () => { if (run) { html += runCls ? `<span class="${runCls}">${escHtml(run)}</span>` : escHtml(run); run = ''; } };
      for (let x = 0; x < f.W; x++) {
        const ov = overlay[y + ',' + x];
        let ch, cls;
        if (ov) { ch = ov.ch; cls = ov.cls; }
        else {
          const g = f.glyph[y][x];
          if (BLOCK_RE.test(g))     { ch = g;   cls = 'g-wall'; }
          else if (g === '─')       { ch = '─'; cls = 'g-stair'; }
          else if (f.owner[y][x] === G.player) { ch = '·'; cls = 'g-here'; }  // floor of the room you're in
          else { ch = ' '; cls = null; }
        }
        if (cls !== runCls) { flush(); runCls = cls; }
        run += ch;
      }
      flush();
      html += '\n';
    }
    pre.innerHTML = html;
    wrap.appendChild(pre);
    map.appendChild(wrap);
  });
}

function renderRoom() {
  const i = G.player;
  $('#room-title').innerHTML = ROOMS[i].toUpperCase();
  const adj = neighbors(i);
  const dirs = Object.keys(adj).filter(d => DIR_WORD[d]).map(d => DIR_WORD[d]).join(', ') || 'nowhere obvious';
  const flavor = ROOM_FLAVOR[ROOMS[i]] ? ` ${ROOM_FLAVOR[ROOMS[i]]}` : '';
  let desc = `You are in the <span class="hl">${ROOMS[i]}</span>.${flavor} Exits lead <span class="cyan">${dirs}</span>.`;
  // secret-passage hint / exit
  const P = G.passage;
  if (i === P.panelRoom && !P.found) desc += ` The wallpaper's repeating pattern doesn't quite line up in one corner… <span class="dim">(SEARCH it.)</span>`;
  if (P.found && (i === P.panelRoom || i === P.exitRoom)) desc += ` A <span class="clue">secret passage</span> opens from here. <span class="dim">(PASSAGE)</span>`;
  $('#room-desc').innerHTML = desc;

  // occupants
  const here = G.suspects.filter(n => G.positions[n] === i);
  const occ = $('#room-occupants');
  if (here.length) {
    occ.innerHTML = `<span class="field-label">Present:</span><br>` +
      here.map(n => `<span class="chip person" data-q="${enc(n)}">${n}</span>`).join('');
  } else {
    occ.innerHTML = `<span class="field-label">No one else is here.</span>`;
  }

  // objects
  const obj = G.objects[i];
  const objBox = $('#room-objects');
  let html = '';
  if (i === G.glassRoom && !G.hasGlass) {
    html += `<span class="chip object" data-take="glass">✦ a magnifying glass</span>`;
  }
  if (obj) {
    const label = obj.kind === 'weapon' && obj.examined ? `⚔ ${G.knownWeapon} (bloodied)` :
                  obj.kind === 'blood'  ? `<span class="bad">✖</span> ${obj.label}` : obj.label;
    html += `<span class="chip object" data-x="${i}">${label}</span>`;
  }
  if (i === P.panelRoom && !P.found) html += `<span class="chip object" data-search="1">▤ the odd patch of wallpaper</span>`;
  if (P.found && (i === P.panelRoom || i === P.exitRoom)) html += `<span class="chip object" data-passage="1"><span class="g-pass">=</span> the secret passage</span>`;
  objBox.innerHTML = html ? `<span class="field-label">You notice:</span><br>${html}` : '';

  // wire chips
  occ.querySelectorAll('[data-q]').forEach(c => c.onclick = () => questionPerson(dec(c.dataset.q)));
  objBox.querySelectorAll('[data-take]').forEach(c => c.onclick = () => takeGlass());
  objBox.querySelectorAll('[data-x]').forEach(c => c.onclick = () => examineObject(+c.dataset.x));
  objBox.querySelectorAll('[data-search]').forEach(c => c.onclick = () => searchWalls());
  objBox.querySelectorAll('[data-passage]').forEach(c => c.onclick = () => takePassage());
}

// One compact status line across the top (was a whole panel).
function renderStatus() {
  const bar = $('#statusbar'); if (!bar) return;
  const t = G.turnsLeft;
  const tcls = t <= 5 ? 'bad' : t <= 12 ? 'evt' : 'good';
  const susp = '▓'.repeat(G.suspicion) + '░'.repeat(Math.max(0, G.diff.suspThreshold - G.suspicion));
  const scls = G.suspicion >= G.diff.suspThreshold - 1 ? 'bad' : 'cyan';
  const parts = [
    `<span class="dim">moves</span> <span class="meter ${tcls}">${t}</span>`,
    `<span class="dim">suspicion</span> <span class="${scls}">${susp}</span>${G.hunting ? ' <span class="bad">HUNTED!</span>' : ''}`,
    `<span class="dim">glass</span> ${G.hasGlass ? '<span class="good">✓</span>' : '<span class="dim">✗</span>'}`,
    `<span class="dim">room</span> ${G.knownRoom ? `<span class="good">${G.knownRoom}</span>` : '<span class="dim">?</span>'}`,
    `<span class="dim">weapon</span> ${G.knownWeapon ? `<span class="good">${G.knownWeapon}</span>` : (G.woundHint ? `<span class="cyan">${G.woundHint}?</span>` : '<span class="dim">?</span>')}`,
  ];
  bar.innerHTML = parts.join('<span class="sep">·</span>');
}

// Notebook is command-driven now (see dumpNotebook); no always-on panel.
function renderNotebook() {}

function renderAll() { renderMap(); renderRoom(); renderStatus(); renderNotebook(); }

const enc = s => encodeURIComponent(s);
const dec = s => decodeURIComponent(s);

/* --------------------------------------------------------------------------
   Turn engine — every meaningful action consumes a move and roams the guests
   -------------------------------------------------------------------------- */

function spendTurn() {
  if (G.over) return;
  G.turnsLeft--;

  // guests roam to an adjacent room (or linger). They use ordinary doors and
  // stairs, never the secret passage — only you know about that.
  for (const n of G.suspects) {
    const a = neighbors(G.positions[n]);
    const adj = Object.keys(a).filter(d => d !== 'P').map(d => a[d]);
    if (Math.random() < 0.7 && adj.length) G.positions[n] = pick(adj);
  }

  // danger checks
  if (G.turnsLeft <= 0) { return death('Time ran out. As you turned a corner, a shadow fell across you — and the killer struck from behind. The case dies with you.'); }
  if (G.turnsLeft <= 5) log(`The clock is against you — only <span class="bad">${G.turnsLeft}</span> moves before the murderer acts.`, 'warn');

  if (G.hunting && G.positions[G.murdererName] === G.player) {
    return death(`You are alone with the killer — and they know you're closing in. ${G.murdererName} lunges. You never finish the sentence.`);
  }
  if (G.hunting && Math.random() < 0.5) {
    log(`You hear footsteps behind you. ${G.murdererName} is hunting you now — <span class="bad">accuse or flee!</span>`, 'warn');
  }
  renderAll();
}

/* --------------------------------------------------------------------------
   Actions
   -------------------------------------------------------------------------- */

// Walk the dot one tile. Walls block; stepping through a doorway into a new room
// costs a move (spends a turn) and triggers that room's arrival logic.
function stepDir(dx, dy) {
  if (G.over) return;
  const f = FLOORS[G.pfloor];
  const nx = G.px + dx, ny = G.py + dy;
  if (ny < 0 || ny >= f.H || nx < 0 || nx >= f.W) return;
  if (f.tiles[ny][nx] === TILE.WALL) return;   // blocked, silently
  G.px = nx; G.py = ny;
  if (f.tiles[ny][nx] === TILE.PASSAGE) return takePassage();  // step into the open panel
  const ri = f.owner[ny][nx];                  // -1 on a doorway between rooms
  if (ri >= 0 && ri !== G.player) enterRoom(ri);
  else renderMap();                            // just redraw the dot moving
}

// Arriving in a new room: the turn-costing event (also used by stairs/passage).
function enterRoom(target, via) {
  const changedFloor = ROOM_META[target].floor !== ROOM_META[G.player].floor;
  G.player = target;
  G.visited.add(target);
  if (via === 'passage') log(`You emerge from the secret passage into the <span class="hl">${ROOMS[target]}</span>${G.stories === 2 ? ` <span class="dim">(${FLOORS[ROOM_META[target].floor].name})</span>` : ''}.`, 'you');
  else if (via === 'stairs' || changedFloor) log(`You take the stairs to the <span class="hl">${ROOMS[target]}</span> <span class="dim">(${FLOORS[ROOM_META[target].floor].name})</span>.`, 'you');
  else log(`You enter the <span class="hl">${ROOMS[target]}</span>.`, 'you');
  // A guest lingering at the scene often — but not always — gives it away by
  // staring at the floor. (You can also just spot the stains yourself: EXAMINE.)
  if (target === G.murderRoom && !G.knownRoom) {
    const guestsHere = G.suspects.filter(n => G.positions[n] === target);
    if (guestsHere.length && Math.random() < 0.7) {
      log(`${pick(guestsHere)} stands oddly still, staring down at the floor…`, 'clue');
    }
  }
  spendTurn();
}

// Move the dot to another room and re-centre it there (used by the passage).
function warpTo(tgt, via) {
  const c = ROOM_META[tgt].center;
  G.pfloor = 0;
  G.px = c.x; G.py = c.y;
  enterRoom(tgt, via);
}

// One story — the "stairs" are just the front steps at the two entrances.
function takeStairs() {
  if (G.over) return;
  log('This is a single-story estate — the staircases are only the front steps at the two entrances. There is no floor above or below.', 'sys');
}

// ---- Secret passage ----------------------------------------------------------

// Probe the wallpaper in the panel room; a few tries and the panel slides open.
function searchWalls() {
  if (G.over) return;
  const P = G.passage;
  if (G.player !== P.panelRoom || P.found) {
    log('You search the walls, but find nothing out of the ordinary here.', 'sys');
    return;
  }
  P.probes++;
  if (P.probes < 2) {
    log('You press along the odd patch of wallpaper. Something shifts behind it — but it doesn\'t give. Try again.', 'clue');
    spendTurn();
    return;
  }
  // opens
  P.found = true;
  ADJ[P.panelRoom].P = P.exitRoom;
  ADJ[P.exitRoom].P = P.panelRoom;
  openPassageTile(P.panelRoom);
  openPassageTile(P.exitRoom);
  addMarker(P.panelRoom, '<span class="g-pass">=</span>');
  addMarker(P.exitRoom, '<span class="g-pass">=</span>');
  log(`A panel clicks and slides smoothly aside, revealing a dark <span class="clue">secret passage</span>. It runs all the way to the <span class="hl">${ROOMS[P.exitRoom]}</span> — the sealed room with no door. (Step into it, or use PASSAGE.)`, 'clue');
  spendTurn();
}

function openPassageTile(room) {
  const c = ROOM_META[room].center;            // the passage mouth sits at the room centre
  FLOORS[0].tiles[c.y][c.x] = TILE.PASSAGE;
  ROOM_META[room].passageTile = { x: c.x, y: c.y };
}

// Travel through the secret passage from either end.
function takePassage() {
  if (G.over) return;
  const P = G.passage;
  const tgt = (ADJ[G.player] || {}).P;
  if (!P.found || tgt == null) { log('There is no secret passage here.', 'sys'); return; }
  if (!P.used) {
    P.used = true;
    log('You slip into the passage. In the dark you edge past a strange black obelisk on the floor — no blood, no answers, just cold stone.', 'clue');
    const lurker = G.suspects.find(n => G.positions[n] === tgt);
    if (lurker) log(`Halfway through, a face stares out at you from the gloom — the fright of your life. It is only <span class="cyan">${lurker}</span>.`, 'clue');
  }
  warpTo(tgt, 'passage');
}

function moveDir(d) {
  if (d === 'U' || d === 'D') return takeStairs(d);
  if (d === 'P') return takePassage();
  const v = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[d];
  if (v) stepDir(v[0], v[1]);
}

function doLook() {
  const i = G.player;
  log(`You survey the <span class="hl">${ROOMS[i]}</span>.`, 'you');
  const here = G.suspects.filter(n => G.positions[n] === i);
  if (here.length) log(`Here with you: <span class="cyan">${here.join(', ')}</span>.`);
  else log('You are alone in this room.', 'sys');
  const obj = G.objects[i];
  if (i === G.glassRoom && !G.hasGlass) log('A <span class="clue">magnifying glass</span> glints on a side table. (TAKE it.)', 'clue');
  if (obj) log(`You notice <span class="clue">${obj.label}</span>. (EXAMINE it.)`, 'clue');
  if (!obj && !(i === G.glassRoom && !G.hasGlass)) log('Nothing here seems important.', 'sys');
  // looking is free the first time per room, else costs a move? keep it free but roam anyway lightly
}

function takeGlass() {
  if (G.player !== G.glassRoom || G.hasGlass) { log('There is no magnifying glass to take here.', 'sys'); return; }
  G.hasGlass = true;
  addMarker(G.glassRoom, '·');
  log('You pocket the <span class="clue">magnifying glass</span>. Now you can examine clues up close.', 'clue');
  spendTurn();
}

function examineObject(room) {
  if (G.over) return;
  if (room !== G.player) { log('You need to be in the same room to examine that.', 'sys'); return; }
  const obj = G.objects[room];
  if (!obj) { log('There is nothing here worth examining.', 'sys'); return; }

  if (obj.kind === 'blood') {
    // The stains are plain to the naked eye — they confirm the ROOM with no glass.
    obj.examined = true;
    const firstTime = !G.knownRoom;
    G.knownRoom = ROOMS[room];
    addMarker(room, BLOOD_MARK);
    if (firstTime) log(`You kneel over <span class="hl">${obj.label}</span>. This is it — the murder happened <span class="good">right here, in the ${ROOMS[room]}</span>.`, 'clue');
    // The glass is what lets you read the scene closely for the weapon.
    if (G.hasGlass) {
      if (!G.woundHint) {
        G.woundHint = G.weapon.klass;
        log(`Through the glass: <span class="clue">${G.weapon.scene}</span>. It points to <span class="clue">${G.weapon.klass}</span>. Find the weapon to be sure.`, 'clue');
      }
      if (G.weaponAtScene && !G.knownWeapon) {
        G.knownWeapon = G.weapon.name;
        addMarker(room, '⚔');
        log(`The weapon was dropped here at the scene: a <span class="good">bloodied ${G.weapon.name}</span>. Weapon confirmed.`, 'clue');
      }
    } else {
      log('There is more to read in these marks, but not with the naked eye — you need a <span class="clue">magnifying glass</span>.', 'warn');
    }
    spendTurn();
  } else if (!G.hasGlass) {
    log('You crouch to look closer, but the details are lost to you. You need a <span class="clue">magnifying glass</span> first.', 'warn');
    return;
  } else if (obj.kind === 'weapon') {
    obj.examined = true;
    G.knownWeapon = G.weapon.name;
    addMarker(room, '⚔');
    log(`Beneath the cloth: a <span class="good">bloodied ${G.weapon.name}</span>. This is the murder weapon.`, 'clue');
    spendTurn();
  } else {
    obj.examined = true;
    log(`You examine ${obj.label}. <span class="dim">${DECOY_FLAVOR[obj.label] || 'Nothing useful.'}</span>`, 'sys');
    spendTurn();
  }
}

function questionPerson(name) {
  if (G.over) return;
  const canon = matchName(name);
  if (!canon) { log(`There is no guest by that name here.`, 'sys'); return; }
  if (G.positions[canon] !== G.player) { log(`${canon} is not in this room. Find them first.`, 'sys'); return; }

  const p = G.people[canon];
  G.questioned[canon] = (G.questioned[canon] || 0) + 1;
  const times = G.questioned[canon];

  // build their statement
  let stmt;
  if (p.isMurderer) {
    stmt = `"At the time of the murder I was in the ${ROOMS[p.claimRoom]}. ${p.claimWitness} was with me — ask them."`;
  } else {
    const room = ROOMS[p.trueRoom];
    if (p.group.length === 0)      stmt = `"I was in the ${room}, quite alone, I'm afraid."`;
    else if (p.group.length === 1) stmt = `"I was in the ${room} with ${p.group[0]} the whole time."`;
    else                           stmt = `"I was in the ${room} with ${p.group.slice(0, -1).join(', ')} and ${p.group[p.group.length - 1]}."`;
  }

  log(`<span class="you">You question ${canon}.</span>`, 'you');
  log(`${canon}: <span class="cyan">${stmt}</span>`);

  // record / update notebook
  const noteText = p.isMurderer
    ? `claims the ${ROOMS[p.claimRoom]}, with ${p.claimWitness}.`
    : (p.group.length ? `the ${ROOMS[p.trueRoom]}, with ${p.group.join(', ')}.` : `the ${ROOMS[p.trueRoom]}, alone.`);
  const existing = G.notes.find(n => n.name === canon);
  if (existing) existing.text = noteText; else G.notes.push({ name: canon, text: noteText });

  // suspicion mechanics — "once or twice before the murderer becomes suspicious"
  if (p.isMurderer) {
    G.suspicion += (times >= 2 ? 2 : 1);
    if (times >= 2) log(`${canon} narrows their eyes at your repeated questions…`, 'warn');
  } else if (times >= 2) {
    G.suspicion += 1;
    log(`Word travels. The killer is getting nervous about how much you're asking.`, 'warn');
  }
  if (G.suspicion >= G.diff.suspThreshold && !G.hunting) {
    G.hunting = true;
    log(`<span class="bad">The murderer now knows you're onto them. They are coming for you. Accuse — or run.</span>`, 'warn');
  }
  spendTurn();
}

function matchName(input) {
  input = input.trim().toLowerCase();
  if (!input) return null;
  let hit = G.suspects.find(n => n.toLowerCase() === input);
  if (hit) return hit;
  hit = G.suspects.find(n => n.toLowerCase().includes(input));
  if (hit) return hit;
  // match by last word / surname
  hit = G.suspects.find(n => n.toLowerCase().split(/\s+/).some(w => w === input));
  return hit || null;
}

/* --------------------------------------------------------------------------
   Accusation & endgame
   -------------------------------------------------------------------------- */

function openAccuse() {
  if (G.over) return;
  const s = $('#acc-suspect'), w = $('#acc-weapon'), r = $('#acc-room');
  s.innerHTML = G.suspects.map(n => `<option>${n}</option>`).join('');
  w.innerHTML = WEAPONS.map(x => `<option>${x.name}</option>`).join('');
  // value stays the plain room name (unique across floors); label notes the floor
  r.innerHTML = ROOMS.map(n => `<option value="${n}">${n}</option>`).join('');
  if (G.knownWeapon) w.value = G.knownWeapon;
  if (G.knownRoom)   r.value = G.knownRoom;
  $('#accuse-modal').classList.remove('hidden');
}

function confirmAccuse() {
  const who = $('#acc-suspect').value;
  const wpn = $('#acc-weapon').value;
  const rm  = $('#acc-room').value;
  $('#accuse-modal').classList.add('hidden');

  const okWho = who === G.murdererName;
  const okWpn = wpn === G.weapon.name;
  const okRm  = rm === ROOMS[G.murderRoom];

  if (okWho && okWpn && okRm) {
    return win(`You gather the guests and level your finger at <span class="hl">${who}</span>. ` +
      `"It was you — with the <span class="hl">${wpn}</span>, in the <span class="hl">${rm}</span>." ` +
      `The colour drains from their face. The confession follows. <span class="good">Case closed, detective.</span>`);
  }

  // wrong — you die (faithful to the original)
  let why = [];
  if (!okWho) why.push('the wrong suspect'); if (!okWpn) why.push('the wrong weapon'); if (!okRm) why.push('the wrong room');
  return death(`You accuse <span class="bad">${who}</span> — but you named ${why.join(' and ')}. ` +
    `In the stunned silence, the real killer, <span class="hl">${G.murdererName}</span>, seizes the moment. ` +
    `The ${G.weapon.name} finds you before anyone can move.`);
}

function win(msg) {
  G.over = true; G.hunting = false;
  log(msg, 'good');
  showEnd(true, 'CASE SOLVED', msg + solutionLine());
}
function death(msg) {
  G.over = true;
  log(msg, 'warn');
  showEnd(false, 'YOU ARE DEAD', msg + solutionLine());
}
function solutionLine() {
  return `<p class="dim">The truth: <b>${G.murdererName}</b> killed ${G.victim} with the ` +
    `<b>${G.weapon.name}</b> in the <b>${ROOMS[G.murderRoom]}</b>.</p>`;
}
function showEnd(didWin, title, body) {
  const t = $('#end-title');
  t.textContent = title; t.className = 'box-title ' + (didWin ? 'win' : 'lose');
  $('#end-body').innerHTML = `<p>${body}</p>`;
  $('#end-modal').classList.remove('hidden');
  renderAll();
}

/* --------------------------------------------------------------------------
   Command parser (faithful limited vocabulary)
   -------------------------------------------------------------------------- */

function runCommand(raw) {
  if (G.over) return;
  const line = raw.trim();
  if (!line) return;
  log(`&gt; ${line}`, 'you');
  const parts = line.toLowerCase().split(/\s+/);
  const cmd = parts[0];
  const arg = line.slice(cmd.length).trim();

  switch (cmd) {
    case 'n': case 'north': return moveDir('N');
    case 's': case 'south': return moveDir('S');
    case 'e': case 'east':  return moveDir('E');
    case 'w': case 'west':  return moveDir('W');
    case 'u': case 'up': case 'upstairs':     return moveDir('U');
    case 'd': case 'down': case 'downstairs': return moveDir('D');
    case 'p': case 'passage': case 'secret':  return moveDir('P');
    case 'go': case 'move': {
      const d = { north:'N', south:'S', east:'E', west:'W', up:'U', down:'D', upstairs:'U', downstairs:'D',
                  n:'N', s:'S', e:'E', w:'W', u:'U', passage:'P' }[arg.toLowerCase()];
      return d ? moveDir(d) : log('Go where? Try: GO NORTH / SOUTH / EAST / WEST / UP / DOWN.', 'sys');
    }
    case 'l': case 'look': return doLook();
    case 'search': case 'probe': case 'feel': return searchWalls();
    case 'x': case 'examine': case 'inspect': {
      if (/wall|panel|paper|passage/.test(arg)) return searchWalls();
      if (!arg || /room|here|around/.test(arg)) { if (G.objects[G.player]) return examineObject(G.player); return doLook(); }
      if (/glass|magnif/.test(arg)) return takeGlass();
      return examineObject(G.player);
    }
    case 'take': case 'get': case 'grab': case 'pick':
      if (/glass|magnif/.test(arg) || !arg) return takeGlass();
      return log("You can't take that.", 'sys');
    case 'q': case 'question': case 'ask': case 'talk': case 'interrogate': {
      if (!arg) return log('Question whom? e.g. QUESTION Dr. Crane', 'sys');
      return questionPerson(arg.replace(/^(to|the)\s+/, ''));
    }
    case 'notebook': case 'notes': case 'nb': return dumpNotebook();
    case 'accuse': case 'j\'accuse': return openAccuse();
    case 'wait': case 'z': log('You wait, listening…', 'you'); return spendTurn();
    case 'map': return log('The map is displayed at all times, top-left.', 'sys');
    case 'help': case '?': case 'h': return showHelp();
    default:
      log(`I don't understand "${cmd}". Type <span class="cyan">HELP</span> for commands.`, 'sys');
  }
}

function dumpNotebook() {
  log('<span class="cyan">— NOTEBOOK —</span>', 'clue');
  if (G.knownRoom)   log(`Murder room: <span class="good">${G.knownRoom}</span>`, 'clue');
  if (G.knownWeapon) log(`Murder weapon: <span class="good">${G.knownWeapon}</span>`, 'clue');
  else if (G.woundHint) log(`Weapon type: <span class="cyan">${G.woundHint}</span>`, 'clue');
  if (!G.notes.length) log('No alibis recorded yet.', 'sys');
  G.notes.forEach(n => log(`${n.name}: ${n.text}`, 'sys'));
  log('<span class="dim">Tip: the murderer is the one whose alibi nobody else backs up.</span>', 'sys');
}

function showHelp() {
  log('<span class="cyan">— COMMANDS —</span>', 'clue');
  [
    'Move:      arrow keys walk your dot (@) through the rooms and doorways (or N/S/E/W)',
    'LOOK       — describe the current room',
    'TAKE glass — pick up the magnifying glass',
    'EXAMINE    — inspect the clue in this room (bloodstains reveal the ROOM; the glass reveals more)',
    'SEARCH     — probe the walls for a hidden panel (somewhere the wallpaper looks off)',
    'PASSAGE    — slip through a secret passage you\'ve opened',
    'QUESTION &lt;name&gt; — ask a guest for their alibi (don\'t overdo it!)',
    'NOTEBOOK   — review the clues and alibis you\'ve gathered',
    'ACCUSE     — name the murderer, weapon, and room (one shot — be right)',
    'WAIT       — let a moment pass',
  ].forEach(t => log(t, 'sys'));
  log('<span class="dim">Find the bloodstained room, the weapon, and spot the liar (murderer). Watch for a guest staring at the floor.</span>', 'sys');
}

/* --------------------------------------------------------------------------
   Boot / wiring
   -------------------------------------------------------------------------- */

let chosenDiff = 'normal';

function startGame() {
  const names = $('#names-input').value.split(',');
  newGame(names, chosenDiff);
  $('#start-screen').classList.add('hidden');
  $('#game-screen').classList.remove('hidden');
  $('#end-modal').classList.add('hidden');
  $('#log').innerHTML = '';

  log(`<span class="clue">It is a dark and stormy night. A scream echoes through a sprawling <span class="hl">single-story estate</span>. ${G.victim} has been murdered — the body already spirited away by persons unknown, but the killer left their mark on the floor of one room.</span>`);
  log(`The guests — <span class="cyan">${G.suspects.join(', ')}</span> — are all still here. One of them is the murderer.`);
  log(`Walk your dot (<span class="g-you">@</span>) through the house with the <span class="cyan">arrow keys</span>. Find the bloodstained room, find the weapon, and unmask the liar before your time runs out. Type <span class="cyan">HELP</span> to begin.`);
  renderAll();
  $('#cmd-input').focus();

  // test-only hook (opt-in via ?sleuthtest in the URL) — never active in normal play
  if (typeof location !== 'undefined' && location.search.includes('sleuthtest')) {
    window.__sleuth = { get G() { return G; }, get ROOMS() { return ROOMS; }, get FLOORS() { return FLOORS; }, get ADJ() { return ADJ; }, get META() { return ROOM_META; }, confirmAccuse, searchWalls, takePassage };
  }
}

function initEvents() {
  // difficulty buttons
  document.querySelectorAll('.diff-btn').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); chosenDiff = b.dataset.diff;
    };
  });
  $('#start-btn').onclick = startGame;
  $('#play-again').onclick = () => { $('#end-modal').classList.add('hidden'); $('#game-screen').classList.add('hidden'); $('#start-screen').classList.remove('hidden'); };

  // command line
  $('#cmd-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = e.target.value; e.target.value = ''; runCommand(v); }
  });

  // quick actions
  document.querySelectorAll('#quick-actions button').forEach(b => {
    b.onclick = () => {
      const c = b.dataset.cmd;
      if (c === 'accuse') return openAccuse();
      if (c === 'help') return showHelp();
      if (c === 'notebook') return dumpNotebook();
      if (c === 'look') return doLook();
      if (c === 'examine') { const i = G.player; if (i === G.glassRoom && !G.hasGlass) return takeGlass(); return examineObject(i); }
      if (c === 'question') {
        const here = G.suspects.filter(n => G.positions[n] === G.player);
        if (!here.length) return log('No one here to question. Explore to find the guests.', 'sys');
        $('#cmd-input').value = 'question ' + here[0].split(' ').pop(); $('#cmd-input').focus();
      }
    };
  });

  // arrow keys walk the dot; PageUp/PageDown take the stairs (field empty only)
  document.addEventListener('keydown', e => {
    if (!G || G.over) return;
    const inField = document.activeElement === $('#cmd-input') && $('#cmd-input').value !== '';
    if (inField) return;
    if ($('#game-screen').classList.contains('hidden')) return;
    const map = { ArrowUp:'N', ArrowDown:'S', ArrowLeft:'W', ArrowRight:'E', PageUp:'U', PageDown:'D' };
    if (map[e.key]) { e.preventDefault(); moveDir(map[e.key]); }
  });

  // accuse modal
  $('#acc-confirm').onclick = confirmAccuse;
  $('#acc-cancel').onclick = () => $('#accuse-modal').classList.add('hidden');

  // allow Enter on start screen names field
  $('#names-input').addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initEvents);
}

// Exposed for headless testing (see test/solvable.test.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    newGame, getG: () => G, WEAPONS, neighbors,
    getRooms: () => ROOMS, getAdj: () => ADJ, getFloors: () => FLOORS, getMeta: () => ROOM_META,
  };
}
