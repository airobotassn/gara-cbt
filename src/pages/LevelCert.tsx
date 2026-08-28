import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { qrMatrix } from '../lib/qr'
import type { ListAttemptsResponse, LevelCertData } from '../lib/testTypes'

// ===== 레벨테스트 인증서 =====
// 시안 원본 = public/cert-preview.html(정적). 좌표·에셋은 그대로 옮겨왔고, **값만 서버에서 받는다**.
//   · 이름  = profiles.display_name
//   · 레벨  = **취득한(깬) 최고 레벨**까지만 금색으로 켜진다. ⚠️ user_progress.rank 가 아니다 —
//            rank 는 '지금 서 있는 칸'이라 Lv.1 을 깨면 2가 된다(취득 = rank − 1). 서버가 계산해 내려준다.
//   · 발자취 = 레벨별 최초 취득일 (그 레벨을 깨서 등급이 한 칸 오른 응시의 제출일)
// ⚠️ URL 파라미터(?level=7)로 그리지 않는 게 핵심 — 공유·자랑용이라 위조가 쉬우면 인증서가 무의미하다.
// 에셋은 public/cert/*.png 공용(정적 시안과 같은 파일).

// 북두칠성 좌표 = 원본 dipper.png(1122×1402)의 링 중심 픽셀 측정값. **좌표는 건드리지 말 것.**
// ⚠️ 방향을 바꾸고 싶으면 좌표가 아니라 아래 ROT(회전각)만 손댄다.
//    좌표의 x 나 y 를 뒤집으면 국자를 1→2→3→4 로 도는 방향이 반대가 되어 **거울상**이 된다 —
//    방향이 바뀌는 게 아니라 다른 별자리가 되는 것이다. (2026-08-06 에 실제로 이 사고를 냈다.)
// ⚠️ /test/select 은 자기 좌표를 따로 들고 있다. 여기를 고쳐도 그 화면은 안 움직인다 — 건드리지 말 것.
// 좌표 = **레벨 선택(/test/select)의 별 배치 그대로.** 두 화면의 방향이 같아야 하므로 그쪽을 따른다.
//   (LevelSelect.tsx 의 DIPPER 와 같은 값. 그 화면은 자기 좌표를 따로 들고 있으니 여기를 고쳐도 안 움직인다.)
const NODES = [
  { n: 1, x: 70, y: 70 }, { n: 2, x: 74, y: 389 }, { n: 3, x: 436, y: 468 },
  { n: 4, x: 547, y: 218 }, { n: 5, x: 754, y: 99 }, { n: 6, x: 1019, y: 79 },
  { n: 7, x: 1269, y: 70 },
]
const EDGES: [number, number][] = [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]]
const R = 28
const ROTC = { x: 670, y: 269 }
// 기울기 = 대각선. 배치(어느 별이 어디)는 레벨 선택을 따르고 회전만 여기서 준다.
// 45° 는 너무 가팔라서 국자가 세로로 서고 아래쪽 별이 하단 테두리까지 내려갔다 → 30° 로 완만하게(2026-08-06).
const ROT = -30
const VB = { w: 1448, h: 900 } // 인증서 고정 좌표계

// 증서 본문 서체 — 라틴은 Tinos(= Times New Roman 과 자폭까지 같은 폰트, `CariSerif` 로 cert.css 에 이미 등록),
// 한글 이름만 Noto Serif KR(`CertSerifKR`)로 떨어진다. ⚠️ 순서를 뒤집지 말 것 — CertSerifKR 이 앞에 오면
// 라틴 글자까지 그쪽에서 나와 시안(2026-08-28 레퍼런스)의 세리프와 자폭이 어긋난다.
const SERIF = 'CariSerif, CertSerifKR, serif'

// 회전을 **좌표에 먼저 먹인다**. 예전엔 <g transform=rotate> 로 통째로 돌리고 글자만 반대로 되돌렸는데,
// 그러면 라벨의 정렬·여백 계산이 회전 전 좌표를 보게 돼서 각도를 바꿀 때마다 날짜가 잘리고 겹쳤다.
// 여기서 한 번 돌려 놓으면 아래는 전부 '화면에 보이는 그대로'의 좌표라 그런 어긋남이 없다.
const RAD = (ROT * Math.PI) / 180
const P = NODES.map((p) => {
  const dx = p.x - ROTC.x, dy = p.y - ROTC.y
  return { n: p.n, x: ROTC.x + dx * Math.cos(RAD) - dy * Math.sin(RAD), y: ROTC.y + dx * Math.sin(RAD) + dy * Math.cos(RAD) }
})
const at = (n: number) => P.find((p) => p.n === n)!

