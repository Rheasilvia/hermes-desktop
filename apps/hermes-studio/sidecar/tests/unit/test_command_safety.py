"""Unit tests for command_safety.py (dangerous-command pattern matcher) and
read_security_config (config.yaml security section reader)."""
from __future__ import annotations

from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# command_matches_patterns
# ---------------------------------------------------------------------------


class TestCommandMatchesPatterns:
    def test_exact_fragment_match(self):
        from daemon.services.command_safety import command_matches_patterns

        assert command_matches_patterns("rm -rf build", ["rm -rf"]) is True

    def test_no_match_for_safe_command(self):
        from daemon.services.command_safety import command_matches_patterns

        assert command_matches_patterns("git status", ["rm -rf"]) is False
        assert command_matches_patterns("ls -la", ["sudo"]) is False

    def test_sudo_matches_any_sudo_command(self):
        from daemon.services.command_safety import command_matches_patterns

        assert command_matches_patterns("sudo ls", ["sudo"]) is True
        assert command_matches_patterns("sudo apt update", ["sudo"]) is True

    def test_case_insensitive(self):
        from daemon.services.command_safety import command_matches_patterns

        assert command_matches_patterns("RM -RF build", ["rm -rf"]) is True
        assert command_matches_patterns("SUDO ls", ["sudo"]) is True

    def test_whitespace_normalized_in_command(self):
        from daemon.services.command_safety import command_matches_patterns

        # Extra spaces in the actual command still match the fragment.
        assert command_matches_patterns("rm      -rf    build", ["rm -rf"]) is True

    def test_empty_command_is_not_dangerous(self):
        from daemon.services.command_safety import command_matches_patterns

        assert command_matches_patterns("", ["rm -rf"]) is False
        assert command_matches_patterns("", []) is False

    def test_empty_pattern_entries_are_ignored(self):
        from daemon.services.command_safety import command_matches_patterns

        # An empty-string pattern must NOT match everything.
        assert command_matches_patterns("ls", ["", "  "]) is False

    def test_multiple_patterns_any_match(self):
        from daemon.services.command_safety import command_matches_patterns

        assert command_matches_patterns("chmod 777 /var", ["sudo", "chmod 777"]) is True

    def test_defaults_are_nonempty(self):
        from daemon.services.command_safety import DEFAULT_DANGEROUS_PATTERNS

        assert len(DEFAULT_DANGEROUS_PATTERNS) >= 5
        assert "rm -rf" in DEFAULT_DANGEROUS_PATTERNS
        assert "sudo" in DEFAULT_DANGEROUS_PATTERNS

    def test_whitespace_normalization_matches_spacing_variants(self):
        """A pattern with one space matches the same fragment with many spaces."""
        from daemon.services.command_safety import command_matches_patterns

        # Pattern "curl|sh" (no spaces) is a literal substring of the command.
        assert command_matches_patterns("curl|sh", ["curl|sh"]) is True
        # Normalized: pattern "curl | sh" matches "curl  |  sh" (extra spaces).
        assert command_matches_patterns("curl  |  sh", ["curl | sh"]) is True
        # But "curl http://x | sh" is a different fragment — substring "curl | sh"
        # is NOT present, so it correctly does not match.
        assert command_matches_patterns("curl http://x | sh", ["curl | sh"]) is False


# ---------------------------------------------------------------------------
# read_security_config
# ---------------------------------------------------------------------------


def _write_config(home: Path, body: str) -> None:
    (home / "config.yaml").write_text(body, encoding="utf-8")


class TestReadSecurityConfig:
    def test_reads_dangerous_commands_list(self, tmp_path):
        from daemon.readers.hermes_config import read_security_config

        _write_config(tmp_path, """
security:
  dangerous_commands:
    - rm -rf
    - sudo
  approval_required: false
""")
        sec = read_security_config(tmp_path)
        assert sec["dangerous_commands"] == ["rm -rf", "sudo"]
        assert sec["approval_required"] is False

    def test_missing_section_returns_none_patterns_and_default_approval(self, tmp_path):
        from daemon.readers.hermes_config import read_security_config

        _write_config(tmp_path, "model:\n  provider: openai\n")
        sec = read_security_config(tmp_path)
        assert sec["dangerous_commands"] is None
        assert sec["approval_required"] is True

    def test_missing_config_file(self, tmp_path):
        from daemon.readers.hermes_config import read_security_config

        sec = read_security_config(tmp_path)
        assert sec["dangerous_commands"] is None
        assert sec["approval_required"] is True

    def test_non_list_dangerous_commands_returns_none(self, tmp_path):
        from daemon.readers.hermes_config import read_security_config

        _write_config(tmp_path, """
security:
  dangerous_commands: "rm -rf"
""")
        sec = read_security_config(tmp_path)
        assert sec["dangerous_commands"] is None

    def test_coerces_non_bool_approval_required_to_true(self, tmp_path):
        from daemon.readers.hermes_config import read_security_config

        _write_config(tmp_path, """
security:
  approval_required: "yes"
""")
        sec = read_security_config(tmp_path)
        assert sec["approval_required"] is True

    def test_malformed_yaml_is_tolerated(self, tmp_path):
        from daemon.readers.hermes_config import read_security_config

        _write_config(tmp_path, "security: [unclosed")
        sec = read_security_config(tmp_path)
        assert sec["dangerous_commands"] is None
