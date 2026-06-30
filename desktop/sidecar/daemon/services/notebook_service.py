"""NotebookService — Service Layer for rendering .ipynb files for the desktop preview pane.

Three-layer split (backend-patterns):
  * Router (routers/notebooks.py) stays thin.
  * This module owns business logic: parse nbformat, flatten cells, cache by mtime.
  * Path resolution is delegated to ``WorkspaceService.resolve_abs_path`` so the
    workspace containment boundary stays the single source of truth.

Cache-aside: an in-memory ``{(session_id, path): (mtime, render)}`` avoids
re-parsing large notebooks on every manual fetch; the watcher refreshes the
entry on disk change.
"""

from __future__ import annotations

import base64
import logging
import threading
from pathlib import Path
from typing import Any

from ..schemas.notebook import NotebookCell, NotebookOutput, NotebookRender
from .workspace_service import WorkspaceService, WorkspaceServiceError

log = logging.getLogger(__name__)

# Render limit: notebooks can carry huge embedded outputs. We parse the whole
# file (nbformat needs the full JSON) but cap total cell count surfaced to the
# client so a pathological notebook can't OOM the renderer.
NOTEBOOK_MAX_CELLS = 500
NOTEBOOK_MAX_OUTPUT_CHARS = 200_000


class NotebookServiceError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _is_notebook_path(target: Path) -> bool:
    return target.suffix.lower() == ".ipynb"


def _join_source(source: Any) -> str:
    """nbformat cell.source is a str OR a list[str] of lines."""
    if source is None:
        return ""
    if isinstance(source, str):
        return source
    if isinstance(source, (list, tuple)):
        return "".join(str(part) for part in source)
    return str(source)


def _truncate(value: str, limit: int = NOTEBOOK_MAX_OUTPUT_CHARS) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "\n…[truncated]"


def _build_image_data_url(mime: str, data_b64_or_bytes: Any) -> str | None:
    """Build a data: URL for image outputs. nbformat stores base64-encoded bytes."""
    if not data_b64_or_bytes:
        return None
    if isinstance(data_b64_or_bytes, (bytes, bytearray)):
        b64 = base64.b64encode(bytes(data_b64_or_bytes)).decode("ascii")
    elif isinstance(data_b64_or_bytes, str):
        # nbformat stores base64 text already.
        b64 = data_b64_or_bytes
    else:
        return None
    return f"data:{mime};base64,{b64}"


_IMAGE_MIMES = ("image/png", "image/jpeg", "image/svg+xml")


def _flatten_output(output: dict) -> NotebookOutput | None:
    """Flatten one nbformat output dict to a NotebookOutput (or None to skip)."""
    output_type = output.get("output_type", "")
    # stream output: {name: stdout|stderr, text: str|list}
    if output_type == "stream":
        text = _truncate(_join_source(output.get("text")))
        return NotebookOutput(
            output_type="stream",
            mime="text/plain",
            text=text,
        )

    # execute_result / display_data: {data: {mime: payload}, metadata}
    if output_type in ("display_data", "execute_result"):
        data = output.get("data") or {}
        if not isinstance(data, dict) or not data:
            return None

        # Prefer image outputs.
        for mime in _IMAGE_MIMES:
            if mime in data:
                payload = data[mime]
                if mime == "image/svg+xml" and isinstance(payload, (str, list)):
                    # SVG is XML text, not base64 — render inline via html sink.
                    return NotebookOutput(
                        output_type=output_type,
                        mime=mime,
                        html=_truncate(_join_source(payload)),
                    )
                url = _build_image_data_url(mime, payload)
                if url:
                    return NotebookOutput(
                        output_type=output_type,
                        mime=mime,
                        image=url,
                    )

        if "text/html" in data:
            return NotebookOutput(
                output_type=output_type,
                mime="text/html",
                html=_truncate(_join_source(data["text/html"])),
            )
        if "text/markdown" in data:
            return NotebookOutput(
                output_type=output_type,
                mime="text/markdown",
                markdown=_truncate(_join_source(data["text/markdown"])),
            )
        if "text/plain" in data:
            return NotebookOutput(
                output_type=output_type,
                mime="text/plain",
                text=_truncate(_join_source(data["text/plain"])),
            )
        return None

    # error output: {ename, evalue, traceback: list[str]}
    if output_type == "error":
        tb = output.get("traceback") or []
        if isinstance(tb, list):
            traceback_lines = [str(line) for line in tb]
        else:
            traceback_lines = [str(tb)]
        return NotebookOutput(
            output_type="error",
            mime="text/plain",
            error_name=str(output.get("ename", "")),
            error_value=str(output.get("evalue", "")),
            error_traceback=traceback_lines[:50],
            text=_truncate(f"{output.get('ename', '')}: {output.get('evalue', '')}"),
        )

    return None


