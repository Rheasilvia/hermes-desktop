"""Typed exception hierarchy for service-layer error handling.

Services raise these instead of HTTPException.  app.py maps them to HTTP
responses via a single ServiceError handler.
"""

from __future__ import annotations


class ServiceError(Exception):
    """Base for all service-layer exceptions.

    Subclasses define a ``code`` class attribute — a machine-readable string
    that the app.py handler maps to an HTTP status code and ErrorEnvelope.
    """

    code: str = "INTERNAL"

    def __init__(self, detail: str | None = None) -> None:
        super().__init__(detail or self.code)
        self.detail = detail


class SessionNotFoundError(ServiceError):
    """Session does not exist."""
    code = "SESSION_NOT_FOUND"


class SessionBusyError(ServiceError):
    """Session agent is already running a turn."""
    code = "SESSION_BUSY"


class NoRunningSessionError(ServiceError):
    """No agent turn is in progress for this session."""
    code = "NO_RUNNING_SESSION"


class ProviderNotFoundError(ServiceError):
    """Provider not found in overlays or catalog."""
    code = "PROVIDER_NOT_FOUND"


class SchemaVersionError(ServiceError):
    """Desktop settings schema version does not match the expected version."""
    code = "SCHEMA_VERSION_MISMATCH"
