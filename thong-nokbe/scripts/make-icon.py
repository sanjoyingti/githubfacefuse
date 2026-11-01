# App icon from the owner's chosen image, used exactly as given (only placed on a square canvas of
# the image's own background colour and resized). Usage: python3 scripts/make-icon.py assets
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]
src = Image.open(f'{out}/brand-original.jpg').convert('RGBA')
BG = src.getpixel((5, 5))[:3]  # the image's own off-white background

def placed(size, fraction, bg=BG):
    """The original image, scaled to `fraction` of the square, centred on its background colour."""
    canvas = Image.new('RGBA', (size, size), bg + (255,) if bg else (0, 0, 0, 0))
    w, h = src.size
    k = size * fraction / max(w, h)
    img = src.resize((round(w * k), round(h * k)), Image.LANCZOS)
    canvas.alpha_composite(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas

placed(1024, 1.0).convert('RGB').save(f'{out}/icon.png')
Image.new('RGBA', (512, 512), BG + (255,)).save(f'{out}/android-icon-background.png')
placed(512, 0.66, None).save(f'{out}/android-icon-foreground.png')  # inside Android's safe zone
logo = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
mask = Image.new('L', (1024, 1024), 0); ImageDraw.Draw(mask).ellipse([112, 112, 912, 912], fill=255)
badge = placed(1024, 0.62); badge.putalpha(mask); logo.alpha_composite(badge)
logo.save(f'{out}/logo.png'); logo.save(f'{out}/splash-icon.png')
placed(1024, 1.0).resize((48, 48), Image.LANCZOS).save(f'{out}/favicon.png')
print('ok', src.size, BG)
