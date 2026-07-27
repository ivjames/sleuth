# Sleuth — A Murder Mystery

A browser clone of **Sleuth**, the 1983 MS-DOS whodunit by Eric N. Miller
(Norland Software). It's a *Clue*-style deduction game with a twist: a hidden
magnifying glass, roaming guests, a ticking clock, and a killer who gets
nervous — and then deadly — the more you poke around.

Play it in any modern browser. No build step, no dependencies for the game
itself.

```
open index.html          # or serve it: npm start  ->  http://127.0.0.1:8065
```

## The case

There are **eight guests** at the party. Every game randomizes the
**murderer**, the **weapon**, the **room**, the **victim** (one of the eight,
drawn at random — the other seven are your suspects), and where the
**magnifying glass** is hidden. You win by naming the murderer, weapon, and
room correctly. Get any of the three wrong, or run out of time, and the killer
gets *you*.

You solve three separate sub-puzzles:

| Clue         | How you find it                                                        |
|--------------|-----------------------------------------------------------------------|
| **The room** | There's no body — the murder room is betrayed by **bloodstains on the floor**. A guest is often (but not always) found *staring at the floor* there. Walk in and **examine** them. |
| **The weapon** | Examine the stains with the **glass** to read the scene (it narrows the field); find the **bloodied weapon** to be certain. |
| **The murderer** | Cross-examine alibis. Exactly one guest is lying, and *nobody backs up their story*. |

### The deduction (why it's always fair)

Every innocent guest was somewhere with at least one other innocent, and each
names the others they were with — so innocents **mutually corroborate**. The
murderer, who was really at the scene, invents an alibi: they claim a room and
name a "witness." But that witness never places them there. So the murderer is
the **unique guest whose alibi no one confirms**. Question the guests, watch
the notebook, and find the liar.

This invariant is checked in `test/solvable.test.js`.

### The house (one story or two)

The map is an **overhead line-art floorplan**, like the original: walled rooms
joined by **doorways**, and your character is a **dot (`@`)** that walks through
them (guests show as lettered dots). As in the original, each game is set in one
of two houses, **chosen at random**:

- a sprawling **single-story estate** — one floor of sixteen rooms, and
- a **two-story mansion** — two floors (Ground and Upper) drawn side by side
  with a break between them, joined by **staircases** (`≣`) at opposite corners.

Both hold sixteen rooms. You walk with the arrow keys; stepping through a
doorway into a new room is what costs a move. To change floors, stand in a
staircase room and press **UP** / **DOWN** (or PageUp/PageDown). The murder can
happen on either floor, and the guests roam between floors too. The solvability
test checks both that every room is reachable through the room graph and that
the tile floorplan itself is walkable (doorways actually connect the rooms).

### The secret passage

Every house hides a **secret passage**. Somewhere the wallpaper's pattern
"doesn't quite line up in one corner" — **`SEARCH`** that room and, after a
little probing, a panel slides aside to reveal a hidden route to a far part of
the house (in a two-story mansion, it links the two floors). Once open it's
marked `=` at both ends; step into it or use **`PASSAGE`** to slip through — a
shortcut only *you* know about (the guests never use it). Mind the black
obelisk in the dark.

## How to play

- **Move**: **arrow keys** walk your dot (`@`) through rooms and doorways
  (`N`/`S`/`E`/`W` step one tile too). Entering a new room spends a move.
- **Stairs**: in a two-story house, stand in a staircase room and press
  **`UP`**/**`DOWN`** (or PageUp/PageDown) to cross between floors.
- **`TAKE glass`**: pick up the magnifying glass (required before you can examine clues).
- **`EXAMINE`**: inspect the clue in the current room (or click the object).
- **`QUESTION <name>`**: ask a guest for their alibi (or click a guest). **Don't over-ask** — the murderer notices.
- **`NOTEBOOK`**: review everything you've gathered.
- **`ACCUSE`**: name the murderer, weapon, and room. One shot. Be right.
- **`WAIT`**, **`LOOK`**, **`HELP`**: as you'd expect.

**Pressure:** every action burns a move. When the killer's suspicion meter
fills (from repeated questioning), they start **hunting you** — if they catch
you in the same room, or your time runs out, you're dead. Difficulty (Rookie /
Detective / Master Sleuth) tunes the move budget and how fast suspicion builds.

Add your friends' names as the eight guests on the start screen — a nod to the
original, which let you cast your own party. As in the original, **one of the
eight is chosen at random as the victim** and the other seven become the
suspects, so any name you enter (your own included) might be the one found
dead. Name fewer than eight and the defaults fill the rest; name more and only
the first eight come to the party.

## Project layout

```
index.html   markup + screens
styles.css   CGA/amber-phosphor DOS terminal look (scanlines and all)
game.js      the whole engine — case generation, alibi logic, turns, endgame
server.js    zero-dependency static server (PORT, default 8065)
bin/sleuth   operate CLI (deploy / restart / logs / test)
test/        headless solvability + Playwright browser tests
```

## Tests

```
npm test                       # runs both suites
node test/solvable.test.js     # 20k cases: uniquely solvable + mansion well-formed
node test/browser.smoke.js     # Playwright: win path + death path, 0 console errors
```

The browser test needs Playwright + Chromium on `NODE_PATH`.

## Deploying on the lab980 droplet

Standard one-dir-per-site / pm2 / nginx / certbot shape:

```
provision-site sleuth ivjames/sleuth        # DNS + dir + clone + nginx + TLS
cd /var/www/sleuth && npm ci --omit=dev
PORT=8065 pm2 start server.js --name sleuth && pm2 save
ln -sf /var/www/sleuth/bin/sleuth /usr/local/bin/sleuth
```

Thereafter `sleuth deploy` does git pull → install → pm2 restart.

## Credits

Original **Sleuth** © 1983 Eric N. Miller / Norland Software. This is an
independent, from-scratch homage — no original code or assets are used.
