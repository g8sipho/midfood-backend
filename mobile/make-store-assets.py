"""
Generates the Google Play store-listing graphics from the same art as the app
icon (see make-icons.py), into store/:

  store/icon-512.png                 Play Console "App icon" (512 x 512, PNG)
  store/feature-graphic-1024x500.png Play Console "Feature graphic"

Also refreshes the website's own icons in ../backend/public so the site, the
PWA home-screen icon and the app all show the same scooter.

Run: python3 make-store-assets.py
"""
from PIL import Image, ImageDraw, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, 'store')
WEB = os.path.join(HERE, '..', 'backend', 'public')

# Reuse the icon script's drawing helpers without re-running its top level.
src = open(os.path.join(HERE, 'make-icons.py')).read().split('os.makedirs(OUT, exist_ok=True)')[0]
icons = {'__file__': os.path.join(HERE, 'make-icons.py')}
exec(compile(src, 'make-icons.py', 'exec'), icons)
compose, gradient, scooter_cutout, soft_shadow = icons['compose'], icons['gradient'], icons['scooter_cutout'], icons['soft_shadow']
SRC = icons['SRC']

os.makedirs(STORE, exist_ok=True)

# --- 512 icon: the app icon, scaled -----------------------------------------
compose(1024, inset=0.10, background=gradient(1024)).convert('RGB').resize((512, 512), Image.LANCZOS).save(
    os.path.join(STORE, 'icon-512.png'))

