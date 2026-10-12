"""
Generates the MidFood app icon set from one vector-ish definition.

The mark: a delivery scooter, seen from the side and heading right, with a
hot-food box on the back and steam rising from it. Says "food on its way"
at a glance, reads at 48px on a home screen, and sits in the same warm
palette as the site (accent #d97757 on #faf9f5).

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
    """The scooter-with-hot-box mark, transparent background, centred.

    `inset` shrinks the mark within the canvas — Android's adaptive icon
    crops to a circle, so the foreground layer needs it.
    """
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    scale = (1.0 - inset)
    unit = S * scale / 100.0          # work in a 100-unit design grid
    ox = S / 2 - 50 * unit            # grid origin so the grid is centred
    oy = S / 2 - 50 * unit - 2.5 * unit   # a touch high: the wheels carry the visual weight

    def P(x, y):
        return (ox + x * unit, oy + y * unit)

    def u(v):
        return v * unit

    def thick_line(a, b, w):
        d.line([P(*a), P(*b)], fill=color, width=int(u(w)))
        for (x, y) in (a, b):
            cx, cy = P(x, y)
            r = u(w) / 2
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)

    def ring(center, r, w):
        cx, cy = P(*center)
        d.ellipse([cx - u(r), cy - u(r), cx + u(r), cy + u(r)], outline=color, width=int(u(w)))

    def dot(center, r):
        cx, cy = P(*center)
        d.ellipse([cx - u(r), cy - u(r), cx + u(r), cy + u(r)], fill=color)

    # --- wheels ------------------------------------------------------------
    rear = (25, 78)
    front = (79, 78)
    for c in (rear, front):
        ring(c, 11.5, 5.5)
        dot(c, 3.2)

    # --- frame -------------------------------------------------------------
    # floorboard from the rear upright to the steering column
    thick_line((34, 72), (68, 72), 7)
    # steering column up to the handlebar, leaning back a little
    thick_line((71, 74), (63, 36), 7)
    # handlebar
    thick_line((55, 35), (75, 33), 6)
    # rear upright carrying the box
    thick_line((31, 72), (31, 58), 7)
    # seat, in front of the box
    thick_line((42, 58), (57, 56), 7)

    # --- hot-food box on the back -----------------------------------------
    x0, y0 = P(10, 34)
    x1, y1 = P(42, 60)
    d.rounded_rectangle([x0, y0, x1, y1], radius=u(4.5), fill=color)

    # --- steam: three rising curves above the box, drawn as a trail of dots
    # so the edges stay smooth at every size -------------------------------
    steam_r = 2.6
    tops = [(18, 15), (26, 20), (34, 15)]
    for sx, height in tops:
        bot_y = 29
        top_y = bot_y - height
        steps = 80
        for i in range(steps + 1):
            t = i / steps
            y = bot_y + (top_y - bot_y) * t
            x = sx + math.sin(t * math.pi * 1.25) * 3.0 * (1 - t * 0.35)
            dot((x, y), steam_r)

    # --- motion: two short dashes behind the scooter -----------------------
    thick_line((1, 64), (8, 64), 4.5)
    thick_line((3, 74), (8, 74), 4.5)

    return img.resize((size, size), Image.LANCZOS)


def on_background(mark, size, bg):
    img = Image.new('RGBA', (size, size), bg + (255,))
    img.alpha_composite(mark)
    return img.convert('RGB')


# --- iOS / general app icon: white mark on terracotta, full bleed ----------
icon = on_background(draw_mark(1024, WHITE, inset=0.18), 1024, ACCENT)
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
on_background(draw_mark(196, WHITE, inset=0.16), 196, ACCENT).save(
    os.path.join(OUT, 'favicon.png'))

print('wrote:', sorted(os.listdir(OUT)))
