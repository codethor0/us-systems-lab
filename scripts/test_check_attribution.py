"""Tests for check-attribution.py, run against real temporary git repositories."""

import contextlib
import importlib.util
import io
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).with_name("check-attribution.py")


def load_module():
    spec = importlib.util.spec_from_file_location("check_attribution", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def git(root, *args):
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


def repo_with(messages):
    root = Path(tempfile.mkdtemp())
    git(root, "init", "-q")
    for message in messages:
        git(
            root,
            "-c", "user.name=Tester", "-c", "user.email=tester@example.com",
            "-c", "commit.gpgsign=false",
            "commit", "-q", "--allow-empty", "-m", message,
        )
    return root


def run_main(root, env=None):
    module = load_module()
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.dict(os.environ, env or {}, clear=False):
        for name in ("PR_TITLE", "PR_BODY"):
            if not env or name not in env:
                os.environ.pop(name, None)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = module.main([str(root)])
    return code, out.getvalue(), err.getvalue()


class AttributionCheckTest(unittest.TestCase):
    def test_clean_history_passes(self):
        root = repo_with(["feat: first", "fix: second\n\nBody text."])
        code, out, _ = run_main(root)
        self.assertEqual(code, 0)
        self.assertIn("checked 2 commits, 0 hits", out)

    def test_any_co_author_trailer_fails_whatever_the_name(self):
        root = repo_with(["feat: ok", "fix: x\n\nCo-authored-by: Someone <someone@example.com>"])
        code, out, _ = run_main(root)
        self.assertEqual(code, 1)
        self.assertIn("co-author trailer", out)

    def test_trailer_is_matched_case_insensitively_and_with_indent(self):
        root = repo_with(["fix: x\n\n  CO-AUTHORED-BY : Someone <a@b.c>"])
        self.assertEqual(run_main(root)[0], 1)

    def test_generated_with_line_fails(self):
        root = repo_with(["docs: y\n\nGenerated with Some Tool"])
        code, out, _ = run_main(root)
        self.assertEqual(code, 1)
        self.assertIn("generated-with line", out)

    def test_third_party_noreply_address_fails_but_github_user_noreply_passes(self):
        self.assertEqual(run_main(repo_with(["x\n\nnoreply@vendor.example"]))[0], 1)
        ok = repo_with(["x\n\nSigned-off-by: A <1+a@users.noreply.github.com>"])
        self.assertEqual(run_main(ok)[0], 0)

    def test_ordinary_words_are_not_flagged(self):
        root = repo_with(["feat: authored the co-ordinate code; regenerated the lockfile"])
        self.assertEqual(run_main(root)[0], 0)

    def test_pull_request_title_and_body_are_checked(self):
        root = repo_with(["feat: ok"])
        code, out, _ = run_main(root, {"PR_TITLE": "Add x", "PR_BODY": "Text\n\nGenerated with X"})
        self.assertEqual(code, 1)
        self.assertIn("pr body: generated-with line", out)

    def test_shallow_clone_is_refused(self):
        source = repo_with(["one", "two"])
        shallow = Path(tempfile.mkdtemp()) / "shallow"
        subprocess.run(
            ["git", "clone", "-q", "--depth", "1", f"file://{source}", str(shallow)],
            check=True, capture_output=True,
        )
        code, _, err = run_main(shallow)
        self.assertEqual(code, 2)
        self.assertIn("shallow", err)

    def test_not_a_repository_is_an_error_not_a_pass(self):
        code, _, err = run_main(Path(tempfile.mkdtemp()))
        self.assertEqual(code, 2)
        self.assertIn("cannot read git history", err)


if __name__ == "__main__":
    unittest.main()
