# Cuts the new Babinha poses (v9.5.1) out of the user's art, same method as babinha_cut.py.
import sys, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
U = sys.argv[1]; OUT = sys.argv[2]
jobs = {'messi': 'Babinha Messi', 'arrogante': 'Babinha arrogante', 'aidentro': 'Babinha aí dentro', 'bike': 'Babinha bike',
        'calculante': 'Babinha calculante', 'carretilha': 'Babinha carretilha', 'chute': 'Babinha chute direto',
        'dancinha': 'Babinha dancinha', 'rezando': 'Babinha rezando', 'shhh': 'Babinha shhh'}
for name, fn in jobs.items():
    im = Image.open(f'{U}/{fn}.jpe').convert('RGB')
    a = np.asarray(im).astype(int)
    lum = a.mean(axis=2); sat = a.max(axis=2) - a.min(axis=2)
    bgish = (lum > 178) & (sat < 28)
    lab, _ = ndimage.label(bgish)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # drop tiny specks left in the background
    keep, n = ndimage.label(alpha > 0)
    sizes = ndimage.sum(np.ones_like(keep), keep, range(1, n + 1))
    small = np.isin(keep, [i + 1 for i, s in enumerate(sizes) if s < 400])
    alpha[small] = 0
    al = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.8))
    rgba = im.copy(); rgba.putalpha(al)
    bb = Image.fromarray(alpha).getbbox()
    rgba = rgba.crop((max(bb[0]-6,0), max(bb[1]-6,0), min(bb[2]+6, rgba.width), min(bb[3]+6, rgba.height)))
    s = 420 / max(rgba.size)
    rgba = rgba.resize((round(rgba.width * s), round(rgba.height * s)), Image.LANCZOS)
    rgba.save(f'{OUT}/{name}.webp', 'WEBP', quality=86, method=6)
    print(name, rgba.size)
