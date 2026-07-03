from __future__ import annotations

import pytest

from daemon.services.desktop_meta_service import normalize_reasoning_effort


def test_boolean_false_maps_to_none():
    # A JS `false` (reasoning off) arrives as Python False. It must map to the
    # canonical "none" (off), not fall back to the "medium" default.
    assert normalize_reasoning_effort(False) == "none"


def test_stringified_false_maps_to_none():
    # Some callers pre-stringify the runtime value; "False"/"false" must also
    # mean off rather than raise/revert to default.
    assert normalize_reasoning_effort("False") == "none"
    assert normalize_reasoning_effort("false") == "none"


def test_valid_levels_pass_through():
    for level in ("none", "minimal", "low", "medium", "high", "xhigh"):
        assert normalize_reasoning_effort(level) == level


def test_case_insensitive():
    assert normalize_reasoning_effort("HIGH") == "high"


def test_invalid_raises_when_strict():
    with pytest.raises(ValueError):
        normalize_reasoning_effort("bogus")


def test_invalid_falls_back_when_not_strict():
    assert normalize_reasoning_effort("bogus", strict=False) == "medium"
