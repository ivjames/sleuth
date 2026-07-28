"""OCR test. Skips automatically when the tesseract binary is unavailable."""

import shutil
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw

from framesleuth.ocr import ocr_image

HAVE_TESSERACT = shutil.which("tesseract") is not None


@unittest.skipUnless(HAVE_TESSERACT, "tesseract not installed")
class OcrTests(unittest.TestCase):
    def test_reads_rendered_text(self):
        with TemporaryDirectory() as d:
            path = Path(d) / "text.png"
            img = Image.new("RGB", (320, 90), (255, 255, 255))
            draw = ImageDraw.Draw(img)
            # Default PIL bitmap font; large enough for reliable OCR.
            draw.text((10, 30), "SCORE 1234", fill=(0, 0, 0))
            img.save(path)

            text = ocr_image(path)
            self.assertIn("SCORE", text.upper())

    def test_blank_frame_returns_empty(self):
        with TemporaryDirectory() as d:
            path = Path(d) / "blank.png"
            Image.new("RGB", (200, 80), (0, 0, 0)).save(path)
            self.assertEqual(ocr_image(path), "")


if __name__ == "__main__":
    unittest.main()
