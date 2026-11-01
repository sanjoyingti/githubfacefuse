# Original "double-biceps flex" silhouette icon for Thong Nokbe Gym. Usage: python3 flex.py <out_dir>
import sys
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]
BLACK = (24, 24, 27, 255); RED = (239, 50, 36, 255); WHITE = (255, 255, 255, 255)

def figure(size, scale=1.0, dy=0.0):
    S = 4; W = size * S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = W * scale; ox = W / 2; oy = W / 2 + dy * W
    P = lambda x, y: (ox + (x - 0.5) * s, oy + (y - 0.5) * s)
    def poly(pts, fill): d.polygon([P(*p) for p in pts], fill=fill)
    def circ(x, y, r, fill): cx, cy = P(x, y); R = r * s; d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=fill)
    def ell(x, y, rx, ry, fill): cx, cy = P(x, y); d.ellipse([cx - rx * s, cy - ry * s, cx + rx * s, cy + ry * s], fill=fill)
    def limb(a, b, w, fill):
        d.line([P(*a), P(*b)], fill=fill, width=int(w * s)); circ(*a, w / 2, fill); circ(*b, w / 2, fill)
    def stroke(pts, w=0.012, fill=WHITE):
        d.line([P(*p) for p in pts], fill=fill, width=int(w * s), joint='curve')
        for p in (pts[0], pts[-1]): circ(*p, w / 2, fill)

    def arm(sg, col):
        X = lambda x: 0.5 + sg * (x - 0.5)
        # upper arm: shoulder -> elbow, thick, slightly tapered
        poly([(X(0.31), 0.33), (X(0.30), 0.45), (X(0.15), 0.445), (X(0.105), 0.43), (X(0.10), 0.37), (X(0.16), 0.34)], col)
        ell(X(0.215), 0.335, 0.085, 0.072, col)                       # biceps peak
        # forearm: elbow -> wrist, tapering upward
        poly([(X(0.075), 0.41), (X(0.165), 0.40), (X(0.225), 0.215), (X(0.16), 0.205)], col)
        circ(X(0.12), 0.405, 0.036, col)                              # elbow
        fx, fy = P(X(0.19), 0.175); fw, fh = 0.05 * s, 0.045 * s     # fist (rounded square)
        d.rounded_rectangle([fx - fw, fy - fh, fx + fw, fy + fh], radius=0.02 * s, fill=col)
        k = [(X(0.155), 0.168), (X(0.225), 0.168)]                    # knuckle line
        d.line([P(*k[0]), P(*k[1])], fill=WHITE, width=int(0.008 * s))

    arm(1, BLACK); arm(-1, RED)
    # torso with lat flare (V-taper)
    poly([(0.44, 0.29), (0.56, 0.29), (0.66, 0.32), (0.735, 0.38), (0.735, 0.46), (0.68, 0.56), (0.63, 0.66),
          (0.615, 0.78), (0.5, 0.86), (0.385, 0.78), (0.37, 0.66), (0.32, 0.56), (0.265, 0.46), (0.265, 0.38), (0.34, 0.32)], BLACK)
    circ(0.29, 0.40, 0.088, BLACK)                                    # left deltoid
    circ(0.712, 0.402, 0.08, RED)                                      # right deltoid (red side)
    # neck + head
    poly([(0.455, 0.24), (0.545, 0.24), (0.565, 0.31), (0.435, 0.31)], BLACK)
    ell(0.5, 0.195, 0.06, 0.075, BLACK)
    ell(0.5, 0.155, 0.062, 0.045, BLACK)                              # hair
    # muscle definition (white cut lines)
    stroke([(0.33, 0.49), (0.34, 0.50), (0.40, 0.52), (0.46, 0.52), (0.50, 0.505)], 0.013)
    stroke([(0.67, 0.49), (0.66, 0.50), (0.60, 0.52), (0.54, 0.52), (0.50, 0.505)], 0.013)
    stroke([(0.50, 0.40), (0.50, 0.505)], 0.010)
    stroke([(0.50, 0.55), (0.50, 0.79)], 0.010)
    for y, hw in ((0.585, 0.07), (0.65, 0.065), (0.715, 0.055)):
        stroke([(0.50 - hw, y + 0.008), (0.50 - 0.03, y - 0.004), (0.50 - 0.01, y)], 0.011)
        stroke([(0.50 + hw, y + 0.008), (0.50 + 0.03, y - 0.004), (0.50 + 0.01, y)], 0.011)
    stroke([(0.39, 0.56), (0.40, 0.64), (0.415, 0.73)], 0.010)
    stroke([(0.61, 0.56), (0.60, 0.64), (0.585, 0.73)], 0.010)
    stroke([(0.23, 0.39), (0.285, 0.40)], 0.010)
    stroke([(0.77, 0.39), (0.715, 0.40)], 0.010)
    stroke([(0.455, 0.31), (0.50, 0.345), (0.545, 0.31)], 0.009)     # collar bones
    return img.resize((size, size), Image.LANCZOS)

def shadow_under(size, y=0.9, w=0.5, h=0.035):
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([size * (0.5 - w / 2), size * (y - h / 2), size * (0.5 + w / 2), size * (y + h / 2)], fill=(0, 0, 0, 70))
    return sh.filter(ImageFilter.GaussianBlur(size * 0.015))

def bg(size):
    img = Image.new('RGBA', (size, size), (250, 250, 250, 255))
    return img

icon = bg(1024); icon.alpha_composite(shadow_under(1024)); icon.alpha_composite(figure(1024, 1.0, -0.02))
icon.convert('RGB').save(f'{out}/icon.png')
Image.new('RGBA', (512, 512), (250, 250, 250, 255)).save(f'{out}/android-icon-background.png')
fg = Image.new('RGBA', (512, 512), (0, 0, 0, 0)); fg.alpha_composite(figure(512, 0.62, 0.0)); fg.save(f'{out}/android-icon-foreground.png')
mono = figure(432, 0.62); m = Image.new('RGBA', mono.size, (255, 255, 255, 0)); m.putalpha(mono.split()[3]); m.save(f'{out}/android-icon-monochrome.png')
logo = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
ImageDraw.Draw(logo).ellipse([112, 112, 912, 912], fill=(250, 250, 250, 255))
logo.alpha_composite(figure(1024, 0.72, 0.0)); logo.save(f'{out}/logo.png'); logo.save(f'{out}/splash-icon.png')
icon.resize((48, 48), Image.LANCZOS).save(f'{out}/favicon.png')
print('ok')
