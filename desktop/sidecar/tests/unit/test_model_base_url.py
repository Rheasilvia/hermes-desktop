"""Regression: a stored base_url that equals the provider registry default must be
treated as NOT a user override, so it never defeats dynamic base_url resolution
(e.g. sk-kimi- keys must route to api.kimi.com/coding, not the moonshot.ai default).
"""
from __future__ import annotations

import pytest

from daemon.services.model_service import (
    is_provider_default_base_url,
    provider_registry_base_url,
)

# These assert against the real hermes_cli PROVIDER_REGISTRY. Skip if unavailable.
_kimi_default = provider_registry_base_url("kimi-coding")
pytestmark = pytest.mark.skipif(
    not _kimi_default, reason="hermes_cli PROVIDER_REGISTRY not available in this env"
)


def test_registry_default_flagged_as_non_override():
    assert is_provider_default_base_url("kimi-coding", _kimi_default) is True
    # trailing-slash tolerant
    assert is_provider_default_base_url("kimi-coding", _kimi_default + "/") is True


def test_alias_is_canonicalized():
    # "kimi" is an alias of "kimi-coding"; the default must still be detected.
    assert is_provider_default_base_url("kimi", _kimi_default) is True


def test_genuine_override_not_flagged():
    # The Kimi Code endpoint is a real value, not the moonshot default → keep it.
    assert is_provider_default_base_url("kimi-coding", "https://api.kimi.com/coding") is False


def test_custom_endpoint_not_flagged():
    assert is_provider_default_base_url("openai-api", "https://custom.example.com/v1") is False


def test_empty_is_not_default():
    assert is_provider_default_base_url("kimi-coding", "") is False
    assert is_provider_default_base_url("kimi-coding", None) is False
