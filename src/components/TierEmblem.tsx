// 진화형 티어 엠블렘 (목업 mockups/index.html 이식).
// IRON(젬) → BRONZE(링) → SILVER(스파이크) → GOLD(왕관+글로우)
// → PLATINUM(날개) → DIAMOND → MASTER(오라까지) 로 단계적으로 화려해진다.

type RGB = [number, number, number]
const h2r = (h: string): RGB =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
const r2h = (a: number[]): string =>
  '#' +
  a
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')
const mix = (a: string, b: string, t: number) =>
  r2h(h2r(a).map((v, i) => v + (h2r(b)[i] - v) * t))
const lt = (c: string, t: number) => mix(c, '#ffffff', t)
const dk = (c: string, t: number) => mix(c, '#000000', t)
const P = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`
function hexPts(cx: number, cy: number, r: number): [number, number][] {
  const p: [number, number][] = []
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return p
}

function gem(
  cx: number,
  cy: number,
  r: number,
  color: string,
  bright: number,
  rough: boolean,
): string {
  const v = hexPts(cx, cy, r)
  let f = ''
  for (let i = 0; i < 6; i++) {
    const a = v[i]
    const b = v[(i + 1) % 6]
    const sh = i % 2 === 0 ? lt(color, bright + 0.12) : dk(color, bright - 0.02)
    f += `<polygon points="${cx},${cy} ${P(a[0], a[1])} ${P(b[0], b[1])}" fill="${sh}" stroke="rgba(0,0,0,.12)" stroke-width=".6"/>`
  }
  const shine = `<polygon points="${cx},${cy} ${P(v[5][0], v[5][1])} ${P(
    v[0][0],
    v[0][1],
  )} ${P(v[1][0], v[1][1])}" fill="#fff" opacity="${rough ? 0.05 : 0.16}"/>`
  const crack = rough
    ? `<path d="M${cx - 3} ${cy - r + 5} L${cx + 2} ${cy} L${cx - 2} ${cy + 6}" stroke="rgba(0,0,0,.3)" stroke-width="1" fill="none"/>`
    : ''
  return `<polygon points="${hexPts(cx, cy, r + 2)
    .map((q) => P(q[0], q[1]))
    .join(' ')}" fill="${dk(color, 0.3)}"/>${f}${shine}${crack}<polygon points="${v
    .map((q) => P(q[0], q[1]))
    .join(' ')}" fill="none" stroke="${lt(color, 0.4)}" stroke-width="1" opacity=".7"/>`
}
function spikes(
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  n: number,
  color: string,
): string {
  if (!n) return ''
  let s = `<circle cx="${cx}" cy="${cy}" r="${rIn + 1}" fill="${dk(color, 0.34)}"/>`
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n
    const w = (Math.PI / n) * 0.62
    const p1 = [cx + rIn * Math.cos(a - w), cy + rIn * Math.sin(a - w)]
    const tip = [cx + rOut * Math.cos(a), cy + rOut * Math.sin(a)]
    const p2 = [cx + rIn * Math.cos(a + w), cy + rIn * Math.sin(a + w)]
    s += `<polygon points="${P(p1[0], p1[1])} ${P(tip[0], tip[1])} ${P(
      p2[0],
      p2[1],
    )}" fill="${i % 2 ? lt(color, 0.18) : dk(color, 0.12)}" stroke="${dk(
      color,
      0.28,
    )}" stroke-width=".5"/>`
  }
  return s
}
function crown(cx: number, baseY: number, n: number, color: string, scale: number): string {
  if (!n) return ''
  const spread = 6.4 * scale
  const mid = (n - 1) / 2
  let s = ''
  for (let i = 0; i < n; i++) {
    const dx = (i - mid) * spread
    const h = scale * (15 - Math.abs(i - mid) * 3)
    const x = cx + dx
    s += `<polygon points="${P(x - spread * 0.5, baseY)} ${P(x, baseY - h)} ${P(
      x + spread * 0.5,
      baseY,
    )}" fill="${lt(color, 0.32)}" stroke="${dk(color, 0.25)}" stroke-width=".6"/><circle cx="${x}" cy="${(
      baseY -
      h -
      1
    ).toFixed(1)}" r="${(1.3 * scale).toFixed(1)}" fill="${lt(color, 0.5)}"/>`
  }
  return s
}
function wings(
  cx: number,
  cy: number,
  count: number,
  color: string,
  glowId: string | null,
): string {
  if (!count) return ''
  const Fr = [
    [10, 4, 30, 0, 46, -8, 6],
    [10, -2, 28, -6, 42, -15, 5.5],
    [10, -8, 24, -12, 36, -21, 5],
    [10, -14, 20, -18, 30, -27, 4.5],
  ]
  const draw = (dir: number) => {
    let s = ''
    for (let k = 0; k < count; k++) {
      const f = Fr[k]
      const mx = (val: number) => cx + dir * val
      const my = (val: number) => cy + val
      const d = `M${P(mx(f[0]), my(f[1]))} Q${P(mx(f[2]), my(f[3]))} ${P(
        mx(f[4]),
        my(f[5]),
      )}`
      s += `<path d="${d}" fill="none" stroke="${dk(color, 0.22)}" stroke-width="${
        f[6] + 1.5
      }" stroke-linecap="round"/>`
      s += `<path d="${d}" fill="none" stroke="${lt(color, 0.34)}" stroke-width="${f[6]}" stroke-linecap="round"/>`
    }
    return s
  }
  const g = glowId
    ? `<g filter="url(#${glowId})" opacity=".8">${draw(1)}${draw(-1)}</g>`
    : ''
  return g + draw(1) + draw(-1)
}

