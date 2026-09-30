"""
Generates the MidFood app icon set from one vector-ish definition.

The mark: a steaming bowl. Food-first, reads at 48px on a home screen, and
sits in the same warm palette as the site (accent #d97757 on #faf9f5).

Everything is drawn at 4x and downsampled, which is what gives the curves
clean edges without needing a real vector renderer.
"""
from PIL import Image, ImageDraw
import math, os

ACCENT = (217, 119, 87)     # #d97757
CREAM  = (250, 249, 245)    # #faf9f5
WHITE  = (255, 255, 255)
SS = 4                      # supersample factor

OUT = os.path.join(os.path.dirname(__file__), 'assets')
os.makedirs(OUT, exist_ok=True)


def draw_mark(size, color, inset=0.0):
    """The bowl-with-steam mark, transparent background, centred.

    `inset` shrinks the mark within the canvas — Android's adaptive icon
    crops to a circle, so the foreground layer needs it.
    """
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    scale = (1.0 - inset)
    cx = S / 2
    unit = S * scale / 100.0          # work in a 100-unit design grid

    def u(v):
        return v * unit

    # Vertical placement: bowl sits low, steam above.
    base_y = S / 2 + u(26)            # bottom of the bowl
    bowl_w = u(74)
    bowl_h = u(34)

    # --- bowl: a half-ellipse with a flat rim -----------------------------
    left = cx - bowl_w / 2
    right = cx + bowl_w / 2
    rim_y = base_y - bowl_h

    # bowl body (lower half of an ellipse)
    d.pieslice([left, rim_y - bowl_h, right, base_y], start=0, end=180, fill=color)

    # rim: a rounded bar across the top of the bowl, slightly wider
    rim_h = u(9)
    rim_over = u(6)
    d.rounded_rectangle(
        [left - rim_over, rim_y - rim_h / 2, right + rim_over, rim_y + rim_h / 2],
        radius=rim_h / 2, fill=color,
    )

    # --- steam: three rising curves ---------------------------------------
    steam_w = u(7.0)
    tops = [(-u(20), u(30)), (0, u(38)), (u(20), u(30))]
    for dx, height in tops:
        x0 = cx + dx
        top_y = rim_y - u(12) - height
        bot_y = rim_y - u(12)
        pts = []
        steps = 60
        for i in range(steps + 1):
            t = i / steps
            y = bot_y + (top_y - bot_y) * t
            # gentle S-curve, fading amplitude toward the top
            x = x0 + math.sin(t * math.pi * 1.25) * u(7) * (1 - t * 0.35)
            pts.append((x, y))
        d.line(pts, fill=color, width=int(steam_w), joint='curve')
        # round the ends
        for (px, py) in (pts[0], pts[-1]):
            r = steam_w / 2
            d.ellipse([px - r, py - r, px + r, py + r], fill=color)

    return img.resize((size, size), Image.LANCZOS)


def on_background(mark, size, bg):
    img = Image.new('RGBA', (size, size), bg + (255,))
    img.alpha_composite(mark)
    return img.convert('RGB')


def rounded_square(size, bg, radius_ratio=0.22):
    """iOS applies its own mask, but a full-bleed square is what it wants."""
    return Image.new('RGBA', (size, size), bg + (255,))


# --- iOS / general app icon: white mark on terracotta, full bleed ----------
icon = on_background(draw_mark(1024, WHITE, inset=0.22), 1024, ACCENT)
icon.save(os.path.join(OUT, 'icon.png'))

# --- Android adaptive ------------------------------------------------------
# Foreground must sit inside the inner 66% safe zone, since the launcher
# crops it to whatever shape the phone uses.
draw_mark(1024, WHITE, inset=0.40).save(os.path.join(OUT, 'android-icon-foreground.png'))
Image.new('RGBA', (1024, 1024), ACCENT + (255,)).convert('RGB').save(
    os.path.join(OUT, 'android-icon-background.png'))
# Monochrome (themed icons on Android 13+): silhouette on transparent.
draw_mark(1024, (255, 255, 255), inset=0.40).save(
    os.path.join(OUT, 'android-icon-monochrome.png'))

# --- Splash: terracotta mark on the app's cream background -----------------
draw_mark(1024, ACCENT, inset=0.30).save(os.path.join(OUT, 'splash-icon.png'))

# --- Favicon ---------------------------------------------------------------
on_background(draw_mark(196, WHITE, inset=0.20), 196, ACCENT).save(
    os.path.join(OUT, 'favicon.png'))

print('wrote:', sorted(os.listdir(OUT)))