// 취득일 라벨 자리 — **손으로 박는다.** 별이 7개뿐이라 한 번 정하면 끝이고, 자동 계산(이웃 반대 방향)은
// 손잡이처럼 이웃이 일직선인 별에서 옆 라벨과 겹친다(4·5 가 실제로 겹쳤다).
// ⚠️ 위 ROT 을 바꾸면 별 위치가 통째로 움직이므로 **이 7줄도 다시 잡아야 한다.**
const TW = 205 // 날짜 한 줄의 대략적인 폭(여백 계산용)
// 원칙: 그 별에 붙은 **연결선의 반대쪽**, 그리고 국자 안쪽(1-2-3-4 사각형 내부)이 아닌 바깥쪽.
const LABEL: Record<number, { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
  1: { dx: -44, dy: 12, anchor: 'end' },    // 국자 왼쪽 끝 — 왼쪽으로(1→2 선이 아래로 지나간다)
  2: { dx: 0, dy: 68, anchor: 'middle' },   // 국자 바닥 — 아래로
  3: { dx: 46, dy: 12, anchor: 'start' },   // 국자 오른쪽 — 오른쪽으로
  4: { dx: -46, dy: -24, anchor: 'end' },   // 이음매 — 왼쪽 위
  5: { dx: -46, dy: -8, anchor: 'end' },    // 손잡이 — 왼쪽 위. 오른쪽에 두면 글자 기둥을 침범한다
  6: { dx: -46, dy: -8, anchor: 'end' },    // 손잡이 — 5 와 같은 쪽
  7: { dx: 0, dy: -46, anchor: 'middle' },  // 끝 별 — 위로(옆으로 빼면 GARA 로고에 붙는다)
}

