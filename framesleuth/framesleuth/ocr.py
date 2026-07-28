"""OCR kept frames with Tesseract via pytesseract.

We lightly preprocess each frame (grayscale + upscale) because on-screen game
text — HUD counters, dialogue, score — is often small relative to the frame.
"""

from __future__ import annotations

from pathlib import Path

from .utils import DependencyError, log, require_tool


def ensure_tesseract() -> None:
    """Raise DependencyError if the tesseract binary is unavailable."""
    require_tool(
        "tesseract",
        "Install it (e.g. 'apt-get install tesseract-ocr') or run with --no-ocr.",
    )


def ocr_image(path: Path, lang: str = "eng", upscale: float = 2.0) -> str:
    """Return the text Tesseract reads from the image at `path`.

    Never raises on OCR content problems: an unreadable/blank frame yields "".
    A missing tesseract binary raises DependencyError (a setup problem).
    """
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - import guard
        raise DependencyError(
            "pytesseract and Pillow are required for OCR. "
            "Install them or run with --no-ocr."
        ) from exc

    ensure_tesseract()

    try:
        with Image.open(path) as im:
            gray = im.convert("L")
            if upscale and upscale > 1.0:
                new_size = (int(gray.width * upscale), int(gray.height * upscale))
                gray = gray.resize(new_size, Image.LANCZOS)
            text = pytesseract.image_to_string(gray, lang=lang)
    except DependencyError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("OCR failed for %s: %s", path.name, exc)
        return ""

    return text.strip()
