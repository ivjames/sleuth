# framesleuth

Turn gameplay video — a **YouTube URL** or a **local file** — into a
**deduplicated PNG frame sequence**, so every saved shot shows a distinct
player/object position instead of a wall of near-identical frames. Optionally
runs **OCR** on each kept frame to capture on-screen text (HUD, score,
dialogue) as `textual examples`.

```
acquire (yt-dlp / local)  →  extract frames (ffmpeg)  →  strip duplicates  →  OCR  →  manifest.json
```

## Install

```bash
cd framesleuth
pip install -r requirements.txt        # or: pip install .

# System tools (not pip-installable):
#   ffmpeg + ffprobe   — required (frame extraction & probing)
#   tesseract-ocr      — required only when OCR is enabled (the default)
sudo apt-get install ffmpeg tesseract-ocr     # Debian/Ubuntu
```

## Usage

```bash
# From a YouTube URL, sampling 2 frames/sec, perceptual-hash dedup, OCR on:
python -m framesleuth "https://youtu.be/VIDEO_ID" -o out --fps 2

# From a local file, frame-difference dedup, no OCR:
python -m framesleuth ./capture.mp4 -o out --method diff --no-ocr

# Installed as a console script (after `pip install .`):
framesleuth ./capture.mp4 -o out
```

### Output layout

```
out/
  frames/
    frame_000000.png      # kept, deduplicated frames (zero-padded, in order)
    frame_000000.txt      # OCR text sidecar (only when text was found)
    frame_000001.png
    ...
  manifest.json           # one record per kept frame (see below)
```

`manifest.json` records the source, the parameters used, and for every kept
frame its `filename`, originating `source_frame`, `timestamp`, `phash`, and
(when OCR is on) the extracted `text`.

## Example

A worked example on real footage lives in
[`examples/sleuth-gameplay/`](examples/sleuth-gameplay/): gameplay of the
original SLEUTH 4.1 DOS game, where 557 sampled frames collapse to 25 distinct
shots with OCR text per frame. See its
[README](examples/sleuth-gameplay/README.md) and contact sheet.

## Options

| Flag | Default | Meaning |
|------|---------|---------|
| `source` | — | YouTube/other URL, or a local video path. |
| `-o, --output` | `output` | Output directory. |
| `--fps` | `1.0` | Sampling rate before dedup. `0` = the video's native frame rate (many more frames). |
| `--method` | `phash` | Dedup strategy: `phash` or `diff` (see below). |
| `--threshold` | per-method | Sensitivity. Larger keeps fewer frames. |
| `--scale-width` | — | Downscale frames to this width (px) before dedup/OCR/output. |
| `--start` / `--duration` | — | Trim: start offset and length, in seconds. |
| `--ocr` / `--no-ocr` | `--ocr` | Run OCR on each kept frame. |
| `--ocr-lang` | `eng` | Tesseract language(s), e.g. `eng+deu`. |
| `--keep-raw` | off | Keep the full pre-dedup frame set under `out/raw/`. |
| `-v, --verbose` | off | Verbose logging. |

## Dedup methods

Both compare each frame against the **last kept frame** (not merely the
previous one), so a static screen collapses to a single representative shot
while slow drift still eventually registers as a new one.

- **`phash`** (default) — perceptual hash. A frame is kept when its Hamming
  distance from the last kept frame exceeds the threshold (**default 6**, out
  of 64 bits). Robust to compression noise and tiny jitter. Note: perceptual
  hashing keys off *texture/structure*, so it is the right tool for real
  gameplay but treats flat single-color frames as indistinguishable.
- **`diff`** — frame differencing. Frames are reduced to a 32×32 grayscale
  signature and compared by mean absolute difference in `[0, 1]`; kept when
  that exceeds the threshold (**default 0.02**). More sensitive to small
  on-screen motion; tune the float threshold to taste.

Not sure which to use? Run both and compare — `--method phash` vs
`--method diff` — the manifest's `kept_frame_count` tells you how aggressively
each collapsed the sequence.

## Tests

```bash
cd framesleuth
python -m unittest discover -s tests -v
```

The dedup and utility tests are pure Python. The pipeline and OCR tests build
a synthetic video / image with ffmpeg and read it back; they **skip
automatically** if `ffmpeg`/`ffprobe` or `tesseract` are not installed.

## Notes

- Downloading from a URL requires network access and `yt-dlp`; local-file
  processing needs neither.
- PNG output is lossless. Use `--scale-width` and a coarser `--fps` to keep
  output size down on long videos.
```
