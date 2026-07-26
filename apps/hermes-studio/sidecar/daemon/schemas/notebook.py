from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

NotebookCellType = Literal["markdown", "code", "raw"]


class NotebookOutput(BaseModel):
    """A single cell output, flattened to a render-friendly shape."""

    output_type: str  # "stream" | "execute_result" | "display_data" | "error"
    mime: str | None = None
    # text/plain or stream text
    text: str | None = None
    # text/markdown source (rendered as markdown by the client)
    markdown: str | None = None
    # text/html source (sanitized client-side)
    html: str | None = None
    # image data as a data: URL (base64) for image/png, image/jpeg, image/svg+xml
    image: str | None = None
    # error output
    error_name: str | None = None
    error_value: str | None = None
    error_traceback: list[str] | None = None


class NotebookCell(BaseModel):
    index: int
    cell_type: NotebookCellType
    source: str
    execution_count: int | None = None
    outputs: list[NotebookOutput] = []


class NotebookRender(BaseModel):
    """Structured notebook render result consumed by the desktop preview pane."""

    path: str
    cells: list[NotebookCell]
    mtime: float
    size: int
    truncated: bool = False


class NotebookWatchRequest(BaseModel):
    path: str


class NotebookWatchResult(BaseModel):
    ok: bool
    path: str | None = None


class NotebookRenderPayload(BaseModel):
    """Payload shape for the `notebook.changed` SSE event."""

    path: str
    cells: list[NotebookCell]
    mtime: float
    size: int
    truncated: bool = False

    def to_render(self) -> NotebookRender:
        return NotebookRender(
            path=self.path,
            cells=self.cells,
            mtime=self.mtime,
            size=self.size,
            truncated=self.truncated,
        )


# Loose dict shape for clients that consume the SSE payload before typing.
NotebookRenderDict = dict[str, Any]
