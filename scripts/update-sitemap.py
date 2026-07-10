#!/usr/bin/env python3
"""Refresh <lastmod> in sitemap.xml from git history.

For every <url> entry, sets lastmod to the file's last commit date, or to
today's date when the file has uncommitted changes. Run from anywhere:

    python3 scripts/update-sitemap.py
"""
import pathlib, re, subprocess, sys
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITEMAP = ROOT / "sitemap.xml"
DOMAIN = "https://fundukgames.com"


def url_to_file(loc: str) -> pathlib.Path:
    path = loc.removeprefix(DOMAIN)
    if path.endswith("/"):
        path += "index.html"
    return ROOT / path.lstrip("/")


def main() -> int:
    dirty = {
        line[3:].strip()
        for line in subprocess.run(
            ["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True
        ).stdout.splitlines()
    }
    text = SITEMAP.read_text(encoding="utf-8")
    today = date.today().isoformat()
    changed = 0

    def repl(m: re.Match) -> str:
        nonlocal changed
        loc, old = m.group(1), m.group(2)
        f = url_to_file(loc)
        rel = str(f.relative_to(ROOT))
        if not f.exists():
            print(f"warn: {rel} missing on disk, keeping {old}", file=sys.stderr)
            return m.group(0)
        if rel in dirty:
            new = today
        else:
            new = subprocess.run(
                ["git", "log", "-1", "--format=%cs", "--", rel],
                cwd=ROOT, capture_output=True, text=True,
            ).stdout.strip() or old
        if new != old:
            changed += 1
        return m.group(0).replace(f"<lastmod>{old}</lastmod>", f"<lastmod>{new}</lastmod>")

    text = re.sub(
        r"<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", repl, text
    )
    SITEMAP.write_text(text, encoding="utf-8")
    print(f"updated {changed} lastmod entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
