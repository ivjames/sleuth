/* Headless verification that every randomized case is logically solvable:
   the murderer is the UNIQUE suspect whose alibi no one corroborates, and the
   witness they name never places them at the scene of their claimed alibi.
   Run: node test/solvable.test.js
*/
const { newGame, getG, ROOMS } = require('../game.js');

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
  }
}

if (fails === 0) {
  console.log(`OK — ${runs} randomized cases, all uniquely solvable (murderer is the sole uncorroborated liar; room & weapon both discoverable).`);
  process.exit(0);
} else {
  console.error(`${fails}/${runs} cases FAILED`);
  process.exit(1);
}
