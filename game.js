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
  ['Parlor', 3, 3], ['Secret Passage', 3, 6], ['Study', 3, 11],
  ['West Hall', 9, 4], ['Grand Foyer', 20, 1], ['Dining Hall', 16, 6],
  ['Ballroom', 24, 9], ['Music Room', 16, 11], ['East Hall', 29, 5],
  ['Master Bedroom', 35, 2], ['Bathroom', 35, 5], ['Kitchen', 35, 10],
];
const START_TILE = { x: 9, y: 12 };   // you begin at the front door (left stair)
const SEALED_ROOM = 1;                 // the hidden passage: sealed, no ordinary doorway

// Room flavour, drawn from the original's own descriptions where we have them.
const ROOM_FLAVOR = {
  'Parlor':         'A large sofa sits in the middle of the room; through the window you can see the front lawn. An antique silver teapot rests on a side table.',
  'Secret Passage': 'A cramped, pitch-black passage inside the walls. A cold stone obelisk squats in the dark. Somewhere the floor feels loose — keep moving and it may drop you out elsewhere.',
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
  while (st.length) { const c = st.pop(); for (const k of Object.keys(ADJ[c])) { const nb = ADJ[c][k]; if (!seen.has(nb)) { seen.add(nb); st.push(nb); } } }
  return seen;
}

// The secret passage, fixed at the start of each game:
//   entry — a hidden door in the sealed chamber's wall. `a` is the floor tile
//           just outside it, `b` the chamber tile just inside; walking from a
//           through the wall to b slips you in (you find it by bumping walls).
//   exitTile — a chamber tile that, once you step on it, drops you out into a
//           room chosen fresh at RANDOM each time you use it (only the spot is
//           fixed, not where it sends you).
//   entryRoom — the room the door opens from, so guests can wander into the
//           passage through it and you can run into one in the dark.
function buildPassage(reachArr) {
  const f = FLOORS[0], reach = new Set(reachArr);
  const chamber = [];
  for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) if (f.owner[y][x] === SEALED_ROOM) chamber.push({ x, y });
  const doors = [];
  for (const c of chamber) for (const [dx, dy] of DIRS4) {
    const wx = c.x + dx, wy = c.y + dy, ox = c.x + 2 * dx, oy = c.y + 2 * dy;
    if (wy < 0 || wx < 0 || wy >= f.H || wx >= f.W || f.tiles[wy][wx] !== TILE.WALL) continue;
    if (oy < 0 || ox < 0 || oy >= f.H || ox >= f.W || f.tiles[oy][ox] === TILE.WALL) continue;
    if (reach.has(f.owner[oy][ox])) doors.push({ a: { x: ox, y: oy }, b: { x: c.x, y: c.y } });
  }
  const entry = pick(doors);
  const entryRoom = f.owner[entry.a.y][entry.a.x];
  const rest = chamber.filter(c => !(c.x === entry.b.x && c.y === entry.b.y));
  const exitTile = pick(rest.length ? rest : chamber);
  return { entry, entryRoom, exitTile };
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

// Rooms a GUEST may roam to from room `i`: ordinary doorways, plus the secret
// passage links (the passage chamber connects to its entry room and its exit
// room), so guests occasionally turn up inside the passage.
function roamNeighbors(i) {
  const base = Object.values(ADJ[i] || {});
  const P = G && G.passage;
  if (!P) return base;
  if (i === SEALED_ROOM) return [...base, P.entryRoom];
  if (i === P.entryRoom) return [...base, SEALED_ROOM];
  return base;
}
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

  // assign each group a distinct true room (not the murder room, not the passage)
  const availRooms = shuffle([...Array(ROOMS.length).keys()].filter(r => r !== murderRoom && r !== SEALED_ROOM));
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

  // A secret passage inside the walls: a hidden door you find by walking into the
  // wall at the right spot, and a spot inside that flings you to a random room.
  const passage = buildPassage(reach);

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
const FACE_YOU = '☻';   // you: the filled CP437 smiley (U+263B)
const FACE_NPC = '☺';   // guests: the outline CP437 smiley (U+263A)

