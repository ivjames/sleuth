"""Acquire a video file from a YouTube (or other) URL, or accept a local file."""

from __future__ import annotations

from pathlib import Path

from .utils import DependencyError, is_url, log


def acquire_video(source: str, workdir: Path) -> Path:
    """Return a local path to the video for `source`.

    - If `source` is an http(s) URL, download it with yt-dlp into `workdir`.
    - Otherwise treat `source` as a local file path and validate it exists.
    """
    if is_url(source):
        return _download(source, workdir)

    path = Path(source).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"input file not found: {path}")
    if not path.is_file():
        raise ValueError(f"input path is not a file: {path}")
    log.info("using local video: %s", path)
    return path


def _download(url: str, workdir: Path) -> Path:
    """Download `url` with yt-dlp, returning the resulting file path."""
    try:
        import yt_dlp
    except ImportError as exc:  # pragma: no cover - import guard
        raise DependencyError(
            "yt-dlp is required to download URLs. Install it with "
            "'pip install yt-dlp'."
        ) from exc

    workdir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(workdir / "source.%(ext)s")

    # Prefer a single progressive mp4 when available so we don't need to mux;
    # fall back to best video+audio (yt-dlp will merge via ffmpeg).
    ydl_opts = {
        "outtmpl": outtmpl,
        "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
        "merge_output_format": "mp4",
        "noprogress": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": True,
    }

    log.info("downloading %s", url)
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        # requested_downloads carries the true final path (after any merge).
        downloads = info.get("requested_downloads")
        if downloads:
            path = Path(downloads[0]["filepath"])
        else:
            path = Path(ydl.prepare_filename(info))

    if not path.exists():
        # Merge/remux may have changed the extension; find the produced file.
        candidates = sorted(workdir.glob("source.*"))
        if not candidates:
            raise FileNotFoundError(f"yt-dlp produced no file for {url}")
        path = candidates[0]

    log.info("downloaded to %s", path)
    return path
