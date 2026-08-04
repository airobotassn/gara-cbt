import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import type { ListAttemptsResponse, LevelCertData } from '../lib/testTypes'

// ===== 레벨테스트 인증서 =====
// 시안 원본 = public/cert-preview.html(정적). 좌표·에셋은 그대로 옮겨왔고, **값만 서버에서 받는다**.
//   · 이름  = profiles.display_name
//   · 레벨  = user_progress.rank (도달 레벨까지만 금색으로 켜진다)
//   · 발자취 = 레벨별 최초 도달일 (Lv.1 = 첫 응시일, Lv.2~7 = 승급 기록의 가장 이른 제출일)
// ⚠️ URL 파라미터(?level=7)로 그리지 않는 게 핵심 — 공유·자랑용이라 위조가 쉬우면 인증서가 무의미하다.
// 에셋은 public/cert/*.png 공용(정적 시안과 같은 파일).

// 북두칠성 좌표 = 원본 dipper.png(1122×1402)의 링 중심 픽셀 측정값. 건드리지 말 것.
const NODES = [
  { n: 1, x: 992, y: 923 }, { n: 2, x: 776, y: 1158 }, { n: 3, x: 454, y: 975 },
  { n: 4, x: 538, y: 715 }, { n: 5, x: 463, y: 488 }, { n: 6, x: 279, y: 296 },
  { n: 7, x: 99, y: 123 },
]
const EDGES: [number, number][] = [[1, 2], [2, 3], [3, 4], [4, 1], [4, 5], [5, 6], [6, 7]] // 국자 + 손잡이
const R = 28
const ROTC = { x: 546, y: 665 }
const ROT = -12
const VB = { w: 1448, h: 900 } // 인증서 고정 좌표계

const NEI: Record<number, number[]> = {}
EDGES.forEach(([a, b]) => { (NEI[a] = NEI[a] || []).push(b); (NEI[b] = NEI[b] || []).push(a) })
const at = (n: number) => NODES.find((p) => p.n === n)!

// 이웃 반대 방향 = 날짜를 놓을 바깥쪽
function outward(p: { n: number; x: number; y: number }) {
  let vx = 0, vy = 0
  ;(NEI[p.n] || []).forEach((n) => {
    const q = at(n), dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1
    vx += dx / L; vy += dy / L
  })
  const L = Math.hypot(vx, vy)
  if (L < 0.02) return { x: 0, y: 1 }
  return { x: -vx / L, y: -vy / L }
}

// 기울인 콘텐츠의 bbox 로 viewBox 를 잡는다 → 돌려도 틀 안에 딱 맞음
function fitViewBox(): string {
  const rad = (ROT * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad)
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9
  NODES.forEach((p) => {
    const pad = R + 18, u = outward(p), D = R + 34, TW = 205
    const lx = u.x * D, ly = u.y * D + 9
    const l0 = u.x > 0.35 ? lx : u.x < -0.35 ? lx - TW : lx - TW / 2
    const l1 = l0 + TW
    ;([[-pad, -pad], [pad, -pad], [-pad, pad], [pad, pad],
      [l0, ly + 10], [l1, ly + 10], [l0, ly - 28], [l1, ly - 28]] as [number, number][]).forEach(([ox, oy]) => {
      const x = p.x + ox - ROTC.x, y = p.y + oy - ROTC.y
      const rx = ROTC.x + x * cos - y * sin, ry = ROTC.y + x * sin + y * cos
      if (rx < minx) minx = rx; if (rx > maxx) maxx = rx
      if (ry < miny) miny = ry; if (ry > maxy) maxy = ry
    })
  })
  return `${minx} ${miny} ${maxx - minx} ${maxy - miny}`
}

