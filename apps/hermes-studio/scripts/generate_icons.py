#!/usr/bin/env python3
"""Generate pixel-art Hermes app icons for Tauri. Run manually: python3 scripts/generate_icons.py"""

from PIL import Image, ImageDraw
import os
import sys

# Color palette from the existing Hermes logo
BG = (245, 240, 232)          # Warm parchment background
WING = (201, 100, 66)          # #c96442 terracotta
WING_LIGHT = (217, 119, 87)    # #d97757 lighter accent
STAFF = (160, 80, 52)          # Darker staff
HIGHLIGHT = (230, 150, 120)    # Highlight

# 16x16 pixel art: stylized Hermes winged staff
# Symmetrical wings with a central staff
PIXEL_ART = [
    "................",
    "...LL......LL...",
    "..LWWL....LWWL..",
    ".LWWWWL..LWWWWL.",
    ".LWWWWWLLWWWWWL.",
    "LWWWWWWWWWWWWWWL",
    "LWWWWWWSSWWWWWWL",
    "..WWWWWSSWWWWW..",
    "......SSSS......",
    "......SHHS......",
    "......SHHS......",
    "......SSSS......",
    "......SSSS......",
    "......SSSS......",
    "......SSSS......",
    "................",
]


def render_icon(pixel_art, out_size, bg=BG):
    """Render pixel art and scale to target size using nearest-neighbor."""
    h = len(pixel_art)
    w = len(pixel_art[0])

    # Create small image at 1x pixel scale first
    small = Image.new('RGBA', (w, h), bg + (255,))
    draw = ImageDraw.Draw(small)

    for y, row in enumerate(pixel_art):
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            color = {
                'W': WING,
                'L': WING_LIGHT,
                'S': STAFF,
                'H': HIGHLIGHT,
            }.get(ch, bg)
            draw.point((x, y), fill=color + (255,))

    # Scale up with nearest neighbor to preserve pixelation
    icon = small.resize((out_size, out_size), Image.NEAREST)
    return icon


def add_rounded_corners(img, radius_ratio=0.18):
    """Add rounded corners via alpha mask (for macOS aesthetic)."""
    w, h = img.size
    radius = int(min(w, h) * radius_ratio)

    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)

    # Draw rounded rectangle
    draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)

    # Apply mask to alpha channel
    result = img.copy()
    result.putalpha(mask)
    return result


def generate_tauri_icons():
    """Generate all icon sizes needed by Tauri."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(script_dir, '..', 'src-tauri', 'icons')
    assets_dir = os.path.join(script_dir, '..', 'src', 'assets')

    os.makedirs(icons_dir, exist_ok=True)
    os.makedirs(assets_dir, exist_ok=True)

    sizes = {
        '32x32.png': 32,
        '64x64.png': 64,
        '128x128.png': 128,
        '128x128@2x.png': 256,
        'icon.png': 512,
    }

    for filename, size in sizes.items():
        icon = render_icon(PIXEL_ART, size)
        # Add rounded corners for macOS-style app icons
        if filename != '32x32.png':
            icon = add_rounded_corners(icon, radius_ratio=0.18)
        path = os.path.join(icons_dir, filename)
        icon.save(path, 'PNG')
        print(f"Generated {path} ({size}x{size})")

    # Also save a copy to src/assets for frontend use
    asset_icon = render_icon(PIXEL_ART, 128)
    asset_icon = add_rounded_corners(asset_icon, radius_ratio=0.18)
    asset_path = os.path.join(assets_dir, 'app-icon.png')
    asset_icon.save(asset_path, 'PNG')
    print(f"Generated {asset_path}")

    # Generate ICO for Windows
    try:
        ico_path = os.path.join(icons_dir, 'icon.ico')
        # ICO needs multiple sizes
        ico_images = []
        for ico_size in [16, 32, 48, 64, 128, 256]:
            ico_img = render_icon(PIXEL_ART, ico_size)
            if ico_size >= 64:
                ico_img = add_rounded_corners(ico_img, radius_ratio=0.18)
            ico_images.append(ico_img)
        ico_images[0].save(ico_path, format='ICO', sizes=[(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)])
        print(f"Generated {ico_path}")
    except Exception as e:
        print(f"ICO generation failed: {e}")

    # Generate ICNS for macOS (requires external tool, skip for now)
    print("\nDone! Note: icon.icns requires macOS iconutil or sips.")


if __name__ == '__main__':
    generate_tauri_icons()
