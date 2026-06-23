"""Streaming parser for desktop Plan Mode proposed-plan blocks."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, TypedDict

OPEN_TAG = "<proposed_plan>"
CLOSE_TAG = "</proposed_plan>"


class PlanSegment(TypedDict):
    type: Literal["start", "delta", "end"]
    text: str


@dataclass
class PlanParseResult:
    visible_text: str = ""
    segments: list[PlanSegment] = field(default_factory=list)


class ProposedPlanParser:
    """Parse `<proposed_plan>` blocks out of a text stream.

    Tags are only recognized at column zero. This preserves indented examples
    such as ``  <proposed_plan> extra`` as normal assistant text.
    """

    def __init__(self) -> None:
        self._pending = ""
        self._in_plan = False
        self._at_line_start = True

    def push(self, chunk: str) -> PlanParseResult:
        self._pending += chunk or ""
        return self._drain(final=False)

    def finish(self) -> PlanParseResult:
        return self._drain(final=True)

    def _drain(self, *, final: bool) -> PlanParseResult:
        out = PlanParseResult()
        while self._pending:
            tag = CLOSE_TAG if self._in_plan else OPEN_TAG
            if self._at_line_start:
                if tag.startswith(self._pending) and len(self._pending) < len(tag) and not final:
                    break
                if self._pending.startswith(tag):
                    self._pending = self._pending[len(tag):]
                    if self._in_plan:
                        out.segments.append({"type": "end", "text": ""})
                        self._in_plan = False
                    else:
                        out.segments.append({"type": "start", "text": ""})
                        self._in_plan = True
                    self._consume_optional_tag_newline()
                    continue

            ch = self._pending[0]
            self._pending = self._pending[1:]
            self._append_char(out, ch)

        if final and self._pending:
            text = self._pending
            self._pending = ""
            self._append_text(out, text)

        if final and self._in_plan:
            out.segments.append({"type": "end", "text": ""})
            self._in_plan = False

        return out

    def _consume_optional_tag_newline(self) -> None:
        if self._pending.startswith("\r\n"):
            self._pending = self._pending[2:]
            self._at_line_start = True
        elif self._pending.startswith("\n"):
            self._pending = self._pending[1:]
            self._at_line_start = True
        else:
            self._at_line_start = False

    def _append_char(self, out: PlanParseResult, ch: str) -> None:
        self._append_text(out, ch)
        self._at_line_start = ch == "\n"

    def _append_text(self, out: PlanParseResult, text: str) -> None:
        if not text:
            return
        if self._in_plan:
            out.segments.append({"type": "delta", "text": text})
        else:
            out.visible_text += text


def strip_proposed_plan_blocks(text: str) -> str:
    parser = ProposedPlanParser()
    result = parser.push(text or "")
    tail = parser.finish()
    return f"{result.visible_text}{tail.visible_text}"


def parse_proposed_plan_blocks(text: str) -> PlanParseResult:
    parser = ProposedPlanParser()
    result = parser.push(text or "")
    tail = parser.finish()
    result.visible_text += tail.visible_text
    result.segments.extend(tail.segments)
    return result
