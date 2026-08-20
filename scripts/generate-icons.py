#!/usr/bin/env python3
"""Resize the OpenZoo token mark into Android launcher densities (not Seeker art)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "res" / "icon" / "openzoo-token.jpg"
OUT = ROOT / "res" / "icon" / "android"
MARK = ROOT / "www" / "mark.png"

SIZES = {
    "ldpi": 36,
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing token source: {SRC}")
    src = Image.open(SRC).convert("RGBA")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in SIZES.items():
        dest = OUT / f"{name}.png"
        src.resize((size, size), Image.Resampling.LANCZOS).save(dest, "PNG")
        print(f"wrote {dest} ({size}x{size})")
    MARK.parent.mkdir(parents=True, exist_ok=True)
    src.resize((128, 128), Image.Resampling.LANCZOS).save(MARK, "PNG")
    print(f"wrote {MARK} (128x128)")


if __name__ == "__main__":
    main()
