"""Unit tests for small helpers."""

import unittest

from framesleuth.utils import (
    DependencyError,
    format_timestamp,
    human_bytes,
    is_url,
    require_tool,
)


class UtilsTests(unittest.TestCase):
    def test_is_url(self):
        self.assertTrue(is_url("https://youtu.be/abc"))
        self.assertTrue(is_url("http://example.com/v.mp4"))
        self.assertFalse(is_url("/home/user/clip.mp4"))
        self.assertFalse(is_url("clip.mp4"))
        self.assertFalse(is_url("C:/videos/clip.mp4"))

    def test_format_timestamp(self):
        self.assertEqual(format_timestamp(0), "00:00:00.000")
        self.assertEqual(format_timestamp(65.5), "00:01:05.500")
        self.assertEqual(format_timestamp(3661.25), "01:01:01.250")
        self.assertEqual(format_timestamp(-3), "00:00:00.000")

    def test_human_bytes(self):
        self.assertEqual(human_bytes(512), "512B")
        self.assertEqual(human_bytes(1536), "1.5KB")
        self.assertTrue(human_bytes(5 * 1024 * 1024).endswith("MB"))

    def test_require_tool_missing(self):
        with self.assertRaises(DependencyError):
            require_tool("definitely-not-a-real-binary-xyz")

    def test_require_tool_present(self):
        # `sh` should exist on any POSIX test host.
        self.assertTrue(require_tool("sh"))


if __name__ == "__main__":
    unittest.main()
