"""End-to-end pipeline test using an ffmpeg-generated synthetic video.

Skips automatically when ffmpeg/ffprobe are not installed, so the pure-Python
unit tests still run in a minimal environment.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from framesleuth.extract import probe_video
from framesleuth.pipeline import PipelineConfig, run_pipeline

HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _make_test_video(path: Path) -> None:
    """6s video of three distinct static test patterns (2s each).

    We use *textured* patterns rather than solid colors: a perceptual hash keys
    off frequency structure, so a flat color frame is a degenerate input. These
    three lavfi patterns are static within each segment and far apart in phash
    space, giving exactly three 'shots'.
    """
    filter_complex = (
        "smptebars=s=320x240:d=2:r=10[a];"
        "smptehdbars=s=320x240:d=2:r=10[b];"
        "yuvtestsrc=s=320x240:d=2:r=10[c];"
        "[a][b][c]concat=n=3:v=1:a=0[v]"
    )
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-filter_complex", filter_complex, "-map", "[v]",
        "-pix_fmt", "yuv420p", str(path),
    ]
    subprocess.run(cmd, check=True)


@unittest.skipUnless(HAVE_FFMPEG, "ffmpeg/ffprobe not installed")
class PipelineTests(unittest.TestCase):
    def test_probe_and_dedup_to_three_shots(self):
        with TemporaryDirectory() as d:
            tmp = Path(d)
            video = tmp / "clip.mp4"
            _make_test_video(video)

            info = probe_video(video)
            self.assertEqual((info.width, info.height), (320, 240))
            self.assertAlmostEqual(info.duration, 6.0, delta=0.6)

            out = tmp / "out"
            config = PipelineConfig(
                source=str(video),
                output_dir=out,
                fps=2.0,
                method="phash",
                ocr=False,  # keep this test independent of tesseract
            )
            result = run_pipeline(config)

            # Three solid-color segments collapse to three kept frames.
            self.assertEqual(result.kept_count, 3)
            self.assertGreater(result.raw_count, result.kept_count)

            pngs = sorted((out / "frames").glob("frame_*.png"))
            self.assertEqual(len(pngs), 3)

            manifest = json.loads((out / "manifest.json").read_text())
            self.assertEqual(manifest["kept_frame_count"], 3)
            self.assertEqual(len(manifest["frames"]), 3)
            self.assertEqual(manifest["params"]["method"], "phash")
            # Timestamps should be monotonically increasing.
            ts = [f["timestamp_seconds"] for f in manifest["frames"]]
            self.assertEqual(ts, sorted(ts))

    def test_diff_method_also_finds_three(self):
        with TemporaryDirectory() as d:
            tmp = Path(d)
            video = tmp / "clip.mp4"
            _make_test_video(video)
            out = tmp / "out"
            result = run_pipeline(PipelineConfig(
                source=str(video), output_dir=out, fps=2.0,
                method="diff", ocr=False,
            ))
            self.assertEqual(result.kept_count, 3)

    def test_keep_raw_persists_frames(self):
        with TemporaryDirectory() as d:
            tmp = Path(d)
            video = tmp / "clip.mp4"
            _make_test_video(video)
            out = tmp / "out"
            run_pipeline(PipelineConfig(
                source=str(video), output_dir=out, fps=2.0,
                method="phash", ocr=False, keep_raw=True,
            ))
            raw = list((out / "raw" / "frames_raw").glob("raw_*.png"))
            self.assertGreater(len(raw), 3)


if __name__ == "__main__":
    unittest.main()
