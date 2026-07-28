"""framesleuth — turn gameplay video into a deduplicated PNG frame sequence.

Pipeline: acquire (YouTube URL or local file) -> extract frames with ffmpeg
-> strip duplicate/near-duplicate frames -> optionally OCR each kept frame ->
write a manifest describing every kept shot.
"""

__version__ = "0.1.0"

__all__ = ["__version__"]
