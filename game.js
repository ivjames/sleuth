/* ===========================================================================
   SLEUTH — A Murder Mystery
   A browser clone of Eric N. Miller's 1983 DOS whodunit (Norland Software).

   The case is randomized every game: murderer, weapon, room, victim, and the
   location of the magnifying glass. You solve it by:
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

const ROOMS = [
  'Foyer',      'Library',       'Study',         'Conservatory',
  'Living Room','Dining Room',   'Billiard Room', 'Gallery',
  'Kitchen',    'Ballroom',      'Trophy Room',   'Music Room',
  'Wine Cellar','Master Bedroom','Guest Room',    'Garden',
];
const GRID_W = 4, GRID_H = 4;

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
const rc      = i => [Math.floor(i / GRID_W), i % GRID_W];
const idx     = (r, c) => r * GRID_W + c;

function neighbors(i) {
  const [r, c] = rc(i), out = {};
  if (r > 0)          out.N = idx(r - 1, c);
  if (r < GRID_H - 1) out.S = idx(r + 1, c);
  if (c > 0)          out.W = idx(r, c - 1);
  if (c < GRID_W - 1) out.E = idx(r, c + 1);
  return out;
}
const $ = sel => document.querySelector(sel);

/* --------------------------------------------------------------------------
   Game state
   -------------------------------------------------------------------------- */

let G = null; // current game

