//! Clipboard image commands.
//!
//! The Tauri desktop attachment pipeline is path-based: the frontend attaches
//! images as filesystem paths and the sidecar reads them from disk at turn
//! start. So a pasted clipboard image must be written to a temp file first and
//! the path returned — the frontend then reuses the existing path-based
//! `image.attach` flow with zero backend changes.

use std::time::{SystemTime, UNIX_EPOCH};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Encodes a RGBA byte buffer + dimensions into a PNG file at `path`.
/// Extracted so the encode logic is unit-testable without a live clipboard.
fn encode_rgba_to_png(
    rgba: &[u8],
    width: u32,
    height: u32,
    path: &std::path::Path,
) -> Result<(), String> {
    let buf = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| "clipboard image had invalid dimensions".to_string())?;
    buf.save(path)
        .map_err(|e| format!("failed to write clipboard image to temp file: {e}"))
}

/// Reads an image from the system clipboard (if present), writes it to a temp
/// file, and returns the absolute path. Returns `Ok(None)` when the clipboard
/// has no image. Encoding is offloaded so the main thread is not blocked.
#[tauri::command]
pub async fn read_clipboard_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let image = match app.clipboard().read_image() {
        Ok(img) => img,
        Err(_) => return Ok(None),
    };

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // Random suffix so the temp path is not predictable/plantable.
    let nonce: u64 = rand::random();
    let filename = format!("hermes-clip-{ts}-{nonce}.png");

    let (rgba, width, height) = (
        image.rgba().to_vec(),
        image.width(),
        image.height(),
    );
    let path = std::env::temp_dir().join(filename);
    let result: Result<String, String> = tauri::async_runtime::spawn_blocking(move || {
        encode_rgba_to_png(&rgba, width, height, &path)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("encode task failed: {e}"))?;
    result.map(Some)
}

/// Fetches image bytes from a remote http(s) URL and writes them to the system
/// clipboard. Only remote URLs are accepted — `file://` and bare local paths
/// are rejected to avoid an arbitrary-local-file-read primitive (the `url`
/// originates from model-controlled rendered content). The fetch is bounded:
/// redirects are rejected, the scheme is allow-listed, and the body is capped.
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024; // 32 MiB

#[tauri::command]
pub async fn write_clipboard_image_from_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri::image::Image;

    let parsed = reqwest::Url::parse(&url).map_err(|_| "invalid URL".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("only http(s) URLs are supported".to_string()),
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;
    let resp = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("failed to fetch image: {e}"))?;
    // Reject redirects (3xx) so the destination cannot be redirected to an
    // internal/local address.
    if !resp.status().is_success() {
        return Err(format!("image fetch failed: HTTP {}", resp.status()));
    }
    let content_length = resp.content_length().unwrap_or(0) as usize;
    if content_length > MAX_IMAGE_BYTES {
        return Err("image exceeds maximum allowed size".to_string());
    }

    // Stream-read with a hard cap in case Content-Length was absent/lying.
    let mut bytes = Vec::with_capacity(content_length.min(MAX_IMAGE_BYTES));
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("failed to read image bytes: {e}"))?;
        if bytes.len() + chunk.len() > MAX_IMAGE_BYTES {
            return Err("image exceeds maximum allowed size".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }

    let image = Image::from_bytes(&bytes).map_err(|e| format!("invalid image bytes: {e}"))?;
    app.clipboard()
        .write_image(&image)
        .map_err(|e| format!("failed to write image to clipboard: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod clipboard_tests {
    use super::*;

    #[test]
    fn encode_rgba_to_png_rejects_mismatched_dimensions() {
        let rgba = vec![0u8; 4]; // 1 pixel, but claim 2x2
        let res = encode_rgba_to_png(&rgba, 2, 2, std::path::Path::new("/nonexistent/out.png"));
        assert!(res.is_err());
    }
}
