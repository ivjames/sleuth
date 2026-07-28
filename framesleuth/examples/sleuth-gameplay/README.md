# Example: SLEUTH 4.1 gameplay

A worked example of framesleuth on real gameplay footage — fittingly, of the
original **SLEUTH Version 4.1** (Norland Software), the DOS game this repository
reimagines.

- **Source:** [`sleuth-gameplay.mp4`](./sleuth-gameplay.mp4) — 640×360, ~4m38s,
  30 fps.
- **Command** (tuned to catch fine movement detail — a high sampling rate and a
  tight dedup threshold, so intermediate positions survive):
  ```bash
  python -m framesleuth examples/sleuth-gameplay/sleuth-gameplay.mp4 \
      -o out --fps 10 --method phash --threshold 4
  ```
- **Result:** 2,785 sampled frames (10 fps) deduplicated down to **64 distinct
  shots**. Each kept frame has a `.txt` OCR sidecar in [`frames/`](./frames);
  full per-frame records (timestamp, phash, text) are in
  [`manifest.json`](./manifest.json).

The tight threshold keeps genuine movement rather than duplicates: the title
screen typing in letter-by-letter (frames #00–#17) and the player dot walking
room to room across the floorplan (frames #21+) each register as their own
shot. For a leaner set, raise `--threshold` (e.g. 6 → ~41 shots, 8 → ~24) or
lower `--fps`.

![Contact sheet of the 25 kept frames](./contact_sheet.png)

The OCR captured the game's on-screen text well — the intro ("It is a dark and
stormy night. A murder is…"), the victim ("Harriet Seton was brutally
murdered…"), and room-by-room descriptions (sewing room, parlor, family vault,
master bedroom, butler's bedroom, dining hall, east hall) — exactly the "valid
player/object position + textual example" per shot this tool is meant to
produce.

The `contact_sheet.png` here is a convenience overview generated for the README;
framesleuth itself outputs the individual PNGs and the manifest.
