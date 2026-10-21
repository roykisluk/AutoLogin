"""Draws extension/icons/icon{16,32,48,128}.png: white keyhole on a blue rounded square. Stdlib only."""
import struct, zlib

def inside(x, y):  # x, y in [0, 1]
    r = 0.2  # corner radius
    cx, cy = min(max(x, r), 1 - r), min(max(y, r), 1 - r)
    if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
        return None  # outside the rounded square
    hole = (x - 0.5) ** 2 + (y - 0.40) ** 2 < 0.15 ** 2
    t = (y - 0.40) / 0.36  # stem widens downward, from the circle centre to y = 0.76
    stem = 0 <= t <= 1 and abs(x - 0.5) < 0.05 + 0.05 * t
    return (255, 255, 255) if hole or stem else (37, 99, 235)

def png(n, path, ss=4):
    rows = []
    for j in range(n):
        row = bytearray([0])
        for i in range(n):
            acc, cover = [0, 0, 0], 0
            for sj in range(ss):
                for si in range(ss):
                    c = inside((i + (si + .5) / ss) / n, (j + (sj + .5) / ss) / n)
                    if c:
                        cover += 1
                        acc = [a + b for a, b in zip(acc, c)]
            row += bytes([a // cover if cover else 0 for a in acc] + [255 * cover // (ss * ss)])
        rows.append(bytes(row))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

for n in (16, 32, 48, 128):
    png(n, f'extension/icons/icon{n}.png')
