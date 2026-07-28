"""Probe videos and extract frames to a PNG sequence using ffmpeg/ffprobe."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .utils import log, require_tool


@dataclass
class VideoInfo:
    """Basic metadata read from ffprobe."""

    duration: float  # seconds; 0.0 if unknown
    fps: float  # average frame rate; 0.0 if unknown
    width: int
    height: int


def probe_video(path: Path) -> VideoInfo:
    """Return duration/fps/size for `path` using ffprobe."""
    ffprobe = require_tool(
        "ffprobe", "Install ffmpeg (which provides ffprobe), e.g. 'apt-get install ffmpeg'."
    )
    cmd = [
        ffprobe,
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=avg_frame_rate,width,height:format=duration",
        "-of", "json",
        str(path),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    data = json.loads(out)

    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}

    duration = _to_float(fmt.get("duration"))
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    fps = _parse_rate(stream.get("avg_frame_rate"))

    return VideoInfo(duration=duration, fps=fps, width=width, height=height)


def extract_frames(
    path: Path,
    out_dir: Path,
    fps: float | None = None,
    scale_width: int | None = None,
    start: float | None = None,
    duration: float | None = None,
) -> list[Path]:
    """Extract frames from `path` into `out_dir` as zero-padded PNGs.

    Args:
        fps: sampling rate. None (or <= 0) extracts every source frame.
        scale_width: if set, downscale frames to this width (height auto,
            preserving aspect ratio, forced even for codec friendliness).
        start: seek offset in seconds before extracting.
        duration: only extract this many seconds after `start`.

    Returns the sorted list of produced PNG paths.
    """
    ffmpeg = require_tool(
        "ffmpeg", "Install ffmpeg, e.g. 'apt-get install ffmpeg'."
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    filters: list[str] = []
    if fps and fps > 0:
        filters.append(f"fps={fps}")
    if scale_width and scale_width > 0:
        filters.append(f"scale={int(scale_width)}:-2")

    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
    # Placing -ss before -i gives fast (keyframe-accurate) seeking.
    if start and start > 0:
        cmd += ["-ss", f"{start}"]
    cmd += ["-i", str(path)]
    if duration and duration > 0:
        cmd += ["-t", f"{duration}"]
    if filters:
        cmd += ["-vf", ",".join(filters)]
    # -vsync passthrough behavior differs across ffmpeg versions; fps filter
    # already governs the cadence, so we let ffmpeg number output naturally.
    pattern = str(out_dir / "raw_%08d.png")
    cmd += [pattern]

    log.info("extracting frames%s -> %s", _describe(fps, scale_width, start, duration), out_dir)
    log.debug("ffmpeg cmd: %s", " ".join(cmd))
    subprocess.run(cmd, check=True)

    frames = sorted(out_dir.glob("raw_*.png"))
    log.info("extracted %d raw frames", len(frames))
    return frames


def _describe(fps, scale_width, start, duration) -> str:
    parts = []
    parts.append(f"fps={fps}" if fps and fps > 0 else "fps=native")
    if scale_width:
        parts.append(f"width={scale_width}")
    if start:
        parts.append(f"start={start}s")
    if duration:
        parts.append(f"dur={duration}s")
    return " (" + ", ".join(parts) + ")"


def _to_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _parse_rate(rate) -> float:
    """Parse an ffprobe rational rate string like '30000/1001'."""
    if not rate or rate == "0/0":
        return 0.0
    if "/" in str(rate):
        num, den = str(rate).split("/", 1)
        try:
            den_f = float(den)
            return float(num) / den_f if den_f else 0.0
        except ValueError:
            return 0.0
    return _to_float(rate)
