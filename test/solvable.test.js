/* Headless verification that every randomized case is logically solvable:
   the murderer is the UNIQUE suspect whose alibi no one corroborates, and the
   witness they name never places them at the scene of their claimed alibi.
   Run: node test/solvable.test.js
*/
const { newGame, getG, getRooms, getAdj, getFloors, getMeta } = require('../game.js');

function corroborators(G, name) {
  // who claims to have been in the SAME room AND names `name`?
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

const NAME_SETS = [
  // Every set becomes exactly 8 guests -> 1 victim + 7 suspects.
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],        // exactly 8
  ['A', 'B', 'C', 'D', 'E'],                       // 5 -> padded to 8
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], // 10 -> trimmed to 8
  ['Solo'],                                        // 1 -> padded to 8
  ['A', 'A', 'B'],                                 // dupes -> deduped & padded to 8
];

let runs = 0, fails = 0;
for (const set of NAME_SETS) {
  for (let t = 0; t < 4000; t++) {
    runs++;
    newGame(set, 'normal');
    const G = getG();

    // 1) murderer is uncorroborated
    const mCorr = corroborators(G, G.murdererName);
    if (mCorr.length !== 0) { fails++; console.error('FAIL: murderer corroborated by', mCorr, 'set', set); continue; }

    // 2) every innocent IS corroborated (so the liar is unique)
    const innocents = G.suspects.filter(n => n !== G.murdererName);
    const badInnocent = innocents.find(n => corroborators(G, n).length === 0);
    if (badInnocent) { fails++; console.error('FAIL: innocent', badInnocent, 'uncorroborated; set', set); continue; }

    // 3) murderer did NOT truly stand where they claim (their alibi is a lie)
    if (G.people[G.murdererName].claimRoom === G.murderRoom) { fails++; console.error('FAIL: murderer claim == scene'); continue; }

    // 4) the room is discoverable (bloodstains mark the murder room)
    if (G.objects[G.murderRoom]?.kind !== 'blood') { fails++; console.error('FAIL: no bloodstains in murder room'); continue; }

    // 4b) the victim is one of the guests, and is neither a suspect nor the murderer
    if (!G.victim) { fails++; console.error('FAIL: no victim'); continue; }
    if (G.suspects.includes(G.victim)) { fails++; console.error('FAIL: victim is also a suspect', G.victim); continue; }
    if (G.victim === G.murdererName) { fails++; console.error('FAIL: victim is the murderer'); continue; }

    // 4c) eight guests total -> exactly seven suspects
    if (G.suspects.length !== 7) { fails++; console.error('FAIL: expected 7 suspects, got', G.suspects.length, 'set', set); continue; }

    // 5) the weapon is discoverable (a weapon object exists, or it is at the scene)
    const hasWeaponObj = Object.values(G.objects).some(o => o.kind === 'weapon') || G.weaponAtScene;
    if (!hasWeaponObj) { fails++; console.error('FAIL: weapon not discoverable'); continue; }

    // 6) the mansion is well-formed: 16 rooms, and every room is REACHABLE from
    //    the entrance (index 0) via N/S/E/W/U/D — no room is stranded, even on
    //    the far floor of a two-story house (stairs must connect the floors).
    const ROOMS = getRooms(), ADJ = getAdj(), FLOORS = getFloors(), META = getMeta();
    if (ROOMS.length !== 16) { fails++; console.error('FAIL: expected 16 rooms, got', ROOMS.length); continue; }
    const seen = new Set([0]), stack = [0];
    while (stack.length) { const cur = stack.pop(); for (const nxt of Object.values(ADJ[cur])) if (!seen.has(nxt)) { seen.add(nxt); stack.push(nxt); } }
    if (seen.size !== ROOMS.length) { fails++; console.error('FAIL: unreachable rooms', ROOMS.length - seen.size, 'stories', G.stories); continue; }

    // two-story houses must actually have working stairs (U/D links)
    if (G.stories === 2) {
      if (FLOORS.length !== 2) { fails++; console.error('FAIL: two-story but', FLOORS.length, 'floors'); continue; }
      const hasStairs = META.some(m => m.stair) && ADJ.some(a => a.U != null) && ADJ.some(a => a.D != null);
      if (!hasStairs) { fails++; console.error('FAIL: two-story house has no stairs'); continue; }
    } else if (FLOORS.length !== 1) { fails++; console.error('FAIL: one-story but', FLOORS.length, 'floors'); continue; }

    // 7) the TILE floorplan is walkable: on each floor, a flood-fill over floor
    //    tiles from one room's centre must reach every room's interior — i.e. the
    //    doorways actually connect the rooms you can walk between.
    let tileFail = false;
    for (const f of FLOORS) {
      const start = META.find(m => m.floor === FLOORS.indexOf(f)).rect;
      const seenT = new Set(), st = [[start.x, start.y]];
      const key = (x, y) => y * f.W + x;
      seenT.add(key(start.x, start.y));
      while (st.length) {
        const [x, y] = st.pop();
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= f.W || ny >= f.H) continue;
          if (f.tiles[ny][nx] === 0) continue;               // wall
          if (seenT.has(key(nx, ny))) continue;
          seenT.add(key(nx, ny)); st.push([nx, ny]);
        }
      }
      // every room interior tile on this floor must have been reached
      const roomsOnFloor = META.filter(m => m.floor === FLOORS.indexOf(f));
      for (const m of roomsOnFloor) {
        if (!seenT.has(key(m.rect.x, m.rect.y))) { tileFail = true; break; }
      }
      if (tileFail) break;
    }
    if (tileFail) { fails++; console.error('FAIL: floorplan has an unreachable room (bad doorway)'); continue; }
  }
}

if (fails === 0) {
  console.log(`OK — ${runs} randomized cases, all uniquely solvable (murderer is the sole uncorroborated liar; room & weapon both discoverable).`);
  process.exit(0);
} else {
  console.error(`${fails}/${runs} cases FAILED`);
  process.exit(1);
}
