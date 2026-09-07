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
the **unique guest whose alibi no one confirms**. Question the guests, keep
track of who was where, and find the liar.

This invariant is checked in `test/solvable.test.js`.

### The house

The map is the **exact overhead floorplan of the one-story estate**, transcribed
character-for-character from the original as a monospaced block-glyph grid — full
blocks (`█`) for the outer walls, half blocks (`▀▄▌▐` and corners) for the interior
walls, and thin lines (`─`) for the staircase steps at the two front entrances.
Your character is a **yellow smiley face** that walks the open floor; any block glyph is
solid, spaces are floor. You are the **yellow face**; the guests are anonymous
**cyan faces** (as in the original) — you find out who's in a room by walking in
and reading who's there.

The estate holds **eleven ordinary rooms** — Parlor, Study, West Hall,
Grand Foyer, Dining Hall, Ballroom, Music Room, East Hall, Master Bedroom,
Bathroom and Kitchen — plus the sealed twelfth space described below. You walk
with the arrow keys; stepping into a new room is what costs a move. The murder
can happen in any room you can reach, and the guests roam the house too. The solvability test checks that every essential clue
is reachable through the room graph *and* that the tile floorplan itself is
walkable from the front door.

### The secret passage

Hidden inside the walls is a **secret passage** — a sealed chamber with no
ordinary doorway (matching the original's rooms with "no apparent opening"). It
isn't a command and it isn't marked. You find it the way you'd expect to: by
**walking into the wall** at different points. One spot along the wall — fixed at
the start of each game — quietly gives way and slips you *inside* the passage.

Once in, you're in the dark with a cold stone obelisk, not in any normal room.
Feel your way around: one spot on the floor (the spot is fixed at the start)
**drops you out into a random room** — somewhere different **each time** you use
it. So the two fixed things are *where* you get in and *where* the exit spot is;
where it flings you is a fresh surprise. And you're not the only one who knows the
passage: **a guest may wander into it too**, so mind who you meet in the dark.

## How to play

Everything is typed (plus the arrow keys) — no buttons, like the original.

- **Move**: the **arrow keys** walk you (the yellow face) through the rooms.
  Entering a new room spends a move.
- **`EXAMINE`** (shortcut **`EX`**): inspect the clue in the current room
  — bloodstains reveal the room; the glass reveals more.
- **`QUESTION <name>`** (shortcut **`Q`**): ask a guest for their alibi. **Don't
  over-ask** — the murderer notices.
- **`TAKE glass`**: pick up the magnifying glass (needed before you can read clues closely).
- **`ACCUSE`**: name the murderer, weapon, and room. One shot. Be right.
- **`WAIT`**, **`LOOK`**, **`NOTEBOOK`**, **`HELP`**: as you'd expect.

The hidden passage has **no command** — you find and use it by walking (see
"The secret passage" above).

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
bin/sleuth   operate CLI (deploy / start / restart / logs / status / test)
test/        headless solvability + Playwright browser tests
```

## Tests

```
npm test                       # runs both suites
node test/solvable.test.js     # 20k cases: uniquely solvable + house well-formed
node test/browser.smoke.js     # Playwright: win path + death path, 0 console errors
```

The browser test needs Playwright + Chromium on `NODE_PATH`.

## Deploying on the lab980 droplet

Served at **sleuth.lab980.com** — standard one-dir-per-site / pm2 / nginx /
certbot shape. Run this **on the droplet** (provisioning can't be done from a
sandbox):

```
provision-site sleuth ivjames/sleuth        # DO DNS + dir + clone + nginx + TLS
ln -sf /var/www/sleuth/bin/sleuth /usr/local/bin/sleuth
sleuth deploy                               # npm ci --omit=dev, first pm2 start on the assigned port, probe, save
```

**Don't pass `--port`.** `provision-site` picks the next free port in 8060–8099
by scanning both live sockets and existing nginx vhosts, and writes it to
`/var/www/sleuth/.env`; `bin/sleuth` reads `PORT` from there (with a builtin
parser — it never sources the file) and hands it to pm2, which is the only way
it reaches `server.js`. So the app, pm2, and the nginx proxy all agree without
ever stomping another site. `provision-site` clones the repo's **default
branch** (`main`).

`sleuth deploy` does the first `pm2 start` itself when nothing named `sleuth`
is registered, from `START_CMD` at the top of `bin/sleuth`
(`server.js --name sleuth`); `sleuth start` is the same registration on its
own, without the sync and install. Every pm2 call the CLI makes is scrubbed —
`env -i` plus `PATH`, `HOME`, `LANG`, `PM2_HOME`/`TERM` if set, and `PORT` —
so nothing from the shell that ran it reaches pm2, the process, or
`~/.pm2/dump.pm2`. Don't `pm2 start` or `pm2 restart --update-env` by hand.

Thereafter, once a change is merged to `main` (merging does not deploy):

```
sleuth deploy          # git fetch + reset --hard origin/main, npm ci --omit=dev, pm2 restart, probe, save
sleuth restart         # pm2 restart + probe
sleuth logs [n]        # tail pm2 logs (n lines, default 80; pm2 logs flags pass through)
sleuth status          # HEAD, pm2 state, port, local + public probe, cert days
sleuth test            # npm test
```

`deploy` hard-resets the checkout to `origin/main` — a tracked file edited on
the droplet is destroyed silently; `.env` and `node_modules/` are gitignored
and survive. It exits non-zero (and does not `pm2 save`) when nothing answers
on `127.0.0.1:<PORT>` afterwards; `pm2 save` also only runs when every
registered pm2 process is online. Overrides: `SLEUTH_FQDN`, `SLEUTH_BRANCH`,
`SLEUTH_PORT` (default: `.env` `PORT`, else 8065), `SLEUTH_PROBE_TRIES`.

> **Keep `PORT` in `/var/www/sleuth/.env`.** The `8065` fallback above is
> `server.js`'s own default, and **8065 is `gigit`'s registered port** on this
> droplet — this site's is **8066** per lab980's `.claude/sites.json`. So if
> `.env` is missing or unreadable, `sleuth deploy` hands pm2 port 8065:
> `server.js` fails to bind it (gigit already has it) while the deploy's probe
> of `127.0.0.1:8065` is answered **by gigit** and passes. The deploy then
> reports success with sleuth dead — a check that succeeds in exactly the case
> it exists to catch. `sleuth status` prints the port it resolved; read it, and
> confirm `grep '^PORT=' /var/www/sleuth/.env` is there before deploying after
> any `.env` change.
>
> Which port is actually live is not visible from outside (it is loopback-only),
> so the 8066-vs-8065 question needs the droplet: `grep '^PORT=' /var/www/sleuth/.env`
> and `grep proxy_pass /etc/nginx/sites-available/sleuth.lab980.com`.

## Credits

Original **Sleuth** © 1983 Eric N. Miller / Norland Software. This is an
independent, from-scratch homage — no original code or assets are used.

The map is drawn in **Source Code Pro** (Medium) by Adobe — the font it was
authored in — subset and embedded so it renders exactly as designed. Source Code
Pro is licensed under the SIL Open Font License 1.1; see
[`fonts/NOTICE.md`](fonts/NOTICE.md).
