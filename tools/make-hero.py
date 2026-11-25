#!/usr/bin/env python3
"""Generates docs/art/hero.gif and hero.png for the README (original NEXORA art).
Run from the repo root:  python3 tools/make-hero.py   (needs Pillow + numpy)"""
import math, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

W, H = 1200, 680
BG = (11, 16, 22); PANEL = (5, 24, 27); EDGE = (42, 122, 114)
TEAL = (45, 226, 200); DEEP = (10, 100, 94); WHITE = (226, 255, 250); DIM = (20, 70, 68)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
FONTB = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
f_tag = ImageFont.truetype(FONT, 19); f_tagb = ImageFont.truetype(FONTB, 19)
f_lab = ImageFont.truetype(FONTB, 15); f_bub = ImageFont.truetype(FONT, 18)

def h(*a):  # deterministic 0..1 hash
    return int(hashlib.md5(repr(a).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF

def mix(a, b, t):
    t = max(0, min(1, t)); return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

GLY = {
 'N': ['10001','11001','10101','10011','10001','10001','10001'],
 'E': ['11111','10000','10000','11110','10000','10000','11111'],
 'X': ['10001','10001','01010','00100','01010','10001','10001'],
 'O': ['01110','10001','10001','10001','10001','10001','01110'],
 'R': ['11110','10001','10001','11110','10100','10010','10001'],
 'A': ['01110','10001','10001','11111','10001','10001','10001'],
}

def base_layer():
    im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = 95, 170, 1105, 655
    d.rectangle([x0, y0, x1, y1], fill=PANEL, outline=EDGE)
    for y in range(y0 + 8, y1, 12):
        for x in range(x0 + 8, x1, 12):
            d.rectangle([x, y, x + 1, y + 1], fill=(9, 44, 46))
    # app icon
    ic = Image.open('assets/icons/nexora-app-icon.png').convert('RGBA').resize((104, 104), Image.LANCZOS)
    m = Image.new('L', (104, 104), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, 103, 103], 24, fill=255)
    im.paste(ic, (548, 32), m)
    # pixel title
    cell, gap = 8, 10; tw = 6 * 5 * cell + 5 * gap; tx = (W - tw) // 2; ty = 196
    for i, ch in enumerate('NEXORA'):
        for r, row in enumerate(GLY[ch]):
            for c, v in enumerate(row):
                if v == '1':
                    x = tx + i * (5 * cell + gap) + c * cell; y = ty + r * cell
                    d.rectangle([x, y, x + cell - 2, y + cell - 2], fill=WHITE)
    # tagline
    parts = [('An AI buddy that lives on your screen, ', f_tag, (150, 220, 210)), ('talks back', f_tagb, TEAL),
             (' and gets things done.', f_tag, (150, 220, 210))]
    tot = sum(d.textlength(t, font=f) for t, f, _ in parts); x = (W - tot) / 2
    for t, f, c in parts:
        d.text((x, 272), t, font=f, fill=c); x += d.textlength(t, font=f)
    # labels
    for name, cx, col in [('ROBOT', 200, (150, 220, 210)), ('NEXO', 365, (150, 220, 210)), ('NEXORA', 600, TEAL),
                          ('NEXIE', 835, (150, 220, 210))]:
        d.text((cx - d.textlength(name, font=f_lab) / 2, 612), name, font=f_lab, fill=col)
    return im

def dot_sphere(d, cx, cy, R, cell, t, density=0.8, talk=0.0, tint=1.0):
    n = int(R / cell)
    for gy in range(-n, n + 1):
        for gx in range(-n, n + 1):
            r = math.hypot(gx, gy) / n
            if r > 1: continue
            z = math.sqrt(max(0, 1 - r * r))
            ripple = 0.5 + 0.5 * math.sin(2 * math.pi * (r * 1.4 - t))
            lit = 0.25 + 0.55 * z + 0.25 * (-(gx + gy) / (2 * n)) + talk * 0.35 * ripple
            if h(gx, gy) > density * (0.35 + 0.75 * lit) * (1.15 - 0.4 * r): continue
            col = mix(DEEP, TEAL, lit * tint)
            if lit > 0.92: col = mix(col, WHITE, 0.6)
            x = cx + gx * cell; y = cy + gy * cell
            d.rectangle([x, y, x + cell - 2, y + cell - 2], fill=col)

def robot(d, cx, cy, t, blink, talk):
    c = 8
    def px(gx, gy, col):
        x = cx + gx * c; y = cy + gy * c; d.rectangle([x, y, x + c - 2, y + c - 2], fill=col)
    for gy in range(-6, 7):  # head
        for gx in range(-6, 7):
            edge = max(abs(gx), abs(gy)) == 6 and not (abs(gx) == 6 and abs(gy) == 6)
            if edge: px(gx, gy, mix(DEEP, TEAL, 0.7))
            elif max(abs(gx), abs(gy)) < 6: px(gx, gy, (8, 60, 60))
    for gx in range(-4, 5):  # visor
        for gy in range(-3, 2): px(gx, gy, (4, 30, 32))
    for ex in (-2, 2):  # eyes
        if blink:
            for dx in (-1, 0, 1): px(ex + dx, -1, TEAL)
        else:
            for dy in (-2, -1, 0):
                for dx in (-1, 0): px(ex + dx, dy, WHITE if dy == -1 else TEAL)
    w = 1 + int(talk * 3)  # mouth bars
    for gx in range(-w, w + 1): px(gx, 3, TEAL)
    px(0, -9, TEAL); px(0, -8, DEEP); px(0, -7, DEEP)  # antenna
    for s in (-1, 1): px(s * 7, 0, TEAL); px(s * 7, -1, DEEP); px(s * 7, 1, DEEP)

def neural(d, cx, cy, R, t):
    pts = []
    for i in range(16):
        a = i * 2.399963 + t * 2 * math.pi * 0.5
        yy = 1 - 2 * (i + .5) / 16; rr = math.sqrt(1 - yy * yy)
        x, z = math.cos(a) * rr, math.sin(a) * rr
        pts.append((cx + x * R, cy + yy * R, z))
    for i, p in enumerate(pts):
        for j in range(i + 1, len(pts)):
            q = pts[j]; dist = math.hypot(p[0] - q[0], p[1] - q[1])
            if dist < R * 0.95:
                d.line([p[0], p[1], q[0], q[1]], fill=mix(DIM, DEEP, 0.9), width=1)
    for k, (x, y, z) in enumerate(sorted(pts, key=lambda p: p[2])):
        s = 4 + int((z + 1) * 2); pulse = 0.5 + 0.5 * math.sin(2 * math.pi * (t * 2 + k / 16))
        col = mix(DEEP, WHITE, (z + 1) / 2 * 0.5 + pulse * 0.4)
        d.rectangle([x - s / 2, y - s / 2, x + s / 2, y + s / 2], fill=col)

def flow(d, cx, cy, R, t):
    for k in range(130):
        ph = (h(k, 1) + t) % 1.0; tilt = h(k, 2) * math.pi; rad = R * (0.45 + 0.55 * h(k, 3))
        a = 2 * math.pi * ph * (1 if h(k, 4) > .5 else -1)
        x = cx + math.cos(a) * rad * math.cos(tilt) - math.sin(a) * rad * 0.35 * math.sin(tilt)
        y = cy + math.cos(a) * rad * math.sin(tilt) * 0.6 + math.sin(a) * rad * 0.35 * math.cos(tilt)
        s = 3 if h(k, 5) > .4 else 2
        d.rectangle([x, y, x + s, y + s], fill=mix(DEEP, TEAL, h(k, 6) * 0.7 + 0.3))
    d.rectangle([cx - 5, cy - 5, cx + 4, cy + 4], fill=WHITE)

def cursor(d, x, y):
    pts = [(0,0),(0,17),(4,13),(7,20),(10,19),(7,12),(12,12)]
    d.polygon([(x + a, y + b) for a, b in pts], fill=(240, 250, 250), outline=(10, 30, 30))

BUB = 'Hey, I\'m NEXORA.'
def frame(base, i, N):
    t = i / N; im = base.copy(); d = ImageDraw.Draw(im)
    talk = 1.0 if 2 <= i < N - 3 else 0.0
    dot_sphere(d, 600, 470, 90, 7, t, density=1.15, talk=talk)
    mw = 6 + int(talk * (8 if i % 2 else 3)); d.rectangle([600 - mw, 466, 600 + mw, 468], fill=WHITE)
    for k in range(9):  # shadow dots under orb
        d.rectangle([555 + k * 11, 575, 559 + k * 11, 577], fill=TEAL if abs(k - 4) < 2 + (i % 3) else DIM)
    robot(d, 200, 548, t, blink=(i in (5, 6)), talk=talk * (0.4 + 0.6 * (i % 2)))
    neural(d, 365, 535, 52, t)
    flow(d, 835, 530, 80, t)
    cursor(d, 470, 540 + int(3 * math.sin(2 * math.pi * t)))
    shown = BUB[:max(0, min(len(BUB), int((i - 1) * len(BUB) / (N - 6) + 1)))] if i >= 1 else ''
    if shown:
        bx0, by0, bx1, by1 = 700, 300, 700 + 224, 340
        d.rectangle([bx0, by0, bx1, by1], fill=(5, 28, 30), outline=TEAL, width=2)
        d.text((bx0 + 14, by0 + 9), shown + ('_' if i % 2 == 0 and len(shown) < len(BUB) else ''), font=f_bub, fill=(200, 245, 238))
    bloom = im.filter(ImageFilter.GaussianBlur(7)).point(lambda v: int(v * 0.55))
    return ImageChops.screen(im, bloom)

if __name__ == '__main__':
    N = 18; base = base_layer()
    frames = [frame(base, i, N) for i in range(N)]
    frames[-1].save('docs/art/hero.png')
    pal = [f.convert('P', palette=Image.ADAPTIVE, colors=96) for f in frames]
    durs = [90] * (N - 1) + [1400]
    pal[0].save('docs/art/hero.gif', save_all=True, append_images=pal[1:], duration=durs, loop=0, optimize=True, disposal=1)
    print('done')
