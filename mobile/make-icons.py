"""
Generates the MidFood app icon set.

The mark is a white delivery scooter with a steaming hot-food box (an
illustration picked by Sipho on 12 Oct 2026, kept in assets/source/scooter.jpg)
on a warm orange radial gradient, with the MidFood wordmark underneath in
Poppins ExtraBold (assets/source/Poppins-ExtraBold.ttf, SIL Open Font License).

Run: python3 make-icons.py
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets')
SRC = os.path.join(OUT, 'source')

CREAM = (250, 249, 245)
TERRACOTTA = (217, 119, 87)       # #d97757, the site's accent
GLOW = (236, 96, 24)              # centre of the gradient (sampled from the art)
EDGE = (176, 32, 0)               # corners of the gradient (sampled from the art)
WORD = 'MidFood'


def scooter_cutout():
    """The white scooter lifted off its orange background as RGBA.

    White has a high blue channel, the orange background almost none, so the
    blue channel is a clean alpha mask with soft anti-aliased edges.
    """
    src = Image.open(os.path.join(SRC, 'scooter.jpg')).convert('RGB')
    b = src.split()[2]
    alpha = b.point(lambda v: max(0, min(255, int((v - 70) * 255 / 150))))
    white = Image.new('RGBA', src.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    # Trim to the scooter's bounding box.
    bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    return white.crop(bbox)


def gradient(size, center=GLOW, edge=EDGE, cy=0.45):
    """Radial glow: bright a little above centre, deepening to the corners."""
    small = 256
    img = Image.new('RGB', (small, small))
    px = img.load()
    for y in range(small):
        for x in range(small):
            dx = (x / small) - 0.5
            dy = (y / small) - cy
            t = min(1.0, (dx * dx + dy * dy) ** 0.5 / 0.78)
            t = t * t * (3 - 2 * t)  # smoothstep
            px[x, y] = tuple(int(center[i] + (edge[i] - center[i]) * t) for i in range(3))
    return img.resize((size, size), Image.BICUBIC)


def wordmark(width_px, color=(255, 255, 255)):
    """The word rendered to fit `width_px`, as RGBA."""
    font_path = os.path.join(SRC, 'Poppins-ExtraBold.ttf')
    size = 100
    font = ImageFont.truetype(font_path, size)
    w = font.getbbox(WORD)[2]
    size = int(size * width_px / w)
    font = ImageFont.truetype(font_path, size)
    l, t, r, b = font.getbbox(WORD)
    img = Image.new('RGBA', (r - l + 8, b - t + 8), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((-l + 4, -t + 4), WORD, font=font, fill=color + (255,))
    return img


def soft_shadow(layer, blur, offset=(0, 0), opacity=0.35):
    sh = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    a = layer.split()[3].point(lambda v: int(v * opacity))
    sh.putalpha(a)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    return sh, offset


def compose(size, inset=0.0, with_word=True, mark_color=None, background=None):
    """Scooter above the wordmark, centred in the inner (1 - inset) of the canvas.

    `background`: an RGB image or None for transparent.
    `mark_color`: tint the white art (for the splash).
    """
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if background is not None:
        canvas.paste(background.convert('RGBA'))
    field = size * (1.0 - inset)
    ox = oy = (size - field) / 2

    scooter = scooter_cutout()
    sw = int(field * 0.82)
    scooter = scooter.resize((sw, int(scooter.height * sw / scooter.width)), Image.LANCZOS)

    if with_word:
        word = wordmark(int(field * 0.74))
        gap = int(field * 0.06)
        total_h = scooter.height + gap + word.height
        top = oy + (field - total_h) / 2
        word_pos = (int(ox + (field - word.width) / 2), int(top + scooter.height + gap))
    else:
        total_h = scooter.height
        top = oy + (field - total_h) / 2
        word_pos = None
    scooter_pos = (int(ox + (field - scooter.width) / 2), int(top))

    if mark_color:
        tint = Image.new('RGBA', scooter.size, mark_color + (255,))
        tint.putalpha(scooter.split()[3])
        scooter = tint

    if background is not None:
        # A soft shadow under the scooter so it sits on the gradient.
        sh, off = soft_shadow(scooter, blur=size * 0.02, opacity=0.35)
        canvas.alpha_composite(sh, (scooter_pos[0], scooter_pos[1] + int(size * 0.025)))
    canvas.alpha_composite(scooter, scooter_pos)

    if with_word:
        if mark_color:
            tinted = Image.new('RGBA', word.size, mark_color + (255,))
            tinted.putalpha(word.split()[3])
            word = tinted
        if background is not None:
            sh, _ = soft_shadow(word, blur=size * 0.012, opacity=0.3)
            canvas.alpha_composite(sh, (word_pos[0], word_pos[1] + int(size * 0.012)))
        canvas.alpha_composite(word, word_pos)
    return canvas


os.makedirs(OUT, exist_ok=True)

# --- iOS / general app icon: full-bleed gradient, scooter + wordmark -------
compose(1024, inset=0.10, background=gradient(1024)).convert('RGB').save(os.path.join(OUT, 'icon.png'))

# --- Android adaptive ------------------------------------------------------
# The launcher crops the layers to a circle/squircle, so the art stays inside
# the inner 66% (inset 0.34 leaves a little breathing room).
compose(1024, inset=0.36, background=None).save(os.path.join(OUT, 'android-icon-foreground.png'))
gradient(1024).save(os.path.join(OUT, 'android-icon-background.png'))
# Monochrome (themed icons on Android 13+): silhouette only, no wordmark.
compose(1024, inset=0.40, with_word=False, background=None).save(os.path.join(OUT, 'android-icon-monochrome.png'))

# --- Splash: terracotta scooter + wordmark on the app's cream background ----
compose(1024, inset=0.30, mark_color=TERRACOTTA, background=None).save(os.path.join(OUT, 'splash-icon.png'))

# --- Favicon ---------------------------------------------------------------
compose(196, inset=0.08, with_word=False, background=gradient(196)).convert('RGB').save(os.path.join(OUT, 'favicon.png'))

print('wrote:', sorted(os.listdir(OUT)))