function newGame(names, diffKey) {
  const diff = DIFF[diffKey] || DIFF.normal;

  // The party guest list — deduped, padded from defaults if too few. As in the
  // original, ONE guest is chosen (at random) as the deceased; everyone left is
  // a suspect, one of whom is the murderer. In customized play that means one of
  // the names you entered — perhaps your own — turns up dead.
  let guests = [];
  for (const s of names.map(x => x.trim()).filter(Boolean)) if (!guests.includes(s)) guests.push(s);
  const fillers = ['Lord Ashford','Lady Vaughn','Dr. Crane','Miss Ivory','Captain Reed','Mr. Bishop','Mrs. Pearl','Sir Blake'];
  for (const f of fillers) { if (guests.length >= 6) break; if (!guests.includes(f)) guests.push(f); }
  guests = guests.slice(0, 9);                       // victim + up to 8 suspects

  const victim   = pick(guests);                     // one of the guests is the deceased
  let suspects   = guests.filter(n => n !== victim); // the rest are the suspects

  const murderRoom = rnd(ROOMS.length);
  const weapon     = pick(WEAPONS);
  const glassRoom  = rnd(ROOMS.length);

  // hide the bloodied weapon somewhere (the killer stashed it; may be anywhere)
  let weaponRoom = rnd(ROOMS.length);

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

  // suspects' CURRENT positions (they roam; separate from their alibi trueRoom)
  const positions = {};
  suspects.forEach(n => { positions[n] = rnd(ROOMS.length); });

  G = {
    diff, diffKey,
    suspects, murdererName, weapon, victim,
    murderRoom, weaponRoom, weaponAtScene, glassRoom,
    people, objects, positions,
    player: 0,               // player's room
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
    visited: new Set([0]),
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
  $('#log-box').scrollTop = $('#log-box').scrollHeight;
}

function renderMap() {
  const adj = neighbors(G.player);
  const adjSet = new Set(Object.values(adj));
  const map = $('#map');
  map.innerHTML = '';
  ROOMS.forEach((name, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell' + (i === G.player ? ' here' : (adjSet.has(i) ? ' adj' : ''));
    const marks = G.markers[i] ? [...G.markers[i]].join(' ') : '';
    const you = i === G.player ? '@' : '';
    cell.innerHTML = `<div class="cell-mark">${you || marks || '&nbsp;'}</div><div>${name}</div>`;
    cell.onclick = () => { if (adjSet.has(i)) moveTo(i); else if (i === G.player) doLook(); };
    map.appendChild(cell);
  });
}

function renderRoom() {
  const i = G.player;
  $('#room-title').textContent = ROOMS[i].toUpperCase();
  const adj = neighbors(i);
  const dirs = Object.keys(adj).map(d => ({ N:'north', S:'south', E:'east', W:'west' }[d])).join(', ');
  $('#room-desc').innerHTML = `You are in the <span class="hl">${ROOMS[i]}</span>. ` +
    `Exits lead <span class="cyan">${dirs}</span>.`;

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
  objBox.innerHTML = html ? `<span class="field-label">You notice:</span><br>${html}` : '';

  // wire chips
  occ.querySelectorAll('[data-q]').forEach(c => c.onclick = () => questionPerson(dec(c.dataset.q)));
  objBox.querySelectorAll('[data-take]').forEach(c => c.onclick = () => takeGlass());
  objBox.querySelectorAll('[data-x]').forEach(c => c.onclick = () => examineObject(+c.dataset.x));
}

function renderStatus() {
  const t = G.turnsLeft;
  const tcls = t <= 5 ? 'bad' : t <= 12 ? 'evt' : 'good';
  const suspBars = '█'.repeat(G.suspicion) + '░'.repeat(Math.max(0, G.diff.suspThreshold - G.suspicion));
  const scls = G.suspicion >= G.diff.suspThreshold - 1 ? 'bad' : 'cyan';
  const lines = [
    `<div>Time before the killer strikes: <span class="meter ${tcls}">${t} moves</span></div>`,
    `<div>Killer's suspicion: <span class="meter ${scls}">${suspBars}</span> ${G.hunting ? '<span class="bad">— HUNTING YOU!</span>' : ''}</div>`,
    `<div>Magnifying glass: ${G.hasGlass ? '<span class="good">in hand</span>' : '<span class="dim">not found</span>'}</div>`,
    `<hr style="border-color:#3a3a10">`,
    `<div>ROOM:  ${G.knownRoom ? `<span class="good">${G.knownRoom}</span>` : '<span class="dim">unknown</span>'}</div>`,
    `<div>WEAPON: ${G.knownWeapon ? `<span class="good">${G.knownWeapon}</span>` : (G.woundHint ? `<span class="cyan">${G.woundHint}?</span>` : '<span class="dim">unknown</span>')}</div>`,
    `<div>MURDERER: <span class="dim">you must deduce this</span></div>`,
  ];
  $('#status-lines').innerHTML = lines.join('');
}

function renderNotebook() {
  const nb = $('#notebook');
  if (!G.notes.length) { nb.innerHTML = `<div class="nb-empty">Empty. Question the guests to record their alibis.</div>`; return; }
  nb.innerHTML = G.notes.map(n => `<div class="nb-entry"><b>${n.name}:</b> ${n.text}</div>`).join('');
  nb.scrollTop = nb.scrollHeight;
}

function renderAll() { renderMap(); renderRoom(); renderStatus(); renderNotebook(); }

const enc = s => encodeURIComponent(s);
const dec = s => decodeURIComponent(s);

/* --------------------------------------------------------------------------
   Turn engine — every meaningful action consumes a move and roams the guests
   -------------------------------------------------------------------------- */

function spendTurn() {
  if (G.over) return;
  G.turnsLeft--;

  // guests roam to an adjacent room (or linger)
  for (const n of G.suspects) {
    const adj = Object.values(neighbors(G.positions[n]));
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

function moveTo(target) {
  if (G.over) return;
  const adj = Object.values(neighbors(G.player));
  if (!adj.includes(target)) { log('You can only move to an adjoining room.', 'sys'); return; }
  G.player = target;
  G.visited.add(target);
  log(`You move into the <span class="hl">${ROOMS[target]}</span>.`, 'you');
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

function moveDir(d) {
  const adj = neighbors(G.player);
  if (adj[d] == null) { log(`There is no exit to the ${ {N:'north',S:'south',E:'east',W:'west'}[d] }.`, 'sys'); return; }
  moveTo(adj[d]);
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
  r.innerHTML = ROOMS.map(n => `<option>${n}</option>`).join('');
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
    case 'go': case 'move': {
      const d = { north:'N', south:'S', east:'E', west:'W', n:'N', s:'S', e:'E', w:'W' }[arg.toLowerCase()];
      return d ? moveDir(d) : log('Go where? Try: GO NORTH / SOUTH / EAST / WEST.', 'sys');
    }
    case 'l': case 'look': return doLook();
    case 'x': case 'examine': case 'search': case 'inspect': {
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
    'Move:      N / S / E / W  (or arrow keys, or click an adjoining room)',
    'LOOK       — describe the current room',
    'TAKE glass — pick up the magnifying glass',
    'EXAMINE    — inspect the clue in this room (bloodstains reveal the ROOM; the glass reveals more)',
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

  log(`<span class="clue">A scream echoes through the mansion. ${G.victim} has been murdered — the body already spirited away, but the killer left their mark on the floor of one room.</span>`);
  log(`The guests — <span class="cyan">${G.suspects.join(', ')}</span> — are all still here. One of them is the murderer.`);
  log(`Find the bloodstained room, find the weapon, and unmask the liar before your time runs out. Type <span class="cyan">HELP</span> to begin.`);
  renderAll();
  $('#cmd-input').focus();

  // test-only hook (opt-in via ?sleuthtest in the URL) — never active in normal play
  if (typeof location !== 'undefined' && location.search.includes('sleuthtest')) {
    window.__sleuth = { get G() { return G; }, ROOMS, confirmAccuse };
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

  // arrow keys to move (when not typing in a field, or field empty)
  document.addEventListener('keydown', e => {
    if (!G || G.over) return;
    const inField = document.activeElement === $('#cmd-input') && $('#cmd-input').value !== '';
    if (inField) return;
    if ($('#game-screen').classList.contains('hidden')) return;
    const map = { ArrowUp:'N', ArrowDown:'S', ArrowLeft:'W', ArrowRight:'E' };
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
  module.exports = { newGame, getG: () => G, ROOMS, WEAPONS, neighbors };
}
