import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const browser = await chromium.launch()
const shots = []
for (const [w, h] of [[360, 740], [520, 720]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await page.goto(`http://127.0.0.1:8124/games/feel-cari.html?lang=ko`); await page.waitForTimeout(300)
  await page.evaluate(() => { window.MGBridge.submit = () => {} })
  await page.screenshot({ path: `tmp/_fto-${w}-1.png` })
  await page.click('#startBtn'); await page.waitForTimeout(150)
  await page.screenshot({ path: `tmp/_fto-${w}-2.png` })
  await page.evaluate(() => { $('brOv').classList.add('hidden'); loadLevel(); stop(); buildTable(); $('tblOv').classList.remove('hidden') }); await page.waitForTimeout(120)
  await page.screenshot({ path: `tmp/_fto-${w}-3.png` })
  await page.evaluate(() => { $('tblOv').classList.add('hidden'); cleared = 7; showResult() }); await page.waitForTimeout(150)
  await page.screenshot({ path: `tmp/_fto-${w}-4.png` })
  shots.push(w)
  await page.close()
}
await browser.close()
execSync(`python - <<'PY'
from PIL import Image
rows=[]
for w in (360,520):
    ims=[Image.open(f'tmp/_fto-{w}-{i}.png') for i in (1,2,3,4)]
    W=sum(i.width for i in ims)+8*3; H=max(i.height for i in ims)
    row=Image.new('RGB',(W,H),(20,22,30)); x=0
    for i in ims: row.paste(i,(x,0)); x+=i.width+8
    rows.append(row)
W=max(r.width for r in rows); H=sum(r.height for r in rows)+12
out=Image.new('RGB',(W,H),(20,22,30)); y=0
for r in rows: out.paste(r,(0,y)); y+=r.height+12
out.save('tmp/_fe-ovs.jpg',quality=85); print(out.size)
PY`, { stdio: 'inherit', shell: 'bash' })
