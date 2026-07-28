"""Orchestrate acquire -> extract -> dedup -> OCR -> manifest."""

from __future__ import annotations

import json
import shutil
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import __version__
from .acquire import acquire_video
from .dedup import DEFAULT_THRESHOLDS, dedup_frames
from .extract import extract_frames, probe_video
from .ocr import ensure_tesseract, ocr_image
from .utils import format_timestamp, human_bytes, log


@dataclass
class PipelineConfig:
    source: str
    output_dir: Path
    fps: float | None = None          # None/<=0 -> native frame rate
    method: str = "phash"
    threshold: float | None = None    # None -> per-method default
    scale_width: int | None = None
    start: float | None = None
    duration: float | None = None
    ocr: bool = True
    ocr_lang: str = "eng"
    keep_raw: bool = False


@dataclass
class PipelineResult:
    frames_dir: Path
    manifest_path: Path
    raw_count: int
    kept_count: int
    kept: list[dict] = field(default_factory=list)


def run_pipeline(config: PipelineConfig) -> PipelineResult:
    """Execute the full pipeline and return a summary of what was produced."""
    if config.threshold is None:
        config.threshold = DEFAULT_THRESHOLDS[config.method]

    # Fail fast on a missing OCR engine before doing expensive extraction.
    if config.ocr:
        ensure_tesseract()

    output_dir = Path(config.output_dir)
    frames_dir = output_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Work in a temp dir for the source download + raw frames unless the user
    # wants the raw frames kept, in which case stage them under the output dir.
    if config.keep_raw:
        work_root = output_dir / "raw"
        work_root.mkdir(parents=True, exist_ok=True)
        cleanup = False
    else:
        work_root = Path(tempfile.mkdtemp(prefix="framesleuth_"))
        cleanup = True

    try:
        video_path = acquire_video(config.source, work_root)
        info = probe_video(video_path)
        log.info(
            "video: %dx%d, %.3f fps, %s",
            info.width, info.height, info.fps, format_timestamp(info.duration),
        )

        raw_dir = work_root / "frames_raw"
        raw_frames = extract_frames(
            video_path,
            raw_dir,
            fps=config.fps,
            scale_width=config.scale_width,
            start=config.start,
            duration=config.duration,
        )
        if not raw_frames:
            raise RuntimeError(
                "ffmpeg produced no frames; check the source, --start/--duration, "
                "and that the file contains a video stream."
            )

        kept = dedup_frames(raw_frames, method=config.method, threshold=config.threshold)
        log.info(
            "kept %d / %d frames (%s method, threshold %s)",
            len(kept), len(raw_frames), config.method, config.threshold,
        )

        # Effective sampling fps governs each kept frame's source timestamp.
        sample_fps = config.fps if (config.fps and config.fps > 0) else info.fps
        start_offset = config.start or 0.0

        manifest_frames: list[dict] = []
        for k in kept:
            dest_name = f"frame_{k.index:06d}.png"
            dest = frames_dir / dest_name
            shutil.copyfile(k.path, dest)

            timestamp = None
            if sample_fps and sample_fps > 0:
                timestamp = start_offset + (k.source_index / sample_fps)

            entry: dict = {
                "index": k.index,
                "filename": dest_name,
                "source_frame": k.source_index,
                "timestamp_seconds": round(timestamp, 3) if timestamp is not None else None,
                "timestamp": format_timestamp(timestamp) if timestamp is not None else None,
                "phash": k.signature or None,
            }

            if config.ocr:
                text = ocr_image(dest, lang=config.ocr_lang)
                entry["text"] = text
                if text:
                    (frames_dir / f"frame_{k.index:06d}.txt").write_text(
                        text + "\n", encoding="utf-8"
                    )

            manifest_frames.append(entry)

        manifest = {
            "tool": "framesleuth",
            "version": __version__,
            "source": config.source,
            "video": {
                "width": info.width,
                "height": info.height,
                "fps": info.fps,
                "duration_seconds": info.duration,
            },
            "params": {
                "fps": config.fps,
                "method": config.method,
                "threshold": config.threshold,
                "scale_width": config.scale_width,
                "start": config.start,
                "duration": config.duration,
                "ocr": config.ocr,
                "ocr_lang": config.ocr_lang if config.ocr else None,
            },
            "raw_frame_count": len(raw_frames),
            "kept_frame_count": len(kept),
            "frames": manifest_frames,
        }
        manifest_path = output_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

        _log_output_size(frames_dir)
        return PipelineResult(
            frames_dir=frames_dir,
            manifest_path=manifest_path,
            raw_count=len(raw_frames),
            kept_count=len(kept),
            kept=manifest_frames,
        )
    finally:
        if cleanup:
            shutil.rmtree(work_root, ignore_errors=True)


def _log_output_size(frames_dir: Path) -> None:
    total = sum(p.stat().st_size for p in frames_dir.glob("*.png"))
    log.info("wrote frames to %s (%s)", frames_dir, human_bytes(total))
