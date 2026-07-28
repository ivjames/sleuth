"""Command-line interface for framesleuth."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .dedup import DEFAULT_THRESHOLDS
from .pipeline import PipelineConfig, run_pipeline
from .utils import DependencyError, setup_logging


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="framesleuth",
        description=(
            "Extract a deduplicated PNG frame sequence from gameplay video "
            "(YouTube URL or local file), optionally OCR-ing each kept frame."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "source",
        help="YouTube (or other) video URL, or a path to a local video file.",
    )
    parser.add_argument(
        "-o", "--output", default="output",
        help="Output directory for frames/ and manifest.json.",
    )
    parser.add_argument(
        "--fps", type=float, default=1.0,
        help="Sampling frames-per-second before dedup. Use 0 for the video's "
             "native frame rate (many more frames).",
    )
    parser.add_argument(
        "--method", choices=("phash", "diff"), default="phash",
        help="Duplicate-detection method: perceptual hash or frame differencing.",
    )
    parser.add_argument(
        "--threshold", type=float, default=None,
        help="Dedup sensitivity. Larger keeps fewer frames. Defaults: "
             f"phash={DEFAULT_THRESHOLDS['phash']} (Hamming bits), "
             f"diff={DEFAULT_THRESHOLDS['diff']} (mean abs diff 0-1).",
    )
    parser.add_argument(
        "--scale-width", type=int, default=None,
        help="Downscale frames to this width (px) before dedup/OCR/output.",
    )
    parser.add_argument(
        "--start", type=float, default=None,
        help="Start offset in seconds.",
    )
    parser.add_argument(
        "--duration", type=float, default=None,
        help="Only process this many seconds after --start.",
    )

    ocr_group = parser.add_mutually_exclusive_group()
    ocr_group.add_argument(
        "--ocr", dest="ocr", action="store_true", default=True,
        help="Run OCR on each kept frame (default).",
    )
    ocr_group.add_argument(
        "--no-ocr", dest="ocr", action="store_false",
        help="Skip OCR entirely.",
    )
    parser.add_argument(
        "--ocr-lang", default="eng",
        help="Tesseract language code(s) for OCR, e.g. 'eng' or 'eng+deu'.",
    )

    parser.add_argument(
        "--keep-raw", action="store_true",
        help="Keep the full extracted frame set under <output>/raw/.",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Verbose logging.",
    )
    parser.add_argument(
        "--version", action="version", version=f"framesleuth {__version__}",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    setup_logging(args.verbose)

    config = PipelineConfig(
        source=args.source,
        output_dir=Path(args.output),
        fps=args.fps,
        method=args.method,
        threshold=args.threshold,
        scale_width=args.scale_width,
        start=args.start,
        duration=args.duration,
        ocr=args.ocr,
        ocr_lang=args.ocr_lang,
        keep_raw=args.keep_raw,
    )

    try:
        result = run_pipeline(config)
    except DependencyError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:  # pragma: no cover
        print("interrupted", file=sys.stderr)
        return 130

    print(
        f"Done: kept {result.kept_count} of {result.raw_count} frames.\n"
        f"  frames:   {result.frames_dir}\n"
        f"  manifest: {result.manifest_path}"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
