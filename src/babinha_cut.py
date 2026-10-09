# Cuts the Babinha poses out of the user's art and removes the grey background.
import sys, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
U = sys.argv[1]; OUT = sys.argv[2]
sheet = f'{U}/661c34d5-image.jpg'
k = 2576 / 1998
jobs = {
  'wave':    (sheet, [100, 150, 700, 672]),
  'side':    (sheet, [800, 150, 1180, 672]),
  'run':     (sheet, [1310, 150, 1950, 652]),
  'happy':   (sheet, [170, 700, 520, 1050]),
  'worried': (sheet, [815, 700, 1170, 1050]),
  'wink':    (sheet, [1550, 700, 1900, 1050]),
  'money':   (f'{U}/336aee9f-image.jpg', None),
  'scared':  (f'{U}/50a0affb-image.jpg', None),
  'coach':   (f'{U}/27d0b464-image.jpg', None),
}
for name, (src, box) in jobs.items():
    im = Image.open(src).convert('RGB')
    if box: im = im.crop(tuple(int(v * k) for v in box))
    a = np.asarray(im).astype(int)
    lum = a.mean(axis=2); sat = a.max(axis=2) - a.min(axis=2)
    bgish = (lum > 178) & (sat < 28)
    lab, _ = ndimage.label(bgish)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    # also drop the soft drop-shadow / motion lines that are faint grey and touch the background
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # feather the cut by one pixel
    al = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.8))
    rgba = im.copy(); rgba.putalpha(al)
    bb = Image.fromarray(alpha).getbbox()
    rgba = rgba.crop((max(bb[0]-6,0), max(bb[1]-6,0), min(bb[2]+6, rgba.width), min(bb[3]+6, rgba.height)))
    target = 420
    s = target / max(rgba.size)
    rgba = rgba.resize((round(rgba.width * s), round(rgba.height * s)), Image.LANCZOS)
    rgba.save(f'{OUT}/{name}.webp', 'WEBP', quality=86, method=6)
    rgba.save(f'{OUT}/{name}.png')
    print(name, rgba.size)
