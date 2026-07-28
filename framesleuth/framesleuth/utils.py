"""Shared helpers: dependency checks, logging, small formatting utilities."""

from __future__ import annotations

import logging
import shutil
import sys
from urllib.parse import urlparse

log = logging.getLogger("framesleuth")


def setup_logging(verbose: bool = False) -> None:
    """Configure the package logger to write human-readable lines to stderr."""
    level = logging.DEBUG if verbose else logging.INFO
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
    log.handlers[:] = [handler]
    log.setLevel(level)
    log.propagate = False


class DependencyError(RuntimeError):
    """Raised when a required external tool is not available on PATH."""


def require_tool(name: str, hint: str = "") -> str:
    """Return the resolved path to an external binary or raise DependencyError."""
    path = shutil.which(name)
    if path is None:
        msg = f"required tool '{name}' was not found on PATH."
        if hint:
            msg += f" {hint}"
        raise DependencyError(msg)
    return path


def is_url(source: str) -> bool:
    """True if `source` looks like an http(s) URL rather than a local path."""
    parsed = urlparse(source)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def human_bytes(n: int) -> str:
    """Render a byte count as a short human-readable string."""
    step = 1024.0
    value = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < step:
            return f"{value:.1f}{unit}" if unit != "B" else f"{int(value)}{unit}"
        value /= step
    return f"{value:.1f}PB"


def format_timestamp(seconds: float) -> str:
    """Render seconds as HH:MM:SS.mmm for manifest/readability."""
    if seconds < 0:
        seconds = 0.0
    ms = int(round((seconds - int(seconds)) * 1000))
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"
