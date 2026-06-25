// 자격증 템플릿(public/cert-template.png)의 라벨 줄 y위치(%)를 픽셀로 검출.
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const buf = readFileSync('C:/Users/User/gara-cbt/public/cert-template.png')
let pos = 8
let width = 0, height = 0, colorType = 0, interlace = 0
const idat = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos); pos += 4
  const type = buf.toString('ascii', pos, pos + 4); pos += 4
  const data = buf.subarray(pos, pos + len); pos += len
  pos += 4
  if (type === 'IHDR') {
    width = data.readUInt32BE(0); height = data.readUInt32BE(4)
    colorType = data[9]; interlace = data[12]
  } else if (type === 'IDAT') idat.push(data)
  else if (type === 'IEND') break
}
if (interlace !== 0) { console.log('interlaced PNG — 미지원'); process.exit(1) }
const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
if (!ch) { console.log('colorType', colorType, '미지원'); process.exit(1) }
const stride = width * ch
const raw = inflateSync(Buffer.concat(idat))
const px = Buffer.alloc(height * stride)
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
let rp = 0
for (let y = 0; y < height; y++) {
  const ft = raw[rp++]
  for (let x = 0; x < stride; x++) {
    const v = raw[rp++]
    const a = x >= ch ? px[y * stride + x - ch] : 0
    const b = y > 0 ? px[(y - 1) * stride + x] : 0
    const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0
    let val = v
    if (ft === 1) val = v + a
    else if (ft === 2) val = v + b
    else if (ft === 3) val = v + ((a + b) >> 1)
    else if (ft === 4) val = v + paeth(a, b, c)
    px[y * stride + x] = val & 0xff
  }
}
// 라벨 영역(가로 38~53%)에서 진한(네이비) 텍스트 줄 검출
const x0 = Math.floor(width * 0.38), x1 = Math.floor(width * 0.53)
const rows = new Array(height).fill(0)
for (let y = 0; y < height; y++) {
  let dark = 0
  for (let x = x0; x < x1; x++) {
    const i = y * stride + x * ch
    const r = px[i], g = px[i + 1] ?? r, b = px[i + 2] ?? r
    if (r < 120 && g < 120 && b < 160) dark++
  }
  rows[y] = dark
}
// 필드 라벨 구간(28~68%)만 따로
const yA = Math.floor(height * 0.30), yB = Math.floor(height * 0.72)
let localMax = 0
for (let y = yA; y < yB; y++) localMax = Math.max(localMax, rows[y])
const th = Math.max(2, localMax * 0.18)
const bands = []
let s = -1
for (let y = yA; y < yB; y++) {
  if (rows[y] > th) { if (s < 0) s = y } else if (s >= 0) { bands.push([s, y - 1]); s = -1 }
}
if (s >= 0) bands.push([s, yB - 1])
console.log(`PNG ${width}x${height} ch=${ch}  필드구간 localMax=${localMax} th=${th.toFixed(0)}`)
console.log('필드 라벨 줄 (가운데 y%):')
for (const [a, b] of bands) {
  if (b - a < 3) continue
  console.log(`  y ${a}-${b}  →  ${((a + b) / 2 / height * 100).toFixed(1)}%`)
}
