#!/usr/bin/env python3
"""Validate a ZIP against the Flaxia WVFS rules before uploading.

Usage:
    python3 scripts/validate-flaxia-zip.py release/electric-chair-game-3d-flaxia.zip
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

# Keep in sync with TeamFlaxia/flaxia.shared/file-extensions.ts (checked 2026-11).
ALLOWED_EXTENSIONS = {
    ".html",
    ".css",
    ".js",
    ".mjs",
    ".json",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".mp3",
    ".wav",
    ".ogg",
    ".m4a",
    ".opus",
    ".mp4",
    ".webm",
    ".mov",
    ".wasm",
    ".data",
    ".unityweb",
    ".wasm.code",
    ".wasm.framework",
    ".txt",
    ".glsl",
    ".wgsl",
    ".rsp",
    ".cf",
    ".zip",
}
MAX_ZIP_BYTES = 25 * 1024 * 1024  # free plan; Flaxia+ is 128 MiB
MAX_FILE_COUNT = 1024
MAX_PATH_LENGTH = 255
MAX_DEPTH = 10
MAX_TOTAL_SIZE = 512 * 1024 * 1024
MAX_ENTRY_SIZE = 100 * 1024 * 1024


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def validate(path: Path) -> list[str]:
    errors: list[str] = []
    size = path.stat().st_size
    print(f"zip: {path}")
    print(f"size: {size / 1024 / 1024:.1f} MiB")
    if size > MAX_ZIP_BYTES:
        fail(errors, f"ZIP is larger than 25 MiB ({size / 1024 / 1024:.1f} MiB)")

    with zipfile.ZipFile(path) as archive:
        infos = [info for info in archive.infolist() if not info.is_dir()]
        print(f"files: {len(infos)}")
        if len(infos) > MAX_FILE_COUNT:
            fail(errors, f"too many files ({len(infos)} > {MAX_FILE_COUNT})")

        total = 0
        has_index = False
        for info in infos:
            name = info.filename
            normalized = name[2:] if name.startswith("./") else name
            if normalized == "index.html":
                has_index = True

            if len(normalized) > MAX_PATH_LENGTH:
                fail(errors, f"path too long: {normalized}")
            if normalized.startswith("/"):
                fail(errors, f"absolute path: {normalized}")
            if "\\" in normalized:
                fail(errors, f"backslash in path: {normalized}")
            if ".." in normalized.split("/"):
                fail(errors, f"path traversal: {normalized}")
            if normalized.count("/") > MAX_DEPTH:
                fail(errors, f"directory too deep: {normalized}")
            if normalized.lower().endswith(".zip"):
                fail(errors, f"nested ZIP: {normalized}")
            ext = Path(normalized).suffix.lower()
            if ext not in ALLOWED_EXTENSIONS:
                fail(errors, f"extension not allowed: {normalized}")
            if info.file_size > MAX_ENTRY_SIZE:
                fail(errors, f"entry too large: {normalized}")
            total += info.file_size
            mode = info.external_attr >> 16
            if (mode & 0xF000) == 0xA000:
                fail(errors, f"symlink: {normalized}")

        print(f"uncompressed: {total / 1024 / 1024:.1f} MiB")
        if total > MAX_TOTAL_SIZE:
            fail(errors, "uncompressed total exceeds 512 MiB")
        if not has_index:
            fail(errors, "index.html is not at the archive root")

    return errors


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: validate-flaxia-zip.py <zip>", file=sys.stderr)
        return 2
    errors: list[str] = []
    for arg in sys.argv[1:]:
        errors.extend(validate(Path(arg)))
    if errors:
        print("\nINVALID:")
        for error in errors:
            print(f"  - {error}")
        return 1
    print("\nOK: Flaxia WVFS rules satisfied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