// 별 + 라벨이 전부 들어가는 최소 사각형 = viewBox. 좌표가 이미 회전된 값이라 그냥 최대·최소만 잡으면 된다.
function fitViewBox(): string {
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9
  const hit = (x: number, y: number) => {
    if (x < minx) minx = x; if (x > maxx) maxx = x
    if (y < miny) miny = y; if (y > maxy) maxy = y
  }
  P.forEach((p) => {
    const pad = R + 18
    hit(p.x - pad, p.y - pad); hit(p.x + pad, p.y + pad)
    const L = LABEL[p.n]
    const ax = p.x + L.dx, ay = p.y + L.dy
    const x0 = L.anchor === 'start' ? ax : L.anchor === 'end' ? ax - TW : ax - TW / 2
    hit(x0, ay - 28); hit(x0 + TW, ay + 10)
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

      {/* ① 연결선 — 각인 선 조각을 구간마다 회전·신축. 링 앞에서 끊어 여백을 준다 */}
      {EDGES.map(([a, b]) => {
        const p = at(a), q = at(b), on = lit(a) && lit(b)
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy)
        const seg = len - GAP * 2, th = 9
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI
        return (
          <image
            key={`e${a}-${b}`} href="/cert/edge.webp" x={-seg / 2} y={-th / 2} width={seg} height={th}
            preserveAspectRatio="none" opacity={on ? 1 : 0.62} filter={on ? undefined : 'url(#lc-ash)'}
            transform={`translate(${mx},${my}) rotate(${deg})`}
          />
        )
      })}

      {/* ② 발광 별 — flare 의 빛 중심이 (0.502, 0.371) 이라 그만큼 보정 */}
      {P.filter((p) => lit(p.n)).map((p) => {
        const s = 430
        return <image key={`f${p.n}`} href="/cert/flare-gold.webp" x={p.x - s * 0.502} y={p.y - s * 0.371} width={s} height={s} />
      })}

      {/* ③ 링 + 숫자 + 취득일 — 좌표가 이미 회전된 값이라 글자를 되돌릴 필요가 없다 */}
      {P.map((p) => {
        const on = lit(p.n)
        const rw = (637 / 630) * (R * 2.45), rh = R * 2.45
        const L = LABEL[p.n]
        const date = on ? fmtMilestone(milestones[String(p.n)]) : null
        return (
          <g key={`n${p.n}`}>
            <circle cx={p.x} cy={p.y} r={R} fill="rgba(3,11,20,.72)" />
            <image href="/cert/node.webp" x={p.x - rw / 2} y={p.y - rh / 2} width={rw} height={rh}
              opacity={on ? 1 : 0.72} filter={on ? undefined : 'url(#lc-ash)'} />
            <text x={p.x} y={p.y + 11} textAnchor="middle" fontFamily={SERIF} fontSize={32}
              fontWeight={on ? 700 : 500} fill={on ? '#fff4dd' : 'rgba(206,216,230,.82)'}>{p.n}</text>
            {date && (
              <text x={p.x + L.dx} y={p.y + L.dy} textAnchor={L.anchor} fontFamily={SERIF} fontSize={26}
                letterSpacing={1.8} fontWeight={400} fill="url(#lc-gold)">{date}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ⚠️ 개발 서버 전용 미리보기 — 실제 응시 기록 없이 인증서를 보려고 둔 것이다.
//    `?preview=3` = Lv.3 인증서를 가짜 값으로 그린다 · `?layout=a|b|c` = 아래 3배치 비교.
//    import.meta.env.DEV 가 false 인 빌드에서는 분기 자체가 트리셰이킹으로 사라진다.
const DEV_MILESTONES: Record<string, string> = {
  '1': '2026-03-02', '2': '2026-05-11', '3': '2026-07-15', '4': '2026-08-01',
  '5': '2026-08-14', '6': '2026-09-03', '7': '2026-09-28',
}

export default function LevelCert() {
  const navigate = useNavigate()
  const { t } = useT()
  const { isFullUser, loading: authLoading } = useAuth()
  const [data, setData] = useState<LevelCertData | null>(null)
  const [state, setState] = useState<'load' | 'ok' | 'empty' | 'err'>('load')
  const stageRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // 배치 비교용 — 하나로 확정되면 이 스위치와 나머지 두 배치의 CSS 를 지운다.
  const layout = import.meta.env.DEV ? (new URLSearchParams(window.location.search).get('layout') || 'a') : 'a'

  useEffect(() => {
    if (authLoading) return
    if (import.meta.env.DEV) {
      const lv = Number(new URLSearchParams(window.location.search).get('preview'))
      if (Number.isInteger(lv) && lv >= 1 && lv <= 7) {
        // 토큰도 가짜로 넣어야 QR 이 그려진다(서버가 아직 안 내려준다 — testTypes 의 verifyToken 주석 참고).
        setData({ displayName: '홍길동', level: lv, milestones: DEV_MILESTONES, verifyToken: 'preview-sample' })
        setState('ok')
        return
      }
    }
    if (!isFullUser) { setState('empty'); return }
    callFunction<ListAttemptsResponse>('list-attempts', {})
      .then((r) => {
        if (r.certificate) { setData(r.certificate); setState('ok') } else setState('empty')
      })
      .catch(() => setState('err'))
  }, [authLoading, isFullUser])

  // 1448×900 고정 좌표계를 뷰포트에 맞춰 축소(확대는 안 한다). 정적 시안과 같은 방식.
  //
  // ⚠️ 폭만 보면 안 된다. 넓고 낮은 창(노트북 1920×855 등)에서는 폭이 1448 보다 커서
  //    축소가 거의 안 걸리는데, 900px 인증서 + 버튼줄이 화면 높이를 넘어가 'PDF 저장/인쇄'가
  //    화면 밖으로 밀려난다(스크롤은 되지만 인증서가 화면을 꽉 채워 더 있다는 신호가 없다).
  //    그래서 세로도 같이 보고 둘 중 작은 배율을 쓴다.
  useEffect(() => {
    function fit() {
      const st = stageRef.current, wr = wrapRef.current
      if (!st || !wr) return
      // 인증서 위아래로 들어가는 것들: .lc-page 패딩(28+56) + gap(20) + 버튼줄(44)
      const CHROME = 148
      const byWidth = (wr.clientWidth - 8) / VB.w
      // 0.35 하한은 **세로에만** 건다 — 아주 낮은 창에서 글자가 못 읽을 만큼 작아지느니
      // 세로 스크롤을 남긴다. 가로에 걸면 모바일(폭 390 → 배율 0.247)에서 하한이 이겨서
      // 인증서가 화면보다 넓어진다(가로 스크롤은 세로 스크롤보다 훨씬 나쁘다).
      const byHeight = Math.max(0.35, (window.innerHeight - CHROME) / VB.h)
      const s = Math.min(1, byWidth, byHeight)
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
  const qr = data.verifyToken ? qrMatrix(`${window.location.origin}/verify/${data.verifyToken}`, 'H') : null

  return (
    <div className="lc-page">
      <div className="lc-wrap" ref={wrapRef}>
        <div className={`lc-stage lc-lay-${layout}`} ref={stageRef}>
          <img className="lc-bg" src="/cert/bg.webp" alt="" />
          <div className="lc-vig" />

          <img className="lc-orn tl" src="/cert/corner.webp" alt="" />
          <img className="lc-orn tr" src="/cert/corner.webp" alt="" />
          <img className="lc-orn bl" src="/cert/corner.webp" alt="" />
          <img className="lc-orn br" src="/cert/corner.webp" alt="" />

          {/* 왼쪽 위 제목 기둥 — 제목 → 레벨(2026-08-28 시안). 예전엔 오른쪽 기둥 맨 위였다. */}
          <div className="lc-head">
            <img className="lc-title" src="/cert/title-word.webp" alt="LEVEL TEST CERTIFICATE" />
            <div className="lc-mark">
              <img className="lc-mark-cap" src="/cert/level-word.webp" alt="LEVEL" />
              <img className="lc-mark-num" src={`/cert/num-${level}.png`} alt={String(level)} />
            </div>
          </div>

          {/* 오른쪽 증서문 기둥 — 증서 관행대로 **영문 고정**이다(화면 언어를 따르지 않는다).
              사전에 담지 않은 이유 = 언어마다 줄바꿈 폭이 달라 아래 실측 y좌표가 통째로 어긋난다. */}
          <div className="lc-col">
            <img className="lc-certify" src="/cert/copy-certify.png" alt="This is to certify that" />
            <div className="lc-name">{name}</div>
            <img className="lc-body lc-body1" src="/cert/copy-requirements.png" alt="has successfully fulfilled the requirements for and" />
            <div className="lc-earned-row" aria-label={`earned the LEVEL ${level} certification.`}>
              <img className="lc-earned-copy" src="/cert/copy-earned.png" alt="" />
              <span className="lc-earned-level" aria-hidden="true">
                <img className="lc-earned-level-word" src="/cert/level-word.webp" alt="" />
                <img className="lc-earned-level-num" src={`/cert/num-${level}.png`} alt="" />
              </span>
              <img className="lc-certification-copy" src="/cert/copy-certification.png" alt="" />
            </div>

            {/* 진위확인 QR — 금색 모듈 / 검은 판 = **흑백이 뒤집힌 QR**(시안 그대로). 스캐너 여유를 벌려고
                오차정정은 최고 등급(H)으로 굽는다. ⛔ 토큰이 없으면 QR 을 그리지 않는다 —
                죽은 /verify 주소를 찍어 두면 스캔한 사람이 '위조'라는 답을 받는다. */}
            <div className="lc-qrbox">
              {qr ? (
                <svg className="lc-qr" viewBox={`0 0 ${qr.count} ${qr.count}`} role="img" aria-label="Verify authenticity">
                  <rect x="0" y="0" width={qr.count} height={qr.count} fill="#000409" />
                  {qr.dark.map(([r, c], i) => (
                    <rect key={i} x={c} y={r} width={1.04} height={1.04} fill="#e0ab45" />
                  ))}
                </svg>
              ) : (
                <div className="lc-qr-wait" />
              )}
            </div>
            <img className="lc-vcap" src="/cert/copy-verify.png" alt="Verify authenticity" />
            {/* 봉인 — 기둥 맨 아래. ⛔ 아래 서명단 안으로 옮기지 말 것(levelcert.css 의 .lc-seal 주석 참고). */}
            <img className="lc-seal" src="/cert/seal.webp" alt="" />
          </div>

          {/* 발행처 서명단 — 카드 하단, 로고 · 세로선 · 직함+기관명이 **한 줄**(2026-08-28 시안).
              오른쪽 아래 직인이 자리를 먹어서 카드 정중앙이 아니라 살짝 왼쪽에 선다.
              기관 정식명은 번역하지 않고 영문 고정(증서 관행). */}
          <div className="lc-sign">
            <span className="lc-brand" role="img" aria-label="GARA" />
            <span className="lc-sign-bar" />
            <img className="lc-issuer" src="/cert/copy-issuer.png" alt="President, Global AI &amp; Robotics Association" />
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
