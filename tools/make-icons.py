#!/usr/bin/env python3
"""Membuat ikon PNG ekstensi (tanpa dependensi eksternal)."""
import os
import struct
import zlib

SS = 4  # supersampling
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")

TOP = (30, 58, 138)     # biru tua
BOTTOM = (59, 130, 246)  # biru terang
WHITE = (255, 255, 255)


def inside_round_rect(x, y, w, r):
    if x < r and y < r:
        return (x - r) ** 2 + (y - r) ** 2 <= r * r
    if x > w - 1 - r and y < r:
        return (x - (w - 1 - r)) ** 2 + (y - r) ** 2 <= r * r
    if x < r and y > w - 1 - r:
        return (x - r) ** 2 + (y - (w - 1 - r)) ** 2 <= r * r
    if x > w - 1 - r and y > w - 1 - r:
        return (x - (w - 1 - r)) ** 2 + (y - (w - 1 - r)) ** 2 <= r * r
    return True


def in_bar(x, y, w, x0, y0, bw, bh):
    r = bh / 2.0
    if y < y0 or y > y0 + bh:
        return False
    if x < x0 or x > x0 + bw:
        return False
    if x < x0 + r:
        return (x - (x0 + r)) ** 2 + (y - (y0 + r)) ** 2 <= r * r
    if x > x0 + bw - r:
        return (x - (x0 + bw - r)) ** 2 + (y - (y0 + r)) ** 2 <= r * r
    return True


def render(size):
    w = size * SS
    r = w * 0.235
    bars = [
        (0.21, 0.242, 0.58, 0.135),  # header
        (0.21, 0.455, 0.58, 0.062),
        (0.21, 0.575, 0.46, 0.062),
        (0.21, 0.695, 0.34, 0.062),
    ]
    small = []
    for y in range(size):
        row = []
        for x in range(size):
            ar = ag = ab = aa = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = x * SS + sx
                    py = y * SS + sy
                    if not inside_round_rect(px, py, w, r):
                        continue
                    t = py / (w - 1)
                    cr = TOP[0] + (BOTTOM[0] - TOP[0]) * t
                    cg = TOP[1] + (BOTTOM[1] - TOP[1]) * t
                    cb = TOP[2] + (BOTTOM[2] - TOP[2]) * t
                    ca = 255
                    for (bx, by, bw, bh) in bars:
                        if in_bar(px, py, w, bx * w, by * w, bw * w, bh * w):
                            cr, cg, cb = WHITE
                            break
                    ar += cr * ca
                    ag += cg * ca
                    ab += cb * ca
                    aa += ca
            if aa == 0:
                row.append((0, 0, 0, 0))
            else:
                n = SS * SS
                row.append((round(ar / aa), round(ag / aa), round(ab / aa), round(aa / n)))
        small.append(row)
    return small


def write_png(path, pixels):
    h = len(pixels)
    w = len(pixels[0])
    raw = b"".join(
        b"\x00" + b"".join(bytes(px) for px in row) for row in pixels
    )

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT, "icon%d.png" % size)
        write_png(path, render(size))
        print("dibuat:", os.path.relpath(path))


if __name__ == "__main__":
    main()
