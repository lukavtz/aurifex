"""Deterministic Telegram text helpers: escaping, length units and safe splitting.

Import from Python (``from tg_text import escape_html, split_html``) or use the CLI:

    python scripts/tg_text.py escape-html < value.txt
    python scripts/tg_text.py escape-mdv2 --context code < value.txt
    python scripts/tg_text.py length < message.txt
    python scripts/tg_text.py split --html --limit 4096 --json < answer.html
    python scripts/tg_text.py neutralize-markdown-html < llm_answer.md

Escape *inserted values*, not a finished template. Splitting measures visible
text in UTF-16 code units, which is never smaller than the code-point count, so
chunks stay within the ordinary-message limit under either interpretation.
Nothing is sent anywhere; the server parser remains authoritative.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import unicodedata

ORDINARY_LIMIT = 4096
CAPTION_LIMIT = 1024
MDV2_SPECIAL = set("_*[]()~`>#+-=|{}.!\\")
TAG_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9-]*)([^<>]*)>")
ENTITY_RE = re.compile(r"&(?:#[0-9]{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});")
_GLUE = {"\u200d", "\ufe0e", "\ufe0f"}


def utf16_len(value: str) -> int:
    """Length in UTF-16 code units, the unit of MessageEntity offset/length."""
    return len(value.encode("utf-16-le", "surrogatepass")) // 2


def utf8_len(value: str) -> int:
    """Length in UTF-8 bytes, the unit of callback_data (1-64 bytes)."""
    return len(value.encode("utf-8"))


def escape_html(value: str) -> str:
    """Escape a value inserted into parse_mode=HTML text (<, > and &)."""
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def escape_html_attr(value: str) -> str:
    """Escape a value inserted into a double-quoted HTML attribute, e.g. href."""
    return escape_html(value).replace('"', "&quot;")


def escape_markdown_v2(value: str, context: str = "text") -> str:
    """Escape a value for MarkdownV2 in the given context: text, code or url.

    text: every special character and backslash; code: backtick and backslash
    inside `code`/```pre```; url: ')' and backslash inside (...) of a link.
    """
    if context == "text":
        specials = MDV2_SPECIAL
    elif context == "code":
        specials = {"`", "\\"}
    elif context == "url":
        specials = {")", "\\"}
    else:
        raise ValueError("context must be text, code or url")
    return "".join("\\" + char if char in specials else char for char in value)


def neutralize_markdown_html(markdown: str) -> str:
    """Escape HTML metacharacters in untrusted rich Markdown, including code.

    A partial Markdown parser cannot reliably distinguish literal code from
    active HTML. Escape every occurrence, even inside code spans and fences.
    Telegram's renderer remains authoritative; code may show escaped entities.
    This does not sanitize Markdown links or automatic entity detection.
    """
    return escape_html(markdown)


def _safe_cut(text: str, cut: int) -> int:
    """Move a cut left so it does not split a grapheme-like cluster."""
    while 0 < cut < len(text) and (
        unicodedata.combining(text[cut])
        or text[cut] in _GLUE
        or text[cut - 1] == "\u200d"
        or 0x1F3FB <= ord(text[cut]) <= 0x1F3FF
        or 0xE0020 <= ord(text[cut]) <= 0xE007F
    ):
        cut -= 1
    return cut


def _prefix_fitting(text: str, budget: int) -> int:
    """Largest code-point prefix whose UTF-16 length fits the budget."""
    units = 0
    for index, char in enumerate(text):
        units += 2 if ord(char) > 0xFFFF else 1
        if units > budget:
            return index
    return len(text)


def _best_break(text: str, hard: int) -> int:
    """Choose a cut <= hard at paragraph, line, sentence or word boundary."""
    if hard >= len(text):
        return len(text)
    window = text[:hard]
    floor = hard // 2
    for separator in ("\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " "):
        position = window.rfind(separator)
        if position >= floor:
            return _safe_cut(text, position + len(separator))
    return _safe_cut(text, hard)


def split_text(text: str, limit: int = ORDINARY_LIMIT) -> list[str]:
    """Split plain text into chunks of at most `limit` UTF-16 units.

    Prefers paragraph, line, sentence and word boundaries; preserves whitespace
    and refuses an indivisible ZWJ/combining sequence larger than the limit.
    """
    if limit < 16:
        raise ValueError("limit must be at least 16")
    chunks: list[str] = []
    rest = text
    while rest:
        if utf16_len(rest) <= limit:
            chunks.append(rest)
            break
        hard = _prefix_fitting(rest, limit)
        cut = _best_break(rest, hard)
        if not cut:
            raise ValueError("grapheme cluster exceeds the message limit")
        chunks.append(rest[:cut])
        rest = rest[cut:]
    return chunks


def _tokens(markup: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    position = 0
    for match in TAG_RE.finditer(markup):
        if match.start() > position:
            tokens.append(("text", markup[position:match.start()]))
        tokens.append(("tag", match[0]))
        position = match.end()
    if position < len(markup):
        tokens.append(("text", markup[position:]))
    return tokens


def _visible_units(fragment: str) -> int:
    return utf16_len(html.unescape(fragment))


def _split_escaped(fragment: str, budget: int) -> int:
    """Find a safe boundary in HTML-escaped text, accounting for entities."""
    decoded: list[str] = []
    offsets: list[int] = []
    index = 0
    while index < len(fragment):
        entity = ENTITY_RE.match(fragment, index)
        end = entity.end() if entity else index + 1
        value = html.unescape(fragment[index:end])
        decoded.extend(value)
        offsets.extend([end] * len(value))
        index = end
    text = "".join(decoded)
    hard = _prefix_fitting(text, budget)
    cut = _best_break(text, hard)
    # A multi-character entity cannot be split between output messages.
    while 0 < cut < len(offsets) and offsets[cut - 1] == offsets[cut]:
        cut -= 1
    return offsets[cut - 1] if cut else 0


def split_html(markup: str, limit: int = ORDINARY_LIMIT) -> list[str]:
    """Split balanced Telegram HTML into chunks with <= limit visible UTF-16 units.

    Open tags are closed at the end of a chunk and reopened (with the original
    attributes) at the start of the next one, so every chunk is balanced. Input
    must already be valid parse_mode=HTML; this function does not sanitize.
    """
    if limit < 16:
        raise ValueError("limit must be at least 16")
    tokens = _tokens(markup)
    previous_text = ""
    for kind, value in tokens:
        if kind != "text":
            continue
        current_text = html.unescape(value)
        if previous_text and current_text and _safe_cut(previous_text[-1:] + current_text[:1], 1) == 0:
            raise ValueError("formatting boundary inside a grapheme cluster")
        previous_text = current_text
    chunks: list[str] = []
    stack: list[tuple[str, str]] = []
    current: list[str] = []
    used = 0

    def close_chunk() -> None:
        nonlocal current, used
        body = "".join(current) + "".join(f"</{name}>" for name, _ in reversed(stack))
        if used:
            chunks.append(body)
        current = [opening for _, opening in stack]
        used = 0

    for kind, value in tokens:
        if kind == "tag":
            match = TAG_RE.fullmatch(value)
            name = match[2].lower()
            if match[1]:
                if stack and stack[-1][0] == name:
                    stack.pop()
                current.append(value)
            else:
                current.append(value)
                if not match[3].rstrip().endswith("/"):
                    stack.append((name, value))
            continue
        fragment = value
        while fragment:
            room = limit - used
            needed = _visible_units(fragment)
            if needed <= room:
                current.append(fragment)
                used += needed
                break
            cut = _split_escaped(fragment, room) if room > 0 else 0
            if cut == 0 and used == 0:
                raise ValueError("grapheme cluster exceeds the message limit")
            if cut:
                current.append(fragment[:cut])
                used += _visible_units(fragment[:cut])
                fragment = fragment[cut:]
            close_chunk()
    if any(token for token in current if not TAG_RE.fullmatch(token)):
        close_chunk()
    return chunks


def _read(path: str | None) -> str:
    if path:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    return sys.stdin.read()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("escape-html", "escape-html-attr", "escape-mdv2", "length", "split", "neutralize-markdown-html"))
    parser.add_argument("--file", help="Read input from this UTF-8 file instead of stdin")
    parser.add_argument("--context", default="text", choices=("text", "code", "url"), help="MarkdownV2 escaping context")
    parser.add_argument("--limit", type=int, default=ORDINARY_LIMIT, help="Split limit in visible UTF-16 units (default 4096; captions 1024)")
    parser.add_argument("--html", action="store_true", help="Split balanced parse_mode=HTML instead of plain text")
    parser.add_argument("--json", action="store_true", help="Print JSON output")
    args = parser.parse_args(argv)
    try:
        value = _read(args.file)
        if args.command == "length":
            result: object = {"code_points": len(value), "utf16_units": utf16_len(value), "utf8_bytes": utf8_len(value)}
            print(json.dumps(result, ensure_ascii=False))
            return 0
        if args.command == "split":
            chunks = split_html(value, args.limit) if args.html else split_text(value, args.limit)
            if args.json:
                print(json.dumps(chunks, ensure_ascii=False))
            else:
                print("\n\n----- chunk -----\n\n".join(chunks))
            return 0
        transforms = {
            "escape-html": escape_html,
            "escape-html-attr": escape_html_attr,
            "escape-mdv2": lambda text: escape_markdown_v2(text, args.context),
            "neutralize-markdown-html": neutralize_markdown_html,
        }
        output = transforms[args.command](value)
        print(json.dumps(output, ensure_ascii=False) if args.json else output, end="" if not args.json else "\n")
        return 0
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
