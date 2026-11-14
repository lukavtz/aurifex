"""Print current official Telegram Bot API documentation as compact Markdown.

Use before relying on remembered method names, fields, limits or versions.
Read-only: sends HTTPS GET requests only to core.telegram.org, never calls the
Bot API, needs no token and stores nothing unless --cache-dir is given.

Exit codes: 0 printed, 1 page/section/match not found, 2 usage error,
3 network unavailable (report the fact as unverified, do not guess).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://core.telegram.org"
PAGES = {
    "api": "/bots/api.md",
    "changelog": "/bots/api-changelog.md",
    "features": "/bots/features.md",
    "faq": "/bots/faq.md",
    "formatting": "/bots/api/formatting.md",
    "rich-messages": "/bots/api/rich-messages.md",
    "webapps": "/bots/webapps.md",
    "payments-stars": "/bots/payments-stars.md",
    "payments": "/bots/payments.md",
    "serverless": "/bots/serverless.md",
}
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,80}$")
PATH_RE = re.compile(r"^/bots/[A-Za-z0-9_./-]{1,120}\.md$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
LINK_RE = re.compile(r"\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*\)")
TIMEOUT = 20


class NotFound(Exception):
    pass


class Offline(Exception):
    pass


def resolve(kind: str, name: str) -> str:
    """Return a site-relative markdown path for a method, type or page key."""
    if kind in {"method", "type"}:
        if not NAME_RE.fullmatch(name):
            raise ValueError("Use a Bot API identifier such as sendMessage or InlineKeyboardButton.")
        folder = "methods" if kind == "method" else "types"
        return f"/bots/api/{folder}/{name.lower()}.md"
    if kind == "page":
        if name in PAGES:
            return PAGES[name]
        if PATH_RE.fullmatch(name) and ".." not in name:
            return name
        raise ValueError(f"Unknown page. Use one of: {', '.join(sorted(PAGES))} or a /bots/...md path.")
    if kind == "changelog":
        return PAGES["changelog"]
    raise ValueError(f"Unsupported kind: {kind}")


def _cache_file(cache_dir: Path, path: str) -> Path:
    return cache_dir / (path.strip("/").replace("/", "__"))


def fetch(path: str, cache_dir: Path | None = None) -> str:
    """Fetch markdown from core.telegram.org; optional cache is read first."""
    if cache_dir is not None:
        cached = _cache_file(cache_dir, path)
        if cached.is_file():
            return cached.read_text(encoding="utf-8")
    request = urllib.request.Request(
        BASE + path,
        headers={"User-Agent": "telegram-engineering-skill/tg_docs", "Accept": "text/markdown"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            text = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise NotFound(path) from None
        raise Offline(f"HTTP {exc.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise Offline(type(exc).__name__) from None
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        _cache_file(cache_dir, path).write_text(text, encoding="utf-8")
    return text


def compact(text: str, keep_links: bool = False) -> str:
    """Drop the navigation banner, make links absolute or keep only their text."""
    lines = [line for line in text.splitlines() if not line.startswith("> Part of the [Telegram Bot API]")]
    text = "\n".join(lines)
    if keep_links:
        return re.sub(r"\]\(/", f"]({BASE}/", text)
    return LINK_RE.sub(lambda match: match[1], text)


def section(text: str, needle: str) -> str:
    """Return the first section whose heading contains needle (case-insensitive)."""
    lines = text.splitlines()
    start = level = None
    for index, line in enumerate(lines):
        match = HEADING_RE.match(line)
        if not match:
            continue
        if start is None and needle.lower() in match[2].lower():
            start, level = index, len(match[1])
        elif start is not None and len(match[1]) <= level:
            return "\n".join(lines[start:index]).strip()
    if start is None:
        raise NotFound(f"section {needle!r}")
    return "\n".join(lines[start:]).strip()


def changelog_entries(text: str, entries: int) -> str:
    """Return the newest N dated entries (#### Month D, YYYY) of the changelog."""
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if re.match(r"^####\s+[A-Z][a-z]+ \d{1,2}, \d{4}\s*$", line)]
    if not starts:
        raise NotFound("changelog entries")
    end = starts[entries] if entries < len(starts) else len(lines)
    chunk = lines[starts[0]:end]
    return "\n".join(line for line in chunk if not re.match(r"^###\s+\d{4}\s*$", line)).strip()


def grep(text: str, pattern: str, context: int) -> str:
    regex = re.compile(pattern, re.I)
    lines = text.splitlines()
    keep: set[int] = set()
    for index, line in enumerate(lines):
        if regex.search(line):
            keep.update(range(max(0, index - context), min(len(lines), index + context + 1)))
    if not keep:
        raise NotFound(f"pattern {pattern!r}")
    out, previous = [], None
    for index in sorted(keep):
        if previous is not None and index != previous + 1:
            out.append("--")
        out.append(lines[index])
        previous = index
    return "\n".join(out)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="kind", required=True)
    for kind, help_text in (("method", "Bot API method, e.g. sendRichMessage"), ("type", "Bot API type, e.g. InlineKeyboardButton")):
        item = sub.add_parser(kind, help=help_text)
        item.add_argument("name")
    page = sub.add_parser("page", help=f"Known page ({', '.join(sorted(PAGES))}) or /bots/...md path")
    page.add_argument("name")
    log = sub.add_parser("changelog", help="Newest Bot API changelog entries")
    log.add_argument("--entries", type=int, default=1, help="Number of dated entries (default 1)")
    for item in sub.choices.values():
        item.add_argument("--section", help="Print only the section whose heading contains this text")
        item.add_argument("--grep", help="Print only lines matching this case-insensitive regex")
        item.add_argument("--context", type=int, default=2, help="Context lines for --grep (default 2)")
        item.add_argument("--keep-links", action="store_true", help="Keep absolute links instead of link text only")
        item.add_argument("--cache-dir", type=Path, help="Optional directory for reusing fetched pages offline")
        item.add_argument("--json", action="store_true", help="Print {url, fetched_at, content} as JSON")
    return parser


def run(args: argparse.Namespace) -> tuple[str, str]:
    path = resolve(args.kind, getattr(args, "name", ""))
    text = fetch(path, args.cache_dir)
    if args.kind == "changelog":
        if args.entries < 1:
            raise ValueError("--entries must be at least 1")
        text = changelog_entries(text, args.entries)
    text = compact(text, keep_links=args.keep_links)
    if args.section:
        text = section(text, args.section)
    if args.grep:
        text = grep(text, args.grep, max(0, args.context))
    return BASE + path, text


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        url, text = run(args)
    except ValueError as exc:
        print(f"usage error: {exc}", file=sys.stderr)
        return 2
    except re.error as exc:
        print(f"usage error: invalid --grep regex: {exc}", file=sys.stderr)
        return 2
    except NotFound as exc:
        print(f"not found: {exc}. Check spelling with `tg_docs.py page api --grep NAME`; absence here is not proof the feature does not exist.", file=sys.stderr)
        return 1
    except Offline as exc:
        print(f"network unavailable ({exc}): mark the API fact as unverified; do not invent fields.", file=sys.stderr)
        return 3
    fetched = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    if args.json:
        print(json.dumps({"url": url, "fetched_at": fetched, "content": text}, ensure_ascii=False))
    else:
        print(f"<!-- source: {url} | fetched {fetched} -->")
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
