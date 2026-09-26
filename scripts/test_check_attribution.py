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


def commit(root, message, author="tester@example.com", committer=None):
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "A", "GIT_AUTHOR_EMAIL": author,
        "GIT_COMMITTER_NAME": "C", "GIT_COMMITTER_EMAIL": committer or author,
    }
    subprocess.run(
        ["git", "-C", str(root), "-c", "commit.gpgsign=false",
         "commit", "-q", "--allow-empty", "-m", message],
        check=True, capture_output=True, env=env,
    )


def repo_with(messages, allowed="tester@example.com\n"):
    root = Path(tempfile.mkdtemp())
    git(root, "init", "-q")
    if allowed is not None:
        (root / ".github").mkdir()
        (root / ".github" / "allowed-authors").write_text("# owner\n" + allowed)
    for message in messages:
        commit(root, message)
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
        (shallow / ".github").mkdir()
        (shallow / ".github" / "allowed-authors").write_text("tester@example.com\n")
        code, _, err = run_main(shallow)
        self.assertEqual(code, 2)
        self.assertIn("shallow", err)

    def test_not_a_repository_is_an_error_not_a_pass(self):
        root = Path(tempfile.mkdtemp())
        (root / ".github").mkdir()
        (root / ".github" / "allowed-authors").write_text("tester@example.com\n")
        code, _, err = run_main(root)
        self.assertEqual(code, 2)
        self.assertIn("cannot read git history", err)

    def test_missing_or_empty_allowed_authors_is_an_error(self):
        self.assertEqual(run_main(repo_with(["x"], allowed=None))[0], 2)
        self.assertEqual(run_main(repo_with(["x"], allowed="# only a comment\n"))[0], 2)

    def test_a_bot_author_fails(self):
        root = repo_with(["feat: ok"])
        commit(root, "chore(deps): bump", author="49699333+dependabot[bot]@users.noreply.github.com")
        code, out, _ = run_main(root)
        self.assertEqual(code, 1)
        self.assertIn("is not in .github/allowed-authors", out)

    def test_github_merge_identity_is_an_allowed_committer_but_not_an_author(self):
        root = repo_with(["feat: ok"])
        commit(root, "squash merge", committer="noreply@github.com")
        self.assertEqual(run_main(root)[0], 0)
        commit(root, "web edit", author="noreply@github.com")
        self.assertEqual(run_main(root)[0], 1)

    def test_an_unlisted_committer_fails(self):
        root = repo_with(["feat: ok"])
        commit(root, "rebased elsewhere", committer="someone@example.com")
        code, out, _ = run_main(root)
        self.assertEqual(code, 1)
        self.assertIn("committer someone@example.com is not allowed", out)

    def test_allowed_addresses_match_case_insensitively(self):
        root = repo_with(["feat: ok"], allowed="Tester@Example.com\n")
        self.assertEqual(run_main(root)[0], 0)

    def test_merge_commits_skip_the_author_check_but_not_the_message_check(self):
        root = repo_with(["base"])
        git(root, "checkout", "-q", "-b", "side")
        commit(root, "side work")
        git(root, "checkout", "-q", "-")
        env = {**os.environ, "GIT_AUTHOR_EMAIL": "noreply@github.com",
               "GIT_COMMITTER_EMAIL": "noreply@github.com"}
        subprocess.run(["git", "-C", str(root), "-c", "commit.gpgsign=false", "merge", "-q",
                        "--no-ff", "-m", "Merge side", "side"], check=True, capture_output=True, env=env)
        self.assertEqual(run_main(root)[0], 0)


if __name__ == "__main__":
    unittest.main()
