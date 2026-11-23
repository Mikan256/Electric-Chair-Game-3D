#!/usr/bin/env python3
"""Downscale and re-encode bulky textures copied from the legacy Unity project.

Requires Pillow (`pip install pillow`). The synced files are committed, so this
step is only needed after `pnpm assets:sync`.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"

RULES = {
    "textures/clock.png": (2048, 2048),
    "textures/logo-en.png": (1024, 1024),
    "textures/emblem.png": (1280, 1280),
    "textures/lightning/fx-oo.png": (1024, 1024),
    "textures/lightning/fx-pp.png": (1024, 1024),
    "textures/lightning/fx-ll.png": (1024, 1024),
    "textures/lightning/fx-mm.png": (1024, 1024),
    "textures/lightning/fx-nn.png": (1024, 1024),
}


def main() -> None:
    for relative, (width, height) in RULES.items():
        path = ASSETS / relative
        if not path.exists():
            continue
        with Image.open(path) as image:
            before = path.stat().st_size
            if image.width <= width and image.height <= height:
                continue
            image = image.convert("RGBA") if image.mode in ("P", "LA", "RGB") else image
            image.thumbnail((width, height), Image.LANCZOS)
            image.save(path, optimize=True)
            after = path.stat().st_size
            print(f"{relative}: {image.width}x{image.height} {before // 1024}KB -> {after // 1024}KB")


if __name__ == "__main__":
    main()
