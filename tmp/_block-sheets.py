# 막아라 검수 시트 — 하루 5장을 한 줄로, 두 날을 한 장에 (총 5장)
from PIL import Image, ImageDraw, ImageFont
import glob, re
font = ImageFont.truetype('C:/Windows/Fonts/malgunbd.ttf', 26)
days = {}
for f in glob.glob('tmp/_bd-[0-9]*-[0-9]*.png'):
    d, i = map(int, re.findall(r'_bd-(\d+)-(\d+)', f)[0]); days.setdefault(d, {})[i] = f
S = 0.46
for a in range(1, 11, 2):
    rows = [a, a + 1]
    ims = {d: [Image.open(days[d][i]) for i in sorted(days[d])] for d in rows}
    W = int(460 * 2 * S); H = max(int(im.height * S) for d in rows for im in ims[d])
    sheet = Image.new('RGB', (W * 5 + 60, (H + 44) * 2 + 20), (20, 22, 30)); dr = ImageDraw.Draw(sheet)
    for r, d in enumerate(rows):
        y0 = 10 + r * (H + 44); dr.text((12, y0), f'{d}일차', font=font, fill=(230, 200, 120))
        for c, im in enumerate(ims[d]):
            im2 = im.resize((int(im.width * S), int(im.height * S)), Image.LANCZOS)
            sheet.paste(im2, (10 + c * (W + 10), y0 + 34))
    out = f'tmp/block50-{a}-{a+1}.jpg'; sheet.save(out, quality=86); print(out, sheet.size)