def _flatten_cells(nb: Any) -> tuple[list[NotebookCell], bool]:
    raw_cells = getattr(nb, "cells", None)
    if raw_cells is None and isinstance(nb, dict):
        raw_cells = nb.get("cells", [])
    raw_cells = list(raw_cells or [])

    truncated = len(raw_cells) > NOTEBOOK_MAX_CELLS
    visible = raw_cells[:NOTEBOOK_MAX_CELLS]

    out: list[NotebookCell] = []
    for idx, cell in enumerate(visible):
        cell_type = getattr(cell, "cell_type", None) or (
            cell.get("cell_type") if isinstance(cell, dict) else None
        ) or "raw"
        source = _join_source(getattr(cell, "source", None) if not isinstance(cell, dict) else cell.get("source"))

        if cell_type == "code":
            outputs_raw = getattr(cell, "outputs", None) if not isinstance(cell, dict) else cell.get("outputs")
            outputs = []
            for raw_out in (outputs_raw or []):
                flat = _flatten_output(raw_out if isinstance(raw_out, dict) else dict(raw_out))
                if flat is not None:
                    outputs.append(flat)
            exec_count = getattr(cell, "execution_count", None) if not isinstance(cell, dict) else cell.get("execution_count")
            out.append(NotebookCell(
                index=idx,
                cell_type="code",
                source=source,
                execution_count=exec_count if isinstance(exec_count, int) else None,
                outputs=outputs,
            ))
        else:
            kind = "markdown" if cell_type == "markdown" else "raw"
            out.append(NotebookCell(index=idx, cell_type=kind, source=source))

    return out, truncated


class NotebookService:
    """Service Layer: parse + cache notebook renders."""

    def __init__(self, *, workspace_service: WorkspaceService) -> None:
        self._workspace = workspace_service
        # Cache-aside: (session_id, resolved_path_str) -> {mtime, render}
        self._cache: dict[tuple[str, str], dict[str, Any]] = {}
        self._lock = threading.Lock()

    def render_notebook(self, session_id: str, path: str) -> NotebookRender:
        """Resolve, read, and parse a notebook; return a structured render.

        Reuses ``WorkspaceService`` as the path-resolution security boundary so
        containment rules cannot diverge from the rest of the desktop API.
        """
        target = self._workspace.resolve_abs_path(session_id, path, access="read")
        if not _is_notebook_path(target):
            raise NotebookServiceError(400, "NOTEBOOK_NOT_IPYNB")
        if not target.exists() or not target.is_file():
            raise NotebookServiceError(404, "NOTEBOOK_NOT_FOUND")

        try:
            stat = target.stat()
        except OSError as exc:
            raise NotebookServiceError(403, f"cannot stat notebook: {exc}") from exc

        mtime = stat.st_mtime
        size = stat.st_size
        key = (session_id, str(target))

        with self._lock:
            cached = self._cache.get(key)
            if cached and cached["mtime"] == mtime:
                render = cached["render"]
                # Refresh path to the caller-supplied relative path for display.
                return render.model_copy(update={"path": path})

        try:
            with target.open("r", encoding="utf-8") as handle:
                raw = handle.read()
        except UnicodeDecodeError as exc:
            raise NotebookServiceError(422, f"NOTEBOOK_INVALID_JSON: not UTF-8 ({exc})") from exc
        except OSError as exc:
            raise NotebookServiceError(403, f"cannot read notebook: {exc}") from exc

        try:
            import nbformat

            nb = nbformat.reads(raw, as_version=4)
            # nbformat.validate raises NotebookValidationError on structural issues;
            # we tolerate minor issues and still render best-effort.
            try:
                nbformat.validate(nb)
            except nbformat.ValidationError as exc:
                log.warning("notebook %s failed strict validation (rendering best-effort): %s", target, exc)
        except Exception as exc:  # malformed JSON / unreadable
            raise NotebookServiceError(422, f"NOTEBOOK_INVALID_JSON: {exc}") from exc

        cells, truncated = _flatten_cells(nb)
        render = NotebookRender(path=path, cells=cells, mtime=mtime, size=size, truncated=truncated)

        with self._lock:
            self._cache[key] = {"mtime": mtime, "render": render}

        return render
