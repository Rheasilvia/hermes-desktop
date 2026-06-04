from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel


class ModelCapabilities(BaseModel):
    vision: bool = False
    function_calling: bool = False
    streaming: bool = True


class ModelUsageStat(BaseModel):
    provider: str
    model: str
    display_name: Optional[str] = None
    session_count: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cost_usd: float
    last_used_at: Optional[str] = None
    capabilities: ModelCapabilities = ModelCapabilities()


class UsageTotals(BaseModel):
    total_sessions: int
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    total_cost_usd: float


class ModelAnalyticsResponse(BaseModel):
    models: List[ModelUsageStat]
    totals: UsageTotals
    period_days: int
    generated_at: str
