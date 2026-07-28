"""Unit tests for the deduplication strategies (no ffmpeg/network needed)."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw

from framesleuth.dedup import DEFAULT_THRESHOLDS, dedup_frames, make_deduplicator

# A perceptual hash keys off frequency structure, so a flat color frame is a
# degenerate input (all solids hash alike). Tests therefore use *textured*
# patterns — the same kind of structured content real gameplay frames have.
SIZE = (96, 96)


def _pattern(kind: str, path: Path) -> Path:
    im = Image.new("RGB", SIZE, (255, 255, 255))
    d = ImageDraw.Draw(im)
    if kind == "A":
        d.rectangle((6, 6, 40, 40), fill=(0, 0, 0))
    elif kind == "B":
        d.rectangle((54, 54, 90, 90), fill=(0, 0, 0))
    elif kind == "C":
        d.ellipse((24, 24, 72, 72), fill=(0, 0, 0))
    im.save(path)
    return path


class DedupTests(unittest.TestCase):
    def _write_sequence(self, tmp: Path, kinds) -> list[Path]:
        return [_pattern(k, tmp / f"raw_{i:04d}.png") for i, k in enumerate(kinds)]

    def test_collapses_identical_run(self):
        with TemporaryDirectory() as d:
            tmp = Path(d)
            # 5 identical 'A' frames, then 5 identical 'B' frames.
            kinds = ["A"] * 5 + ["B"] * 5
            frames = self._write_sequence(tmp, kinds)
            for method in ("phash", "diff"):
                kept = dedup_frames(frames, method=method)
                self.assertEqual(
                    [k.source_index for k in kept], [0, 5],
                    f"method={method} should keep one frame per distinct run",
                )

    def test_distinct_frames_all_kept(self):
        with TemporaryDirectory() as d:
            tmp = Path(d)
            kinds = ["A", "B", "A", "B"]
            frames = self._write_sequence(tmp, kinds)
            for method in ("phash", "diff"):
                kept = dedup_frames(frames, method=method)
                self.assertEqual(
                    len(kept), 4, f"method={method} should keep all alternating frames"
                )

    def test_kept_indices_are_sequential(self):
        with TemporaryDirectory() as d:
            tmp = Path(d)
            kinds = ["A"] * 3 + ["B"] * 3 + ["C"] * 3
            frames = self._write_sequence(tmp, kinds)
            for method in ("phash", "diff"):
                kept = dedup_frames(frames, method=method)
                self.assertEqual([k.index for k in kept], list(range(len(kept))))
                self.assertEqual([k.source_index for k in kept], [0, 3, 6])

    def test_first_frame_always_kept(self):
        with TemporaryDirectory() as d:
            tmp = Path(d)
            frames = self._write_sequence(tmp, ["A"])
            for method in ("phash", "diff"):
                kept = dedup_frames(frames, method=method)
                self.assertEqual(len(kept), 1)

    def test_diff_threshold_controls_sensitivity(self):
        with TemporaryDirectory() as d:
            tmp = Path(d)
            # Same two distinct patterns; a very loose threshold collapses them,
            # a tight one keeps both.
            frames = self._write_sequence(tmp, ["A", "B"])
            loose = dedup_frames(frames, method="diff", threshold=0.9)
            tight = dedup_frames(frames, method="diff", threshold=0.001)
            self.assertEqual(len(loose), 1)
            self.assertEqual(len(tight), 2)

    def test_unknown_method_raises(self):
        with self.assertRaises(ValueError):
            make_deduplicator("nope", 1.0)

    def test_defaults_present(self):
        self.assertIn("phash", DEFAULT_THRESHOLDS)
        self.assertIn("diff", DEFAULT_THRESHOLDS)


if __name__ == "__main__":
    unittest.main()