interface Cfg {
  c: string
  spk: number
  wing: number
  crown: number
  glow: number
  rough?: boolean
  bright: number
  gemR: number
  aura?: boolean
}
const CFG: Record<string, Cfg> = {
  iron: { c: '#8b9099', spk: 0, wing: 0, crown: 0, glow: 0, rough: true, bright: 0.1, gemR: 23 },
  bronze: { c: '#b8763e', spk: 0, wing: 0, crown: 0, glow: 0, bright: 0.16, gemR: 23 },
  silver: { c: '#aeb9c8', spk: 8, wing: 0, crown: 0, glow: 0, bright: 0.2, gemR: 22 },
  gold: { c: '#e3b23c', spk: 12, wing: 0, crown: 3, glow: 1, bright: 0.24, gemR: 23 },
  platinum: { c: '#3fb8ad', spk: 12, wing: 2, crown: 3, glow: 2, bright: 0.26, gemR: 23 },
  diamond: { c: '#4aa0e8', spk: 14, wing: 3, crown: 5, glow: 3, bright: 0.3, gemR: 24 },
  master: { c: '#a566e0', spk: 16, wing: 4, crown: 7, glow: 4, bright: 0.34, gemR: 24, aura: true },
}

let counter = 0
function emblemSvg(cfg: Cfg, id: string, size: number): string {
  const cx = 60
  const cy = 64
  const c = cfg.c
  const glowId = `gw${id}`
  let defs = `<defs>`
  if (cfg.glow)
    defs += `<filter id="${glowId}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${
      1.5 + cfg.glow
    }"/></filter>`
  defs += `<filter id="sh${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.2" flood-color="${dk(
    c,
    0.45,
  )}" flood-opacity=".5"/></filter></defs>`
  let b = ''
  if (cfg.glow)
    b += `<circle cx="${cx}" cy="${cy}" r="${22 + cfg.glow * 5}" fill="${c}" opacity="${
      0.07 * cfg.glow
    }" filter="url(#${glowId})"/>`
  if (cfg.aura)
    b += `<circle cx="${cx}" cy="${cy}" r="42" fill="none" stroke="${lt(
      c,
      0.55,
    )}" stroke-width="5" opacity=".22" filter="url(#${glowId})"/>`
  b += wings(cx, cy + 2, cfg.wing, c, cfg.glow >= 4 ? glowId : null)
  b += crown(cx, cy - cfg.gemR + 4, cfg.crown, c, 1 + (cfg.glow >= 3 ? 0.25 : 0))
  b += spikes(cx, cy, cfg.gemR + 3, cfg.gemR + 3 + (7 + cfg.spk * 0.4), cfg.spk, c)
  b += gem(cx, cy, cfg.gemR, c, cfg.bright, cfg.rough ?? false)
  // xmlns 필수 — 이 마크업을 data: URL <img> 로 래스터화하는 경로(공유 카드)가 있어서,
  // 없으면 인라인(dangerouslySetInnerHTML)에서는 보이는데 카드에서만 조용히 안 그려진다.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 124" width="${size}" height="${size}">${defs}<g filter="url(#sh${id})">${b}</g></svg>`
}

// 엠블렘 SVG 문자열(자립형 — 외부 이미지/폰트 참조 없음).
// 공유 카드(lib/shareCard.ts)가 이걸 <img> 로 래스터화해 캔버스에 얹는다.
// SVG-in-img 는 외부 리소스를 못 불러오므로 이 마크업은 반드시 자립형을 유지할 것.
// eslint-disable-next-line react-refresh/only-export-components
export function emblemSvgMarkup(tierKey: string | null | undefined, size: number): string {
  const cfg = CFG[tierKey ?? 'iron'] ?? CFG.iron
  return emblemSvg(cfg, `${tierKey ?? 'iron'}_${counter++}`, size)
}

export default function TierEmblem({
  tierKey,
  size = 92,
}: {
  tierKey: string | null | undefined
  size?: number
}) {
  const cfg = CFG[tierKey ?? 'iron'] ?? CFG.iron
  const id = `${tierKey ?? 'iron'}_${counter++}`
  return (
    <span
      style={{ display: 'inline-block', lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: emblemSvg(cfg, id, size) }}
    />
  )
}
