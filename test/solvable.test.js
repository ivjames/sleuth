/* Headless verification that every randomized case is logically solvable AND the
   fixed one-story house (the hand-drawn floorplan) is well-formed:
     • the murderer is the UNIQUE suspect whose alibi no one corroborates
     • every innocent IS corroborated (so the liar is unique)
     • the murder room, weapon and glass are all reachable on foot from the door
     • the tile floorplan is walkable: a flood-fill from the front door reaches
       every reachable room's interior
     • the secret passage is hidden at the start and leads to the sealed room
   Run: node test/solvable.test.js
*/
const { newGame, getG, getRooms, getAdj, getFloors, getMeta } = require('../game.js');

const ROOM_COUNT = 12;          // the twelve named rooms of the estate
const START = { x: 9, y: 13 };  // the front door (left staircase)

function corroborators(G, name) {
  const p = G.people[name];
  const claimRoom = p.isMurderer ? p.claimRoom : p.trueRoom;
  return G.suspects.filter(other => {
    if (other === name) return false;
    const o = G.people[other];
    const oRoom = o.isMurderer ? o.claimRoom : o.trueRoom;
    if (oRoom !== claimRoom) return false;
    const names = o.isMurderer ? [o.claimWitness] : o.group;
    return names.includes(name);
  });
}

// rooms reachable from the door through the room graph (the passage is excluded)
function reachableRooms(ADJ, start) {
  const seen = new Set([start]), st = [start];
  while (st.length) {
    const c = st.pop();
    for (const k of Object.keys(ADJ[c])) { if (k === 'P') continue; const nb = ADJ[c][k]; if (!seen.has(nb)) { seen.add(nb); st.push(nb); } }
  }
  return seen;
}

const NAME_SETS = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  ['A', 'B', 'C', 'D', 'E'],
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
  ['Solo'],
  ['A', 'A', 'B'],
];

let runs = 0, fails = 0;
for (const set of NAME_SETS) {
  for (let t = 0; t < 4000; t++) {
    runs++;
    newGame(set, 'normal');
    const G = getG(), ROOMS = getRooms(), ADJ = getAdj(), FLOORS = getFloors(), META = getMeta();
    const f = FLOORS[0];
    const startRoom = f.owner[START.y][START.x];

    // 1) murderer is uncorroborated
    if (corroborators(G, G.murdererName).length !== 0) { fails++; console.error('FAIL: murderer corroborated; set', set); continue; }

    // 2) every innocent IS corroborated (so the liar is unique)
    const innocents = G.suspects.filter(n => n !== G.murdererName);
    if (innocents.find(n => corroborators(G, n).length === 0)) { fails++; console.error('FAIL: an innocent is uncorroborated; set', set); continue; }

    // 3) the murderer did NOT truly stand where they claim
    if (G.people[G.murdererName].claimRoom === G.murderRoom) { fails++; console.error('FAIL: murderer claim == scene'); continue; }

    // 4) the room is discoverable (bloodstains mark it), and the victim is a guest
    if (G.objects[G.murderRoom]?.kind !== 'blood') { fails++; console.error('FAIL: no bloodstains in murder room'); continue; }
    if (!G.victim || G.suspects.includes(G.victim) || G.victim === G.murdererName) { fails++; console.error('FAIL: bad victim'); continue; }
    if (G.suspects.length !== 7) { fails++; console.error('FAIL: expected 7 suspects, got', G.suspects.length, 'set', set); continue; }

    // 5) the weapon is discoverable
    if (!(Object.values(G.objects).some(o => o.kind === 'weapon') || G.weaponAtScene)) { fails++; console.error('FAIL: weapon not discoverable'); continue; }

    // 6) the house is the twelve-room single story
    if (ROOMS.length !== ROOM_COUNT) { fails++; console.error('FAIL: expected', ROOM_COUNT, 'rooms, got', ROOMS.length); continue; }
    if (FLOORS.length !== 1) { fails++; console.error('FAIL: one story but', FLOORS.length, 'floors'); continue; }

    // 7) every ESSENTIAL clue is reachable on foot from the door (room graph)
    const reach = reachableRooms(ADJ, startRoom);
    if (![G.murderRoom, G.weaponRoom, G.glassRoom].every(r => reach.has(r))) { fails++; console.error('FAIL: an essential clue is unreachable'); continue; }

    // 8) the tile floorplan is walkable: flood-fill floor tiles from the door and
    //    confirm every reachable room's centre tile was actually reached
    const seenT = new Set([START.y * f.W + START.x]), stack = [[START.x, START.y]];
    const key = (x, y) => y * f.W + x;
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= f.W || ny >= f.H) continue;
        if (f.tiles[ny][nx] === 0) continue;            // 0 === WALL
        if (seenT.has(key(nx, ny))) continue;
        seenT.add(key(nx, ny)); stack.push([nx, ny]);
      }
    }
    let tileFail = false;
    for (const ri of reach) { const c = META[ri].center; if (!seenT.has(key(c.x, c.y))) { tileFail = true; break; } }
    if (tileFail) { fails++; console.error('FAIL: a reachable room is not walkable from the door'); continue; }

    // 9) the secret passage: a hidden door from a reachable tile through a wall
    //    into the sealed chamber, and an exit spot inside that chamber.
    const P = G.passage;
    if (!P || !P.entry || !P.entry.a || !P.entry.b || !P.exitTile) { fails++; console.error('FAIL: no secret passage'); continue; }
    // the door's outside tile `a` is a reachable-room floor tile; inside tile `b`
    // and the exit spot are both in the sealed chamber; a wall sits between them.
    if (!reach.has(f.owner[P.entry.a.y][P.entry.a.x])) { fails++; console.error('FAIL: passage entrance not reachable'); continue; }
    if (f.owner[P.entry.b.y][P.entry.b.x] !== 1) { fails++; console.error('FAIL: passage inside not the chamber'); continue; }
    if (f.owner[P.exitTile.y][P.exitTile.x] !== 1) { fails++; console.error('FAIL: passage exit not in the chamber'); continue; }
    const mid = { x: (P.entry.a.x + P.entry.b.x) / 2, y: (P.entry.a.y + P.entry.b.y) / 2 };
    if (f.tiles[mid.y][mid.x] !== 0) { fails++; console.error('FAIL: no wall in the secret door'); continue; }
    if (P.exitTile.x === P.entry.b.x && P.exitTile.y === P.entry.b.y) { fails++; console.error('FAIL: exit spot is the entrance'); continue; }
  }
}

if (fails === 0) {
  console.log(`OK — ${runs} randomized cases, all uniquely solvable; house well-formed, clues reachable, passage hidden.`);
  process.exit(0);
} else {
  console.error(`${fails}/${runs} cases FAILED`);
  process.exit(1);
}
