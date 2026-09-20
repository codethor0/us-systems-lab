"""Tests for check-no-emoji.py, written before the script.

Emoji in these tests are always built from code points, never typed literally, so this
file passes the very check it tests.
"""

import contextlib
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).with_name("check-no-emoji.py")


def load_module():
    spec = importlib.util.spec_from_file_location("check_no_emoji", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(root, relative, text, encoding="utf-8"):
    path = Path(root) / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding=encoding)
    return path


def run_main(root):
    module = load_module()
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = module.main([str(root)])
    return code, out.getvalue(), err.getvalue()


def run_cli(*args, cwd=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        cwd=cwd,
    )


# Every code point the checker must flag, with the range it belongs to. The first and last
# code point of each range are included, because off-by-one errors live at the edges.
FLAGGED = [
    0x1F000, 0x1F600, 0x1F680, 0x1F1FA, 0x1F3FB, 0x1F9E0, 0x1FAFF,
    0x2600, 0x2605, 0x26A0, 0x2705, 0x2714, 0x2728, 0x274C, 0x27BF,
    0x2B00, 0x2B50, 0x2BFF,
    0x2194, 0x2199, 0x21A9, 0x21AA,
    0x231A, 0x231B, 0x2328, 0x23CF, 0x23E9, 0x23F3, 0x23F8, 0x23FA,
    0x24C2,
    0x25AA, 0x25AB, 0x25B6, 0x25C0, 0x25FB, 0x25FE,
    0x2934, 0x2935,
    0x3030, 0x303D, 0x3297, 0x3299,
    0x200D, 0xFE0F, 0x20E3,
    0xE0020, 0xE0067, 0xE007F,
]  # fmt: skip

# Characters one step outside a flagged range, and ordinary typography. None may be flagged.
ALLOWED = [
    0x1EFFF, 0x1FB00,
    0x25FF, 0x2C00, 0x27C0, 0x25FA,
    0x2192, 0x2190, 0x2191, 0x2193, 0x219A, 0x21A8, 0x21AB,
    0x2933, 0x2936,
    0x231C, 0x2329, 0x23CE, 0x23D0, 0x23F4, 0x23F7,
    0x24C1, 0x24C3,
    0x25A9, 0x25AC, 0x25B7, 0x25BF, 0x25C1,
    0x3031, 0x303C, 0x303E, 0x3296, 0x3298,
    0x200C, 0xFE0E, 0x20E2, 0x20E4,
    0xE001F, 0xE0080,
    0x00A9, 0x00AE, 0x2122,
    0x00E9, 0x00F1, 0x65E5, 0x672C, 0x8A9E,
    0x2014, 0x2013, 0x2022, 0x2026, 0x2264, 0x2265, 0x00D7, 0x00F7, 0x00B1, 0x00B0,
    0x20AC, 0x00A3, 0x221E, 0x2211, 0x2500, 0x2502, 0x25A0,
]  # fmt: skip


class FindHits(unittest.TestCase):
    def test_reports_line_column_and_code_point(self):
        module = load_module()
        text = "first\nsecond " + chr(0x1F680) + " end\nthird"
        self.assertEqual(module.find_hits(text), [(2, 8, 0x1F680)])

    def test_reports_every_hit_on_a_line_in_order(self):
        module = load_module()
        text = chr(0x2705) + "a" + chr(0x1F600) + chr(0x274C)
        self.assertEqual(
            module.find_hits(text), [(1, 1, 0x2705), (1, 3, 0x1F600), (1, 4, 0x274C)]
        )

    def test_text_with_no_emoji_has_no_hits(self):
        module = load_module()
        self.assertEqual(module.find_hits("plain ascii\nand caf" + chr(0xE9)), [])

    def test_every_flagged_code_point_is_a_hit(self):
        module = load_module()
        for code_point in FLAGGED:
            with self.subTest(code_point=f"U+{code_point:04X}"):
                self.assertEqual(module.find_hits("a" + chr(code_point) + "b"), [(1, 2, code_point)])

    def test_no_allowed_code_point_is_a_hit(self):
        module = load_module()
        for code_point in ALLOWED:
            with self.subTest(code_point=f"U+{code_point:04X}"):
                self.assertEqual(module.find_hits("a" + chr(code_point) + "b"), [])

    def test_a_multi_code_point_emoji_reports_each_part(self):
        module = load_module()
        flag = chr(0x1F1FA) + chr(0x1F1F8)
        self.assertEqual([h[2] for h in module.find_hits(flag)], [0x1F1FA, 0x1F1F8])

    def test_form_feed_and_unicode_separators_do_not_start_a_new_line(self):
        # Editors and grep count lines by newline only. str.splitlines would also break on
        # form feed and on U+2028, which would put the emoji on line 3 instead of line 1.
        module = load_module()
        text = "a\x0c" + chr(0x2028) + "b" + chr(0x1F680)
        self.assertEqual(module.find_hits(text), [(1, 5, 0x1F680)])

    def test_carriage_returns_do_not_shift_line_numbers(self):
        module = load_module()
        text = "one\r\ntwo\r\n" + chr(0x1F680)
        self.assertEqual(module.find_hits(text), [(3, 1, 0x1F680)])


