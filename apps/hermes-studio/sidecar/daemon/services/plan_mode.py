"""Desktop-only Plan Mode instructions and helpers."""
from __future__ import annotations

PLAN_MODE_INSTRUCTIONS = """# Plan Mode (Desktop)

You are in Plan Mode for this desktop turn.

Rules:
- Ground the plan in the actual project before asking the user.
- You may read files, search, inspect configuration, and run non-mutating checks.
- Do not edit files, apply patches, write generated files, or run commands whose purpose is to mutate repo-tracked state.
- Use request_user_input when an implementation decision materially changes the plan.
- Do not use todo or update_plan in Plan Mode; those are execution-mode progress tools.
- When the plan is decision complete, output exactly one final plan inside a standalone <proposed_plan> block.
- Do not put the official plan outside <proposed_plan>.

The opening and closing tags must be on their own lines:

<proposed_plan>
plan content
</proposed_plan>
"""


def append_plan_mode_instructions(context: str | None) -> str:
    current = (context or "").strip()
    if not current:
        return PLAN_MODE_INSTRUCTIONS
    return f"{PLAN_MODE_INSTRUCTIONS}\n\n{current}"
