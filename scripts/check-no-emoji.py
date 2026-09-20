#!/usr/bin/env python3
"""Fail if any emoji appears in the repository, in file contents or in file names.

Usage: check-no-emoji.py [ROOT]      (ROOT defaults to the current directory)

Exit codes:
  0  scanned at least one file and found no emoji
  1  found at least one emoji
  2  could not run: bad arguments, a missing root, an unreadable file, or no files
     scanned. A scan that examined nothing is never reported as clean.

Every extension is scanned, hidden directories included. Not scanned: the directories in
SKIP_DIRS at any depth, symbolic links (their names are still checked), and files that
are not valid UTF-8, which are counted and listed as skipped.

The ranges below are explicit so that they can be reviewed. Ordinary typography stays
allowed: plain arrows, the copyright and trademark signs, dashes, bullets, and accented
or CJK letters. The source uses escapes and never a literal emoji, so this file passes
its own check.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# (first, last, name), inclusive. Anything Unicode gives emoji presentation, plus the
# joiners and selectors that build multi-code-point emoji.
RANGES = [
    (0x1F000, 0x1FAFF, "pictographs, emoticons, symbols and flags"),
    (0x2600, 0x27BF, "miscellaneous symbols and dingbats"),
    (0x2B00, 0x2BFF, "miscellaneous symbols and arrows"),
    (0x2194, 0x2199, "emoji arrows"),
    (0x21A9, 0x21AA, "emoji arrows"),
    (0x231A, 0x231B, "watch and hourglass"),
    (0x2328, 0x2328, "keyboard"),
    (0x23CF, 0x23CF, "eject"),
    (0x23E9, 0x23F3, "media controls and timers"),
    (0x23F8, 0x23FA, "media controls"),
    (0x24C2, 0x24C2, "circled M"),
    (0x25AA, 0x25AB, "small squares"),
    (0x25B6, 0x25B6, "play button"),
    (0x25C0, 0x25C0, "reverse button"),
    (0x25FB, 0x25FE, "medium squares"),
    (0x2934, 0x2935, "curved arrows"),
    (0x3030, 0x3030, "wavy dash"),
    (0x303D, 0x303D, "part alternation mark"),
    (0x3297, 0x3297, "circled ideograph congratulation"),
    (0x3299, 0x3299, "circled ideograph secret"),
    (0x200D, 0x200D, "zero width joiner"),
    (0xFE0F, 0xFE0F, "emoji variation selector"),
    (0x20E3, 0x20E3, "combining keycap"),
    (0xE0020, 0xE007F, "tag characters"),
]

# Directory names skipped at any depth. Matched exactly, so "distribution" is scanned.
SKIP_DIRS = frozenset({"node_modules", ".git", "dist", "coverage", ".wrangler"})

# No range starts below this, so every earlier character is rejected without a lookup.
LOWEST_FLAGGED = min(first for first, _, _ in RANGES)


def range_name(code_point: int) -> str | None:
    """The name of the range holding the code point, or None if it is allowed."""
    if code_point < LOWEST_FLAGGED:
        return None
    for first, last, name in RANGES:
        if first <= code_point <= last:
            return name
    return None


def find_hits(text: str) -> list[tuple[int, int, int]]:
    """Every flagged character as (line, column, code point), both 1-based."""
    hits = []
    for line_number, line in enumerate(text.split("\n"), start=1):
        for column, character in enumerate(line, start=1):
            if range_name(ord(character)) is not None:
                hits.append((line_number, column, ord(character)))
    return hits


def scan(root: Path) -> tuple[list[tuple[str, int, int, int, str]], int, list[str]]:
    """Returns (hits, files scanned, skipped paths).

    A hit is (relative path, line, column, code point, kind), where kind is "content",
    "file name" or "directory name". Name hits use line and column 0.
    """
    hits: list[tuple[str, int, int, int, str]] = []
    skipped: list[str] = []
    scanned = 0

    def add_name_hits(relative: str, name: str, kind: str) -> None:
        for _, _, code_point in find_hits(name):
            hits.append((relative, 0, 0, code_point, kind))

    for current, directories, files in os.walk(root):
        directories[:] = sorted(d for d in directories if d not in SKIP_DIRS)
        base = Path(current)
        for directory in directories:
            add_name_hits((base / directory).relative_to(root).as_posix(), directory, "directory name")
        for name in sorted(files):
            path = base / name
            relative = path.relative_to(root).as_posix()
            add_name_hits(relative, name, "file name")
            if path.is_symlink():
                continue
            try:
                text = path.read_bytes().decode("utf-8")
            except UnicodeDecodeError:
                skipped.append(relative)
                continue
            scanned += 1
            for line, column, code_point in find_hits(text):
                hits.append((relative, line, column, code_point, "content"))

    hits.sort(key=lambda hit: (hit[0], hit[4], hit[1], hit[2]))
    return hits, scanned, skipped


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) > 1:
        print("usage: check-no-emoji.py [ROOT]", file=sys.stderr)
        return 2
    root = Path(args[0]) if args else Path(".")
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 2

    try:
        hits, scanned, skipped = scan(root)
    except OSError as error:
        print(f"error: cannot read {error.filename}: {error.strerror}", file=sys.stderr)
        return 2
    if scanned == 0:
        print("error: scanned 0 files; refusing to report a clean result", file=sys.stderr)
        return 2

    for relative, line, column, code_point, kind in hits:
        name = range_name(code_point)
        if kind == "content":
            print(f"{relative}:{line}:{column}: U+{code_point:04X} {name}")
        else:
            print(f"{relative}: U+{code_point:04X} {name} ({kind})")
    for relative in skipped:
        print(f"skipped (not UTF-8 text): {relative}")
    print(f"scanned {scanned} files, {len(skipped)} skipped (not UTF-8 text), {len(hits)} hits")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