class ScanTree(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def test_clean_tree_exits_zero_and_says_how_many_files_were_scanned(self):
        write(self.root, "a.md", "hello")
        write(self.root, "src/b.ts", "export const x = 1;")
        code, out, err = run_main(self.root)
        self.assertEqual((code, err), (0, ""))
        self.assertIn("scanned 2 files", out)
        self.assertIn("0 hits", out)

    def test_a_hit_exits_one_and_names_file_line_column_and_code_point(self):
        write(self.root, "docs/readme.md", "ok\nbad " + chr(0x1F680) + "\n")
        code, out, _ = run_main(self.root)
        self.assertEqual(code, 1)
        self.assertIn("docs/readme.md:2:5: U+1F680", out)
        self.assertIn("1 hits", out)

    def test_every_hit_in_every_file_is_reported_in_sorted_path_order(self):
        write(self.root, "z.md", chr(0x2705))
        write(self.root, "a.md", chr(0x2714))
        code, out, _ = run_main(self.root)
        lines = [line for line in out.splitlines() if ": U+" in line]
        self.assertEqual(code, 1)
        self.assertEqual([line.split(":")[0] for line in lines], ["a.md", "z.md"])

    def test_sorts_hits_by_path_across_directories_and_not_in_walk_order(self):
        # A walk visits the root's own files before its subdirectories, so b.md comes
        # before a/x.md unless the hits are sorted by path afterwards.
        write(self.root, "b.md", chr(0x1F680))
        write(self.root, "a/x.md", chr(0x1F680))
        _, out, _ = run_main(self.root)
        lines = [line for line in out.splitlines() if ": U+" in line]
        self.assertEqual([line.split(":")[0] for line in lines], ["a/x.md", "b.md"])

    def test_scans_files_of_every_extension_including_none(self):
        write(self.root, "Makefile", chr(0x1F680))
        write(self.root, "notes.txt", chr(0x1F680))
        write(self.root, "data.bin.json", chr(0x1F680))
        _, out, _ = run_main(self.root)
        self.assertIn("3 hits", out)

    def test_scans_hidden_directories(self):
        write(self.root, ".github/workflows/ci.yml", "name: " + chr(0x2705))
        code, out, _ = run_main(self.root)
        self.assertEqual(code, 1)
        self.assertIn(".github/workflows/ci.yml:1:7", out)

    def test_flags_an_emoji_in_a_file_name(self):
        write(self.root, "notes-" + chr(0x1F680) + ".md", "clean contents")
        code, out, _ = run_main(self.root)
        self.assertEqual(code, 1)
        self.assertIn("(file name)", out)

    def test_flags_an_emoji_in_a_directory_name(self):
        write(self.root, "dir-" + chr(0x2705) + "/clean.md", "clean contents")
        code, out, _ = run_main(self.root)
        self.assertEqual(code, 1)
        self.assertIn("(directory name)", out)

    def test_skips_node_modules_git_dist_and_coverage_at_any_depth(self):
        for directory in ["node_modules", ".git", "dist", "coverage", "src/node_modules"]:
            write(self.root, f"{directory}/x.js", chr(0x1F680))
        write(self.root, "kept.md", "clean")
        code, out, _ = run_main(self.root)
        self.assertEqual(code, 0)
        self.assertIn("scanned 1 files", out)

    def test_a_directory_that_only_starts_with_a_skipped_name_is_still_scanned(self):
        write(self.root, "src/node_modules_notes/z.md", chr(0x1F680))
        write(self.root, "distribution/y.md", chr(0x1F680))
        _, out, _ = run_main(self.root)
        self.assertIn("2 hits", out)

    def test_does_not_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as outside:
            target = write(outside, "secret.md", chr(0x1F680))
            write(self.root, "kept.md", "clean")
            try:
                os.symlink(target, self.root / "link.md")
                os.symlink(outside, self.root / "linkdir")
            except OSError:
                self.skipTest("symlinks are not available here")
            code, out, _ = run_main(self.root)
        self.assertEqual(code, 0)
        self.assertIn("scanned 1 files", out)

    def test_a_file_that_is_not_utf8_is_skipped_and_counted_and_does_not_fail(self):
        write(self.root, "kept.md", "clean")
        (self.root / "image.png").write_bytes(b"\x89PNG\r\n\x1a\n\xff\xfe\x00\x01")
        code, out, _ = run_main(self.root)
        self.assertEqual(code, 0)
        self.assertIn("scanned 1 files", out)
        self.assertIn("1 skipped", out)

    def test_an_empty_tree_is_an_error_and_never_a_clean_pass(self):
        code, out, err = run_main(self.root)
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertIn("scanned 0 files", err)

    def test_a_tree_holding_only_skipped_files_is_also_an_error(self):
        write(self.root, "node_modules/x.js", "code")
        code, _, err = run_main(self.root)
        self.assertEqual(code, 2)
        self.assertIn("scanned 0 files", err)

    def test_an_unreadable_file_is_an_error_with_a_message_and_not_a_traceback(self):
        write(self.root, "a.md", "clean")
        module = load_module()
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(Path, "read_bytes", side_effect=PermissionError(13, "denied")):
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = module.main([str(self.root)])
        self.assertEqual(code, 2)
        self.assertIn("cannot read", err.getvalue())

    def test_a_missing_root_is_an_error(self):
        code, _, err = run_main(self.root / "does-not-exist")
        self.assertEqual(code, 2)
        self.assertIn("not a directory", err)

    def test_a_root_that_is_a_file_is_an_error(self):
        path = write(self.root, "file.md", "clean")
        code, _, err = run_main(path)
        self.assertEqual(code, 2)
        self.assertIn("not a directory", err)


class CommandLine(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def test_exit_zero_on_a_clean_tree(self):
        write(self.root, "a.md", "clean")
        result = run_cli(str(self.root))
        self.assertEqual(result.returncode, 0)
        self.assertIn("scanned 1 files", result.stdout)

    def test_exit_one_and_hits_on_stdout(self):
        write(self.root, "a.md", chr(0x1F680))
        result = run_cli(str(self.root))
        self.assertEqual(result.returncode, 1)
        self.assertIn("a.md:1:1: U+1F680", result.stdout)

    def test_exit_two_and_message_on_stderr_for_a_missing_root(self):
        result = run_cli(str(self.root / "nope"))
        self.assertEqual(result.returncode, 2)
        self.assertIn("not a directory", result.stderr)

    def test_the_root_defaults_to_the_current_directory(self):
        write(self.root, "a.md", chr(0x2705))
        result = run_cli(cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn("a.md:1:1: U+2705", result.stdout)

    def test_more_than_one_argument_is_an_error(self):
        result = run_cli(str(self.root), str(self.root))
        self.assertEqual(result.returncode, 2)
        self.assertIn("usage", result.stderr)


class TheRepoItself(unittest.TestCase):
    def test_this_test_file_and_the_script_contain_no_literal_emoji(self):
        module = load_module()
        for path in (Path(__file__), SCRIPT):
            with self.subTest(path=path.name):
                self.assertEqual(module.find_hits(path.read_text(encoding="utf-8")), [])


if __name__ == "__main__":
    unittest.main()
