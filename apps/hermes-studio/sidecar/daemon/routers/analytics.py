from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from fastapi import APIRouter, Query, Request

from ..services.dependencies import get_active_hermes_home
from ..schemas.analytics import (
    ModelAnalyticsResponse,
    ModelCapabilities,
    ModelUsageStat,
    UsageTotals,
)

router = APIRouter(tags=["analytics"])

_CAPABILITIES: dict[str, ModelCapabilities] = {
    "claude-opus-4-7":   ModelCapabilities(vision=True, function_calling=True),
    "claude-sonnet-4-6": ModelCapabilities(vision=True, function_calling=True),
    "claude-haiku-4-5":  ModelCapabilities(vision=True, function_calling=True),
}

_QUERY = """
    SELECT
        billing_provider                                             AS provider,
        model,
        COUNT(*)                                                     AS session_count,
        COALESCE(SUM(input_tokens), 0)                              AS input_tokens,
        COALESCE(SUM(output_tokens), 0)                             AS output_tokens,
        COALESCE(SUM(input_tokens + output_tokens), 0)              AS total_tokens,
        COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0) AS cost_usd,
        MAX(COALESCE(ended_at, started_at))                         AS last_used_at
    FROM sessions
    WHERE COALESCE(ended_at, started_at) >= CAST(strftime('%s', 'now', :offset) AS REAL)
      AND billing_provider IS NOT NULL
    GROUP BY model
    ORDER BY total_tokens DESC
"""


@router.get("/analytics/models", response_model=ModelAnalyticsResponse)
async def get_model_analytics(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
) -> ModelAnalyticsResponse:
    db_path: Path = get_active_hermes_home(request) / "state.db"

    models: List[ModelUsageStat] = []

    if db_path.exists():
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(_QUERY, {"offset": f"-{days} days"}).fetchall()
        finally:
            conn.close()

        for row in rows:
            model_name = row["model"] or ""
            raw_ts = row["last_used_at"]
            last_used_iso = (
                datetime.fromtimestamp(raw_ts, tz=timezone.utc).isoformat()
                if raw_ts is not None
                else None
            )
            models.append(
                ModelUsageStat(
                    provider=row["provider"] or "",
                    model=model_name,
                    session_count=row["session_count"],
                    input_tokens=row["input_tokens"],
                    output_tokens=row["output_tokens"],
                    total_tokens=row["total_tokens"],
                    cost_usd=round(row["cost_usd"], 6),
                    last_used_at=last_used_iso,
                    capabilities=_CAPABILITIES.get(model_name, ModelCapabilities()),
                )
            )

    totals = UsageTotals(
        total_sessions=sum(m.session_count for m in models),
        total_input_tokens=sum(m.input_tokens for m in models),
        total_output_tokens=sum(m.output_tokens for m in models),
        total_tokens=sum(m.total_tokens for m in models),
        total_cost_usd=round(sum(m.cost_usd for m in models), 6),
    )

    return ModelAnalyticsResponse(
        models=models,
        totals=totals,
        period_days=days,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