// ISO → "2026 · 03 · 02"
function fmtMilestone(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()} · ${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getDate()).padStart(2, '0')}`
}

function Dipper({ level, milestones }: { level: number; milestones: Record<string, string> }) {
  const viewBox = useMemo(fitViewBox, [])
  const lit = (n: number) => n <= level
  const GAP = R + 12

  return (
    <svg className="lc-dip" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="lc-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6d9" /><stop offset=".30" stopColor="#f6de9e" />
          <stop offset=".52" stopColor="#e8bf65" /><stop offset=".76" stopColor="#c99433" />
          <stop offset="1" stopColor="#f0d489" />
        </linearGradient>
        {/* 미달성 레벨 = 채도를 뺀 은색(금=획득 / 은=미획득) */}
        <filter id="lc-ash" x="-30%" y="-30%" width="160%" height="160%">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="1.18" /><feFuncG type="linear" slope="1.2" /><feFuncB type="linear" slope="1.3" />
          </feComponentTransfer>
        </filter>
      </defs>

      <g transform={`rotate(${ROT} ${ROTC.x} ${ROTC.y})`}>
        {/* ① 연결선 — 각인 선 조각을 구간마다 회전·신축. 링 앞에서 끊어 여백을 준다 */}
        {EDGES.map(([a, b]) => {
          const p = at(a), q = at(b), on = lit(a) && lit(b)
          const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy)
          const seg = len - GAP * 2, th = 9
          const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
          const deg = (Math.atan2(dy, dx) * 180) / Math.PI
          return (
            <image
              key={`e${a}-${b}`} href="/cert/edge.png" x={-seg / 2} y={-th / 2} width={seg} height={th}
              preserveAspectRatio="none" opacity={on ? 1 : 0.62} filter={on ? undefined : 'url(#lc-ash)'}
              transform={`translate(${mx},${my}) rotate(${deg})`}
            />
          )
        })}

        {/* ② 발광 별 — flare 의 빛 중심이 (0.502, 0.371) 이라 그만큼 보정 */}
        {NODES.filter((p) => lit(p.n)).map((p) => {
          const s = 430
          return <image key={`f${p.n}`} href="/cert/flare-gold.png" x={p.x - s * 0.502} y={p.y - s * 0.371} width={s} height={s} />
        })}

        {/* ③ 링 + 숫자 + 취득일 — 레벨과 무관하게 항상 같은 좌표, 글자만 수평 유지 */}
        {NODES.map((p) => {
          const on = lit(p.n)
          const rw = (637 / 630) * (R * 2.45), rh = R * 2.45
          const u = outward(p), D = R + 34
          const lx = p.x + u.x * D, ly = p.y + u.y * D + 9
          const anchor = u.x > 0.35 ? 'start' : u.x < -0.35 ? 'end' : 'middle'
          const date = on ? fmtMilestone(milestones[String(p.n)]) : null
          return (
            <g key={`n${p.n}`}>
              <circle cx={p.x} cy={p.y} r={R} fill="rgba(3,11,20,.72)" />
              <image href="/cert/node.png" x={p.x - rw / 2} y={p.y - rh / 2} width={rw} height={rh}
                opacity={on ? 1 : 0.72} filter={on ? undefined : 'url(#lc-ash)'} />
              <text x={p.x} y={p.y + 11} textAnchor="middle" fontFamily="CertSerifKR,serif" fontSize={32}
                fontWeight={on ? 700 : 500} fill={on ? '#fff4dd' : 'rgba(206,216,230,.82)'}
                transform={`rotate(${-ROT} ${p.x} ${p.y})`}>{p.n}</text>
              {date && (
                <text x={lx} y={ly} textAnchor={anchor} fontFamily="CertSerifKR,serif" fontSize={26}
                  letterSpacing={1.8} fontWeight={400} fill="url(#lc-gold)"
                  transform={`rotate(${-ROT} ${lx} ${ly})`}>{date}</text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

export default function LevelCert() {
  const navigate = useNavigate()
  const { t } = useT()
  const { isFullUser, loading: authLoading } = useAuth()
  const [data, setData] = useState<LevelCertData | null>(null)
  const [state, setState] = useState<'load' | 'ok' | 'empty' | 'err'>('load')
  const stageRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (authLoading) return
    if (!isFullUser) { setState('empty'); return }
    callFunction<ListAttemptsResponse>('list-attempts', {})
      .then((r) => {
        if (r.certificate) { setData(r.certificate); setState('ok') } else setState('empty')
      })
      .catch(() => setState('err'))
  }, [authLoading, isFullUser])

  // 1448×900 고정 좌표계를 뷰포트 폭에 맞춰 축소(확대는 안 한다). 정적 시안과 같은 방식.
  useEffect(() => {
    function fit() {
      const st = stageRef.current, wr = wrapRef.current
      if (!st || !wr) return
      const s = Math.min(1, (wr.clientWidth - 8) / VB.w)
      st.style.transform = `scale(${s})`
      wr.style.height = `${VB.h * s}px`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [state])

  if (state === 'load') {
    return <div className="lc-page"><p className="lc-msg">{t('common.loading')}</p></div>
  }
  if (state !== 'ok' || !data) {
    return (
      <div className="lc-page">
        <div className="lc-empty">
          <span className="material-symbols-outlined">workspace_premium</span>
          <p>{state === 'err' ? t('lcert.load_failed') : t('lcert.empty')}</p>
          <div className="lc-acts">
            <button className="lc-btn" onClick={() => navigate('/test/select')}>{t('lcert.go_test')}</button>
          </div>
        </div>
      </div>
    )
  }

  // 닉네임 미설정이면 자리를 비우지 않고 기본 표기를 쓴다(인증서에 빈 줄이 남지 않게).
  const name = (data.displayName || t('lcert.no_name')).slice(0, 12)
  const level = Math.min(7, Math.max(1, data.level))

  return (
    <div className="lc-page">
      <div className="lc-wrap" ref={wrapRef}>
        <div className="lc-stage" ref={stageRef}>
          <img className="lc-bg" src="/cert/bg.png" alt="" />
          <div className="lc-vig" />

          <img className="lc-orn tl" src="/cert/corner.png" alt="" />
          <img className="lc-orn tr" src="/cert/corner.png" alt="" />
          <img className="lc-orn bl" src="/cert/corner.png" alt="" />
          <img className="lc-orn br" src="/cert/corner.png" alt="" />

          <div className="lc-col">
            <img className="lc-brand" src="/cert/logo-gara.png" alt="GARA" />
            <img className="lc-title" src="/cert/title-word.png" alt="LEVEL TEST CERTIFICATE" />
            <div className="lc-name">{name}</div>
            <div className="lc-mark">
              <img className="lc-mark-cap" src="/cert/level-word.png" alt="LEVEL" />
              <img className="lc-mark-num" src={`/cert/num-${level}.png`} alt={String(level)} />
            </div>
            {/* 발행기관 — 기관 정식명은 번역하지 않고 영문 고정(증서 관행) */}
            <div className="lc-issuer">Global AI &amp; Robotics Association</div>
          </div>

          <div className="lc-dipbox">
            <Dipper level={level} milestones={data.milestones} />
          </div>
        </div>
      </div>

      <div className="lc-acts">
        <button className="lc-btn primary" onClick={() => window.print()}>{t('lcert.print')}</button>
        <button className="lc-btn" onClick={() => navigate(-1)}>{t('cert.back')}</button>
      </div>
    </div>
  )
}
