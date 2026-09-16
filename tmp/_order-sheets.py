from PIL import Image, ImageDraw, ImageFont
import glob
font = ImageFont.truetype('C:/Windows/Fonts/malgunbd.ttf', 26)
files = sorted(glob.glob('tmp/_od-L*.png'))
S = 0.5
for a in range(0, 20, 5):
    ims = [Image.open(f) for f in files[a:a+5]]
    W = int(460*2*S); H = max(int(im.height*S) for im in ims)
    sheet = Image.new('RGB', (W*5+60, H+50), (20, 22, 30)); dr = ImageDraw.Draw(sheet)
    for c, im in enumerate(ims):
        dr.text((10+c*(W+10), 8), f'주문 {a+c+1}', font=font, fill=(230, 200, 120))
        sheet.paste(im.resize((int(im.width*S), int(im.height*S)), Image.LANCZOS), (10+c*(W+10), 40))
    out = f'tmp/order20-{a+1}-{a+5}.jpg'; sheet.save(out, quality=86); print(out, sheet.size)
