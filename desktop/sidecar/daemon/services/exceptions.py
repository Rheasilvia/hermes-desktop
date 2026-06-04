"""Typed exception hierarchy for service-layer error handling.

Services raise these instead of HTTPException.  app.py maps them to HTTP
responses via a single ServiceError handler.
"""

from __future__ import annotations

from typing import Any, Optional


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


class MemoryFileNotFoundError(ServiceError):
    """Whitelisted memory file does not exist on disk."""
    code = "MEMORY_FILE_NOT_FOUND"


class MemoryFileTooLargeError(ServiceError):
    """Memory file exceeds the read or write size cap."""
    code = "MEMORY_FILE_TOO_LARGE"


class MemoryPathInvalidError(ServiceError):
    """Resolved memory path escapes the permitted root, or workspace is unknown."""
    code = "MEMORY_PATH_INVALID"


class MemoryEncodingError(ServiceError):
    """Memory file on disk is not valid UTF-8."""
    code = "MEMORY_ENCODING_INVALID"


class MemoryConcurrentWriteError(ServiceError):
    """Optimistic concurrency check failed: on-disk modified_at differs from If-Match.

    ``current`` carries the latest server-side ``MemoryFileWithContent`` shape
    as a plain dict so the HTTP layer can serialize it into the conflict body
    without importing service dataclasses.
    """
    code = "MEMORY_CONCURRENT_WRITE"

    def __init__(
        self,
        detail: Optional[str] = None,
        *,
        current: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(detail)
        self.current = current
