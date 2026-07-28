"""Strip duplicate / near-duplicate frames.

Two interchangeable strategies, selected with `--method`:

- ``phash``: perceptual hash (pHash). A frame is kept when its Hamming
  distance from the last *kept* frame exceeds ``threshold`` (an integer number
  of differing hash bits). Robust to compression noise and tiny jitter.

- ``diff``: normalized frame differencing. Frames are reduced to a small
  grayscale signature and compared by mean absolute difference in [0, 1]. A
  frame is kept when that difference exceeds ``threshold``. More sensitive to
  small on-screen motion; tune the float threshold to taste.

Both compare against the last *kept* frame (not merely the previous frame), so
a slow drift across many frames still eventually registers as a new shot while
a static screen collapses to a single representative frame.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

# Sensible per-method defaults, used when the CLI threshold is left unset.
DEFAULT_THRESHOLDS = {
    "phash": 6.0,   # bits out of 64
    "diff": 0.02,   # 2% mean absolute difference
}

_DIFF_SIGNATURE_SIZE = 32  # frames downscaled to 32x32 grayscale for `diff`


@dataclass
class KeptFrame:
    """A frame that survived deduplication."""

    index: int          # position in the deduplicated sequence (0-based)
    source_index: int   # 0-based index within the extracted raw frames
    path: Path          # path to the raw frame on disk
    signature: str      # phash hex, or "" for the diff method


class _Deduplicator:
    """Base class: subclasses implement `_distance` and load a signature."""

    def __init__(self, threshold: float):
        self.threshold = threshold
        self._last = None  # last kept signature (type is method-specific)

    def _load(self, path: Path):  # pragma: no cover - overridden
        raise NotImplementedError

    def _distance(self, a, b) -> float:  # pragma: no cover - overridden
        raise NotImplementedError

    def _hex(self, sig) -> str:  # pragma: no cover - overridden
        return ""

    def consider(self, path: Path) -> tuple[bool, str]:
        """Return (keep?, signature_hex) for a candidate frame."""
        sig = self._load(path)
        if self._last is None:
            self._last = sig
            return True, self._hex(sig)
        dist = self._distance(self._last, sig)
        if dist > self.threshold:
            self._last = sig
            return True, self._hex(sig)
        return False, self._hex(sig)


class _PHashDeduplicator(_Deduplicator):
    def __init__(self, threshold: float):
        super().__init__(threshold)
        import imagehash  # local import keeps the dependency optional per-method

        self._imagehash = imagehash

    def _load(self, path: Path):
        with Image.open(path) as im:
            return self._imagehash.phash(im)

    def _distance(self, a, b) -> float:
        return float(a - b)  # imagehash overloads subtraction as Hamming dist

    def _hex(self, sig) -> str:
        return str(sig)


class _DiffDeduplicator(_Deduplicator):
    def _load(self, path: Path):
        with Image.open(path) as im:
            small = im.convert("L").resize(
                (_DIFF_SIGNATURE_SIZE, _DIFF_SIGNATURE_SIZE), Image.BILINEAR
            )
            return np.asarray(small, dtype=np.float32) / 255.0

    def _distance(self, a, b) -> float:
        return float(np.mean(np.abs(a - b)))


def make_deduplicator(method: str, threshold: float) -> _Deduplicator:
    """Construct a deduplicator for `method` ('phash' or 'diff')."""
    if method == "phash":
        return _PHashDeduplicator(threshold)
    if method == "diff":
        return _DiffDeduplicator(threshold)
    raise ValueError(f"unknown dedup method: {method!r} (expected 'phash' or 'diff')")


def dedup_frames(
    frame_paths: list[Path], method: str = "phash", threshold: float | None = None
) -> list[KeptFrame]:
    """Deduplicate an ordered list of frame paths, returning the kept frames."""
    if threshold is None:
        threshold = DEFAULT_THRESHOLDS[method]
    dedup = make_deduplicator(method, threshold)

    kept: list[KeptFrame] = []
    for source_index, path in enumerate(frame_paths):
        keep, sig_hex = dedup.consider(path)
        if keep:
            kept.append(
                KeptFrame(
                    index=len(kept),
                    source_index=source_index,
                    path=path,
                    signature=sig_hex,
                )
            )
    return kept
