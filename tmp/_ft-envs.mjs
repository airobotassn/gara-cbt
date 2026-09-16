// 구역 전체 환경(2 깜깜함 · 4 햇빛 · 8 연기)에서 센서를 켜고 조금 달린 화면 — 로봇·센서 점이 어둠·햇빛에 물들지 않는지
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const browser = await chromium.launch()
for (const z of [2, 4, 8]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 })
  await page.goto('http://127.0.0.1:8124/games/feel-cari.html?lang=ko'); await page.waitForTimeout(300)
  await page.evaluate(() => { window.MGBridge.submit = () => {} })
  await page.click('#startBtn'); await page.waitForTimeout(100)
  await page.evaluate((z) => { $('brOv').classList.add('hidden'); LI = z - 1; loadLevel(); document.querySelector('.s[data-k=lidar]').click(); document.querySelector('.s[data-k=ultra]').click(); joyX = 0; joyY = 1 }, z)
  await page.waitForTimeout(1500)
  await page.evaluate(() => { joyX = 1; joyY = 0 }); await page.waitForTimeout(900)
  const cls = await page.evaluate(() => { joyX = 0; joyY = 0; stop(); return document.getElementById('view').className })
  console.log(z, cls)
  const box = await page.evaluate(() => { const v = document.getElementById('view').getBoundingClientRect(); return { x: v.left, y: v.top, width: v.width, height: v.height } })
  await page.screenshot({ path: `tmp/_ft-env${z}.png`, clip: box })
  await page.close()
}
await browser.close()
execSync(`python - <<'PY'
from PIL import Image
ims=[Image.open(f'tmp/_ft-env{z}.png') for z in (2,4,8)]
W=sum(i.width for i in ims)+16; H=max(i.height for i in ims)
out=Image.new('RGB',(W,H),(20,22,30)); x=0
for i in ims: out.paste(i,(x,0)); x+=i.width+8
out.save('tmp/_fe-envs.jpg',quality=86); print(out.size)
PY`, { stdio: 'inherit', shell: 'bash' })