// Draw the hand-drawn floorplan exactly as authored (block glyphs and all), with
// the player as a dot walking the open floor and the guests as lettered dots.
function renderMap() {
  const map = $('#map');
  map.innerHTML = '';

  // overlays: you, plus any guests who share YOUR room (guests elsewhere aren't
  // shown — as in the original, you only see who's here once you walk in). Spread
  // them across the room's free floor tiles so they never stack on one cell.
  const overlay = {};
  const f0 = FLOORS[0];
  const here = G.suspects.filter(n => G.positions[n] === G.player);
  if (here.length) {
    const spots = [];
    for (let y = 0; y < f0.H; y++) for (let x = 0; x < f0.W; x++)
      if (f0.owner[y][x] === G.player && !(x === G.px && y === G.py)) spots.push([x, y]);
    here.forEach((n, i) => {
      const t = spots.length ? spots[Math.floor(((i + 0.5) * spots.length) / here.length)] : [G.px, G.py];
      overlay[t[1] + ',' + t[0]] = { ch: FACE_NPC, cls: 'g-guest' };
    });
  }
  overlay[G.py + ',' + G.px] = { ch: FACE_YOU, cls: 'g-you' };   // you

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

// The room description now goes into the narrative flow (no side panel). Prints
// the room + flavour, who's here, and what you notice — a few lines, as the
// original did. Called on entering a room and on LOOK.
function describeRoom() {
  const i = G.player;
  const flavor = ROOM_FLAVOR[ROOMS[i]] || '';
  log(`<span class="hl">${ROOMS[i]}.</span> ${flavor}`, 'evt');

  const here = G.suspects.filter(n => G.positions[n] === i);
  if (here.length) log(`With you: <span class="cyan">${here.join(', ')}</span>. <span class="dim">(QUESTION a name)</span>`);

  if (i === G.glassRoom && !G.hasGlass) log(`A <span class="clue">magnifying glass</span> glints on a table. <span class="dim">(TAKE glass)</span>`, 'clue');
  const obj = G.objects[i];
  if (obj) {
    const label = obj.kind === 'weapon' && obj.examined ? `the bloodied ${G.knownWeapon}`
                : obj.kind === 'blood' ? obj.label : obj.label;
    log(`You notice <span class="clue">${label}</span>. <span class="dim">(EXAMINE)</span>`, 'clue');
  }
}

// A tiny time/suspicion readout tucked beside the prompt — no panel.
function renderStatus() {
  const el = $('#status'); if (!el) return;
  const t = G.turnsLeft;
  const tcls = t <= 5 ? 'bad' : t <= 12 ? 'evt' : 'good';
  el.innerHTML = `<span class="${tcls}">${t}</span> moves` + (G.hunting ? ' <span class="bad">· HUNTED</span>' : '');
}

function renderNotebook() {}   // notebook is the typed NOTEBOOK command

function renderAll() { renderMap(); renderStatus(); }

const enc = s => encodeURIComponent(s);
const dec = s => decodeURIComponent(s);

/* --------------------------------------------------------------------------
   Turn engine — every meaningful action consumes a move and roams the guests
   -------------------------------------------------------------------------- */

function spendTurn() {
  if (G.over) return;
  G.turnsLeft--;

  // guests roam to an adjacent room (or linger). They mostly use ordinary
  // doorways, but can also slip through the passage — so you might meet one there.
  for (const n of G.suspects) {
    const adj = roamNeighbors(G.positions[n]);
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

// Walk the dot one tile. Walls block; stepping into a new room costs a move.
function stepDir(dx, dy) {
  if (G.over) return;
  const f = FLOORS[0];
  const P = G.passage, E = P.entry;

  // The secret door: pressing into the wall at exactly the right spot slips you
  // into the hidden passage (there's no marker — you find it by trying walls).
  if (G.px === E.a.x && G.py === E.a.y && dx === Math.sign(E.b.x - E.a.x) && dy === Math.sign(E.b.y - E.a.y)) {
    G.px = E.b.x; G.py = E.b.y;
    log('You lean on the wall at just the right spot — and it gives. You slip into a hidden passage.', 'clue');
    enterRoom(SEALED_ROOM);
    return;
  }

  const nx = G.px + dx, ny = G.py + dy;
  if (ny < 0 || ny >= f.H || nx < 0 || nx >= f.W) return;
  if (f.tiles[ny][nx] === TILE.WALL) return;   // blocked, silently
  G.px = nx; G.py = ny;

  // Inside the passage, the exit spot drops you out into a RANDOM room (fresh
  // each time — only the spot itself is fixed).
  if (G.player === SEALED_ROOM && nx === P.exitTile.x && ny === P.exitTile.y) {
    const dest = pick([...reachableRooms()].filter(r => r !== SEALED_ROOM));
    const c = ROOM_META[dest].center;
    G.px = c.x; G.py = c.y;
    log('The floor drops away in the dark — you tumble through and stagger out somewhere new.', 'clue');
    enterRoom(dest);
    return;
  }

  const ri = f.owner[ny][nx];
  if (ri >= 0 && ri !== G.player) enterRoom(ri);
  else renderMap();                            // just redraw the dot moving
}

// Arriving in a new room: the turn-costing event.
function enterRoom(target) {
  G.player = target;
  G.visited.add(target);
  describeRoom();
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

// One story — the "stairs" are just the front steps at the two entrances.
function takeStairs() {
  if (G.over) return;
  log('This is a single-story estate — the staircases are only the front steps at the two entrances. There is no floor above or below.', 'sys');
}

function moveDir(d) {
  if (d === 'U' || d === 'D') return takeStairs(d);
  const v = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[d];
  if (v) stepDir(v[0], v[1]);
}

function doLook() {
  describeRoom();
  const i = G.player;
  const here = G.suspects.filter(n => G.positions[n] === i);
  if (!here.length && !G.objects[i] && !(i === G.glassRoom && !G.hasGlass)) log('Nothing else here catches your eye.', 'sys');
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

  // Movement is the arrow keys; typed commands use full words. The ONLY
  // shortcuts are EX (examine) and Q (question).
  switch (cmd) {
    case 'north': return moveDir('N');
    case 'south': return moveDir('S');
    case 'east':  return moveDir('E');
    case 'west':  return moveDir('W');
    case 'up': case 'upstairs':     return moveDir('U');
    case 'down': case 'downstairs': return moveDir('D');
    case 'go': case 'move': {
      const d = { north:'N', south:'S', east:'E', west:'W', up:'U', down:'D', upstairs:'U', downstairs:'D' }[arg.toLowerCase()];
      return d ? moveDir(d) : log('Go where? Try: GO NORTH / SOUTH / EAST / WEST.', 'sys');
    }
    case 'look': return doLook();
    case 'ex': case 'examine': case 'inspect': {
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
    case 'notebook': case 'notes': return dumpNotebook();
    case 'accuse': case 'j\'accuse': return openAccuse();
    case 'wait': log('You wait, listening…', 'you'); return spendTurn();
    case 'map': return log('The map is displayed at all times, up top.', 'sys');
    case 'help': return showHelp();
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
    'Move:            the arrow keys walk you (the yellow face) through the rooms',
    'EXAMINE (EX)     — inspect the clue here (bloodstains reveal the ROOM; the glass reveals more)',
    'QUESTION (Q) &lt;name&gt; — ask a guest for their alibi (don\'t overdo it!)',
    'LOOK             — describe the current room again',
    'TAKE glass       — pick up the magnifying glass',
    'NOTEBOOK         — review the clues and alibis you\'ve gathered',
    'ACCUSE           — name the murderer, weapon, and room (one shot — be right)',
    'WAIT             — let a moment pass',
  ].forEach(t => log(t, 'sys'));
  log('<span class="dim">Find the bloodstained room, the weapon, and spot the liar (murderer). Watch for a guest staring at the floor — and for a wall that isn\'t quite solid.</span>', 'sys');
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
  log(`You are the <span class="hl">yellow face</span>; walk with the <span class="cyan">arrow keys</span> and type commands (<span class="cyan">HELP</span> for the list). Find the bloodstained room and the weapon, and unmask the liar before your time runs out.`);
  describeRoom();
  renderAll();
  $('#cmd-input').focus();

  // test-only hook (opt-in via ?sleuthtest in the URL) — never active in normal play
  if (typeof location !== 'undefined' && location.search.includes('sleuthtest')) {
    window.__sleuth = { get G() { return G; }, get ROOMS() { return ROOMS; }, get FLOORS() { return FLOORS; }, get ADJ() { return ADJ; }, get META() { return ROOM_META; }, confirmAccuse };
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

  // arrow keys walk the dot (field empty only)
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
