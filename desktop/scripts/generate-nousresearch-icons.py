#!/usr/bin/env python3
"""Generate NousResearch app icons from SVG for Tauri. Run: python3 scripts/generate-nousresearch-icons.py"""

import os
import struct
import cairosvg
from PIL import Image

# Source SVG and output directories
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SVG_PATH = os.path.join(SCRIPT_DIR, "..", "src", "assets", "nousresearch.svg")
ICONS_DIR = os.path.join(SCRIPT_DIR, "..", "src-tauri", "icons")

# Icon sizes to generate
SIZES = [16, 32, 64, 128, 256, 512, 1024]

# ICNS type mapping for PNG data (modern macOS supports PNG in ICNS)
ICNS_TYPES = {
    16: b"icp4",
    32: b"icp5",
    64: b"icp6",
    128: b"ic07",
    256: b"ic08",
    512: b"ic09",
    1024: b"ic10",
}


MACOS_CONTENT_RATIO = 0.80  # macOS standard: icon content fills ~80% of canvas


def prepare_svg(svg_path: str) -> str:
    """Read SVG and fix it for standalone icon rendering."""
    with open(svg_path, "r", encoding="utf-8") as f:
        svg = f.read()

    # Replace currentColor with white
    svg = svg.replace('fill="currentColor"', 'fill="#ffffff"')
    # Set explicit dimensions for high-res rendering
    svg = svg.replace('height="1em"', 'height="1024"')
    svg = svg.replace('width="1em"', 'width="1024"')
    # Add black background rectangle as the first child of the SVG
    svg = svg.replace('><title>', '><rect width="1024" height="1024" fill="#000000"/><title>', 1)

    return svg


def add_macos_padding(img: Image.Image, content_ratio: float = MACOS_CONTENT_RATIO) -> Image.Image:
    """Scale content down and center it with padding, matching macOS icon standards.

    macOS renders app icons with ~10% padding on each side, so the actual
    visible content occupies about 80% of the full canvas area.
    """
    w, h = img.size
    content_size = int(min(w, h) * content_ratio)
    offset = (w - content_size) // 2

    # Scale the content down
    scaled = img.resize((content_size, content_size), Image.LANCZOS)

    # Paste onto a fresh canvas with black background
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    canvas.paste(scaled, (offset, offset))
    return canvas


def add_rounded_corners(img: Image.Image, radius_ratio: float = 0.186) -> Image.Image:
    """Add macOS-style rounded corners via alpha mask."""
    w, h = img.size
    radius = int(min(w, h) * radius_ratio)

    # Create rounded rectangle mask
    mask = Image.new("L", (w, h), 0)
    draw = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    from PIL import ImageDraw

    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)

    # Apply mask to alpha channel
    result = img.convert("RGBA")
    result.putalpha(mask)
    return result


def generate_pngs(svg_data: str, out_dir: str) -> dict:
    """Generate PNG files at various sizes using cairosvg."""
    png_paths = {}
    for size in SIZES:
        out_path = os.path.join(out_dir, f"icon_{size}x{size}.png")
        cairosvg.svg2png(
            bytestring=svg_data.encode("utf-8"),
            write_to=out_path,
            output_width=size,
            output_height=size,
        )
        img = Image.open(out_path)
        # Scale content to ~80% and center with padding (macOS standard)
        img = add_macos_padding(img)
        # Add macOS-style rounded corners
        img = add_rounded_corners(img)
        img.save(out_path, "PNG")
        png_paths[size] = out_path
        print(f"  Generated {size}x{size} PNG")
    return png_paths


def create_ico(png_paths: dict, out_path: str) -> None:
    """Create Windows ICO file with multiple sizes using Pillow."""
    ico_sizes = [16, 32, 48, 64, 128, 256]
    images = []

    for size in ico_sizes:
        if size not in png_paths:
            continue
        img = Image.open(png_paths[size])
        # Ensure RGBA for transparency support
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        images.append(img)

    if images:
        images[0].save(
            out_path,
            format="ICO",
            sizes=[(img.width, img.height) for img in images],
        )
        print(f"  Generated icon.ico")


def create_icns(png_paths: dict, out_path: str) -> None:
    """Create macOS ICNS file by assembling PNG-encoded icon entries."""
    entries = []

    for size in SIZES:
        if size not in png_paths or size not in ICNS_TYPES:
            continue
        png_data = open(png_paths[size], "rb").read()
        icon_type = ICNS_TYPES[size]
        # Length includes the 8-byte header (type + length) + data
        length = 8 + len(png_data)
        header = icon_type + struct.pack(">I", length)
        entries.append(header + png_data)

    if not entries:
        return

    body = b"".join(entries)
    file_length = 8 + len(body)
    file_header = b"icns" + struct.pack(">I", file_length)

    with open(out_path, "wb") as f:
        f.write(file_header + body)
    print(f"  Generated icon.icns")


def update_tauri_config() -> None:
    """Update tauri.conf.json to use the new icon paths."""
    config_path = os.path.join(SCRIPT_DIR, "..", "src-tauri", "tauri.conf.json")
    with open(config_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Replace old icon paths referencing src/assets/icons with src-tauri/icons paths
    old_icon_block = '''"icon": [
      "../src/assets/icons/favicon/icon_32x32.png",
      "../src/assets/icons/app/icon_128x128.png",
      "../src/assets/icons/app/icon_256x256.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]'''

    new_icon_block = '''"icon": [
      "icons/icon_32x32.png",
      "icons/icon_128x128.png",
      "icons/icon_256x256.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]'''

    if old_icon_block in content:
        content = content.replace(old_icon_block, new_icon_block)
        with open(config_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("  Updated tauri.conf.json icon paths")
    else:
        print("  Warning: Could not find expected icon block in tauri.conf.json")


def main():
    print("Generating NousResearch app icons...")
    os.makedirs(ICONS_DIR, exist_ok=True)

    svg_data = prepare_svg(SVG_PATH)
    png_paths = generate_pngs(svg_data, ICONS_DIR)

    create_ico(png_paths, os.path.join(ICONS_DIR, "icon.ico"))
    create_icns(png_paths, os.path.join(ICONS_DIR, "icon.icns"))

    # Also copy the 256x256 as the default icon.png for Tauri
    if 256 in png_paths:
        import shutil

        shutil.copy2(png_paths[256], os.path.join(ICONS_DIR, "icon.png"))
        print("  Copied 256x256 as icon.png")

    update_tauri_config()

    print("\nDone! Generated icons in src-tauri/icons/")
    print("You can now delete src/assets/icons/ if no longer needed.")


if __name__ == "__main__":
    main()
