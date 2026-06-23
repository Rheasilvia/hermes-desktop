from __future__ import annotations

from daemon.services.proposed_plan import (
    ProposedPlanParser,
    parse_proposed_plan_blocks,
    strip_proposed_plan_blocks,
)


def _segment_text(segments: list[dict], segment_type: str) -> str:
    return "".join(
        segment["text"]
        for segment in segments
        if segment["type"] == segment_type
    )


def test_parser_handles_cross_chunk_plan_tags():
    parser = ProposedPlanParser()

    first = parser.push("before\n<proposed_")
    second = parser.push("plan>\n- inspect code\n")
    third = parser.push("</proposed_plan>\nafter")
    tail = parser.finish()

    visible = first.visible_text + second.visible_text + third.visible_text + tail.visible_text
    segments = [*first.segments, *second.segments, *third.segments, *tail.segments]

    assert visible == "before\nafter"
    assert segments[0]["type"] == "start"
    assert segments[-1]["type"] == "end"
    assert _segment_text(segments, "delta") == "- inspect code\n"


def test_parser_treats_indented_tags_as_visible_text():
    text = "  <proposed_plan>\nkeep visible\n  </proposed_plan>"

    parsed = parse_proposed_plan_blocks(text)

    assert parsed.visible_text == text
    assert parsed.segments == []


def test_parser_closes_unclosed_plan_on_finish():
    parsed = parse_proposed_plan_blocks("<proposed_plan>\n- item")

    assert parsed.visible_text == ""
    assert [segment["type"] for segment in parsed.segments][0] == "start"
    assert [segment["type"] for segment in parsed.segments][-1] == "end"
    assert _segment_text(parsed.segments, "delta") == "- item"


def test_strip_proposed_plan_blocks_removes_only_column_zero_plan_blocks():
    text = "visible\n<proposed_plan>\nplan body\n</proposed_plan>\n  <proposed_plan>\nexample"

    assert strip_proposed_plan_blocks(text) == "visible\n  <proposed_plan>\nexample"