# --- Feature graphic: scooter on the left, name and promise on the right -----
W, H = 1024, 500
bg = gradient(1024, cy=0.5)  # square gradient, cropped to the banner
bg = bg.crop((0, (1024 - H) // 2, W, (1024 - H) // 2 + H))
fg = Image.new('RGBA', (W, H), (0, 0, 0, 0))
fg.paste(bg.convert('RGBA'))

scooter = scooter_cutout()
sw = 400
scooter = scooter.resize((sw, int(scooter.height * sw / scooter.width)), Image.LANCZOS)
pos = (56, (H - scooter.height) // 2)
sh, _ = soft_shadow(scooter, blur=14, opacity=0.35)
fg.alpha_composite(sh, (pos[0], pos[1] + 14))
fg.alpha_composite(scooter, pos)

font_path = os.path.join(SRC, 'Poppins-ExtraBold.ttf')
big = ImageFont.truetype(font_path, 104)
small = ImageFont.truetype(font_path, 40)
draw = ImageDraw.Draw(fg)
x = 486
# Wordmark with a soft shadow, then the one-line promise under it.
word = 'MidFood'
wb = big.getbbox(word)
wy = 158
draw.text((x + 3, wy + 4), word, font=big, fill=(120, 20, 0, 110))
draw.text((x, wy), word, font=big, fill=(255, 255, 255, 255))
line1 = "Middelburg's food,"
line2 = 'delivered to your door.'
ty = wy + (wb[3] - wb[1]) + 46
draw.text((x + 2, ty + 2), line1, font=small, fill=(120, 20, 0, 90))
draw.text((x, ty), line1, font=small, fill=(255, 240, 228, 255))
draw.text((x + 2, ty + 54), line2, font=small, fill=(120, 20, 0, 90))
draw.text((x, ty + 52), line2, font=small, fill=(255, 240, 228, 255))
fg.convert('RGB').save(os.path.join(STORE, 'feature-graphic-1024x500.png'))

# --- Website icons: same mark, no wordmark (they are small) ------------------
for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png')]:
    compose(size, inset=0.08, with_word=False, background=gradient(size)).convert('RGB').save(os.path.join(WEB, name))
fav = compose(64, inset=0.06, with_word=False, background=gradient(64)).convert('RGB')
fav.save(os.path.join(WEB, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

print('wrote:', sorted(os.listdir(STORE)), 'and website icons')

# --- In-app logo lockups: scooter + wordmark side by side, transparent -------
# logo-white.png sits on the orange home-screen header; logo-terracotta.png on
# the cream sign-in screen. Drawn at 3x so they stay crisp on any phone.
def lockup(color, name, height=240):
    from PIL import ImageFont as _F
    scoot = scooter_cutout()
    sh_ = height
    scoot = scoot.resize((int(scoot.width * sh_ / scoot.height), sh_), Image.LANCZOS)
    tint = Image.new('RGBA', scoot.size, color + (255,))
    tint.putalpha(scoot.split()[3])
    font = _F.truetype(os.path.join(SRC, 'Poppins-ExtraBold.ttf'), int(height * 0.62))
    l, t, r, b = font.getbbox('MidFood')
    gap = int(height * 0.12)
    canvas = Image.new('RGBA', (scoot.width + gap + (r - l) + 8, height), (0, 0, 0, 0))
    canvas.alpha_composite(tint, (0, 0))
    ImageDraw.Draw(canvas).text((scoot.width + gap - l, (height - (b - t)) // 2 - t), 'MidFood', font=font, fill=color + (255,))
    canvas.save(os.path.join(HERE, 'assets', name))
    return canvas.size

print('logo-white', lockup((255, 255, 255), 'logo-white.png'))
print('logo-terracotta', lockup((217, 119, 87), 'logo-terracotta.png'))

# --- Social media kit (mobile/social/) ---------------------------------------
# profile-1080.png   square icon for Facebook / Instagram / TikTok profile pictures
# facebook-cover.png 1640 x 624 page cover: scooter, wordmark, promise, web address
SOCIAL = os.path.join(HERE, 'social')
os.makedirs(SOCIAL, exist_ok=True)
compose(1080, inset=0.12, background=gradient(1080)).convert('RGB').save(os.path.join(SOCIAL, 'profile-1080.png'))

def cover(path, W=1640, Hc=624):
    base = gradient(W, cy=0.5).crop((0, (W - Hc) // 2, W, (W - Hc) // 2 + Hc))
    img = Image.new('RGBA', (W, Hc), (0, 0, 0, 0))
    img.paste(base.convert('RGBA'))
    sc = scooter_cutout()
    sw = 520
    sc = sc.resize((sw, int(sc.height * sw / sc.width)), Image.LANCZOS)
    pos = (90, (Hc - sc.height) // 2)
    shd, _ = soft_shadow(sc, blur=16, opacity=0.35)
    img.alpha_composite(shd, (pos[0], pos[1] + 16))
    img.alpha_composite(sc, pos)
    d = ImageDraw.Draw(img)
    fp = os.path.join(SRC, 'Poppins-ExtraBold.ttf')
    f1 = ImageFont.truetype(fp, 128); f2 = ImageFont.truetype(fp, 40); f3 = ImageFont.truetype(fp, 38)
    x = 680
    d.text((x + 3, 150 + 4), 'MidFood', font=f1, fill=(120, 20, 0, 110))
    d.text((x, 150), 'MidFood', font=f1, fill=(255, 255, 255, 255))
    d.text((x + 2, 312), "Middelburg's food, delivered to your door", font=f2, fill=(120, 20, 0, 90))
    d.text((x, 310), "Middelburg's food, delivered to your door", font=f2, fill=(255, 240, 228, 255))
    # Pill with the web address.
    label = 'Order at midfood.co.za'
    lb = f3.getbbox(label)
    pw, ph = lb[2] - lb[0] + 64, lb[3] - lb[1] + 36
    py = 400
    d.rounded_rectangle((x, py, x + pw, py + ph), radius=ph // 2, fill=(255, 255, 255, 255))
    d.text((x + 32 - lb[0], py + 18 - lb[1]), label, font=f3, fill=(176, 32, 0, 255))
    img.convert('RGB').save(path)

cover(os.path.join(SOCIAL, 'facebook-cover-1640x624.png'))
print('social kit:', sorted(os.listdir(SOCIAL)))
