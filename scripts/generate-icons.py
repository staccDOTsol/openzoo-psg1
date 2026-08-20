#!/usr/bin/env python3
"""Generate original OpenZoo Android launcher icons (not Play Solana / Seeker art)."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "res" / "icon" / "android"

# density → px (Android launcher)
SIZES = {
    "ldpi": 36,
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

BG = (8, 10, 8, 255)
INK = (198, 232, 90, 255)
INK_DIM = (120, 150, 50, 255)
CORE = (232, 244, 180, 255)


def write_png(path: Path, w: int, h: int, rgba: bytearray) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(rgba[y * stride : (y + 1) * stride])
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def mix(a, b, t: float):
    t = max(0.0, min(1.0, t))
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))


def draw_icon(size: int) -> bytearray:
    px = bytearray(size * size * 4)
    cx = cy = (size - 1) / 2.0
    r_outer = size * 0.36
    r_inner = size * 0.22
    r_core = size * 0.07
    bar_len = size * 0.11
    bar_w = max(1.2, size * 0.045)

    def put(x: int, y: int, c) -> None:
        if 0 <= x < size and 0 <= y < size:
            i = (y * size + x) * 4
            px[i : i + 4] = bytes(c)

    for y in range(size):
        for x in range(size):
            dx = x - cx
            dy = y - cy
            dist = (dx * dx + dy * dy) ** 0.5
            # dark field with a faint radial lift
            t = max(0.0, 1.0 - dist / (size * 0.72))
            color = mix(BG, (18, 24, 14, 255), t * 0.55)

            # enclosure ring (the "O")
            ring = abs(dist - (r_outer + r_inner) / 2)
            ring_half = (r_outer - r_inner) / 2
            if ring < ring_half + 0.8:
                aa = 1.0 - max(0.0, ring - ring_half) / 0.8
                color = mix(color, INK, aa)

            # inner core
            if dist < r_core + 0.8:
                aa = 1.0 - max(0.0, dist - r_core) / 0.8
                color = mix(color, CORE, aa)

            # four short bars — abstract enclosure, not a trademark
            for ang_dx, ang_dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
                bx = cx + ang_dx * (r_outer + bar_len * 0.15)
                by = cy + ang_dy * (r_outer + bar_len * 0.15)
                # stadium along the outward axis
                px_ = x - bx
                py_ = y - by
                along = px_ * ang_dx + py_ * ang_dy
                across = px_ * (-ang_dy) + py_ * ang_dx
                if 0 <= along <= bar_len and abs(across) <= bar_w:
                    edge = min(along, bar_len - along, bar_w - abs(across))
                    aa = 1.0 if edge > 0.6 else max(0.0, edge / 0.6)
                    color = mix(color, INK_DIM if along < bar_len * 0.25 else INK, aa)

            # corner ticks so small densities still read as a mark
            tick = size * 0.09
            inset = size * 0.16
            if (
                (abs(x - inset) < tick * 0.22 and inset <= y <= inset + tick)
                or (abs(y - inset) < tick * 0.22 and inset <= x <= inset + tick)
                or (abs(x - (size - 1 - inset)) < tick * 0.22 and inset <= y <= inset + tick)
                or (abs(y - inset) < tick * 0.22 and size - 1 - inset - tick <= x <= size - 1 - inset)
                or (abs(x - inset) < tick * 0.22 and size - 1 - inset - tick <= y <= size - 1 - inset)
                or (abs(y - (size - 1 - inset)) < tick * 0.22 and inset <= x <= inset + tick)
                or (abs(x - (size - 1 - inset)) < tick * 0.22 and size - 1 - inset - tick <= y <= size - 1 - inset)
                or (abs(y - (size - 1 - inset)) < tick * 0.22 and size - 1 - inset - tick <= x <= size - 1 - inset)
            ):
                color = mix(color, INK_DIM, 0.85)

            put(x, y, color)
    return px


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in SIZES.items():
        dest = OUT / f"{name}.png"
        write_png(dest, size, size, draw_icon(size))
        print(f"wrote {dest} ({size}x{size})")


if __name__ == "__main__":
    main()
