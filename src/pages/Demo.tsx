// ⚠️ 기능 데모 / 캐릭터 허브 첫 시안 (모바일 게임 로비 톤). 확정 UX 아님 — 톤만 보는 용도.
//   백엔드(캐릭터 경제·리더보드·쿠폰·칭호·강의AI)를 목업으로 화면화. 배포/서버연결 없이 /demo 로 열림.
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import '../styles/hub.css'
import { Settings, Plus } from 'lucide-react'

// ── 아이콘: 기존 SVG 유지, 톱니바퀴(gear)만 Lucide 사용 ──
const IK = '#2b2015'
const ICONS: Record<string, ReactNode> = {
  sprout: (<><path d="M12 22v-9" stroke="#5fbf46" strokeWidth="2.6" strokeLinecap="round" /><path d="M12 15.5c0-3.4-2.7-5.6-6.2-5.6 0 3.4 2.7 5.6 6.2 5.6Z" fill="#69cf4e" stroke={IK} strokeWidth="1.4" strokeLinejoin="round" /><path d="M12 13c0-3.4 2.7-5.6 6.2-5.6 0 3.4-2.7 5.6-6.2 5.6Z" fill="#82df66" stroke={IK} strokeWidth="1.4" strokeLinejoin="round" /></>),
  calendar: (<><rect x="3.5" y="5.2" width="17" height="15" rx="2.6" fill="#eaf2ff" stroke={IK} strokeWidth="2" /><path d="M3.5 9.6h17" stroke={IK} strokeWidth="2" /><rect x="3.5" y="5.2" width="17" height="4.4" rx="2.6" fill="#5b9bf5" /><rect x="6.6" y="2.8" width="2.4" height="4.2" rx="1.2" fill={IK} /><rect x="15" y="2.8" width="2.4" height="4.2" rx="1.2" fill={IK} /><g fill="#5b9bf5"><circle cx="8" cy="13.6" r="1.2" /><circle cx="12" cy="13.6" r="1.2" /><circle cx="16" cy="13.6" r="1.2" /><circle cx="8" cy="17" r="1.2" /><circle cx="12" cy="17" r="1.2" /></g></>),
  check: (<><rect x="4.5" y="3.5" width="15" height="17" rx="2.4" fill="#fff" stroke={IK} strokeWidth="2" /><path d="M7.4 8.4l1.6 1.6 2.6-2.8M7.4 14.2l1.6 1.6 2.6-2.8" stroke="#4fbf5a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M13.4 8h3.4M13.4 13.8h3.4" stroke={IK} strokeWidth="2" strokeLinecap="round" /></>),
  gift: (<><rect x="3.6" y="9.6" width="16.8" height="4.6" rx="1.4" fill="#ffd15a" stroke={IK} strokeWidth="2" /><rect x="5" y="14" width="14" height="7.4" rx="1.6" fill="#ff6b6b" stroke={IK} strokeWidth="2" /><rect x="10.6" y="9.6" width="2.8" height="11.8" fill="#ffe08a" stroke={IK} strokeWidth="1.6" /><path d="M12 9.4C10.6 6.4 6.6 6.8 6.6 9c0 1.6 2.4 1.6 5.4.4ZM12 9.4c1.4-3 5.4-2.6 5.4-.4 0 1.6-2.4 1.6-5.4.4Z" fill="#ff9db0" stroke={IK} strokeWidth="1.6" strokeLinejoin="round" /></>),
  shop: (<><path d="M4 9.5 5.4 5h13.2L20 9.5v.5a2.2 2.2 0 0 1-4 1 2.2 2.2 0 0 1-4 0 2.2 2.2 0 0 1-4 0 2.2 2.2 0 0 1-4-1v-.5Z" fill="#5b9bf5" stroke={IK} strokeWidth="2" strokeLinejoin="round" /><path d="M5.5 11.4v8.1h13v-8.1" fill="#eaf2ff" stroke={IK} strokeWidth="2" strokeLinejoin="round" /><rect x="9.6" y="14" width="4.8" height="5.5" rx="1" fill="#5b9bf5" stroke={IK} strokeWidth="1.6" /></>),
  medal: (<><path d="M8.4 3h-4l3 6 3.4-1.2L8.4 3Zm7.2 0h4l-3 6-3.4-1.2L15.6 3Z" fill="#ff6b6b" stroke={IK} strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="15" r="6" fill="#ffd15a" stroke={IK} strokeWidth="2" /><path d="M12 11.6l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3 1.1-2.3Z" fill="#fff" stroke={IK} strokeWidth="1" strokeLinejoin="round" /></>),
  book: (<><path d="M12 6.5C10 4.8 6.6 4.6 4 5.4v13c2.6-.8 6-.6 8 1.1 2-1.7 5.4-1.9 8-1.1v-13c-2.6-.8-6-.6-8 1.1Z" fill="#37c9b8" stroke={IK} strokeWidth="2" strokeLinejoin="round" /><path d="M12 6.5v13.1" stroke={IK} strokeWidth="1.8" /><path d="M6.4 9h3.2M6.4 12h3.2M14.4 9h3.2M14.4 12h3.2" stroke="#eafff9" strokeWidth="1.5" strokeLinecap="round" /></>),

  fire: (<path d="M12 2.5c1.5 3 .5 4.8-.8 6.2C9.7 10.4 8 11.7 8 14.4a4 4 0 1 0 8 0c0-1.3-.5-2.4-1.2-3.4.3 1.1-.4 2-1.2 2-1 0-1.3-1-1-2.3.5-2.3 1-4.6-.6-8.2Z" fill="#ff7a3c" stroke={IK} strokeWidth="1.6" strokeLinejoin="round" />),
  star: (<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18l-5.8 3 1.1-6.5L2.6 9.9l6.5-.9L12 2.6Z" fill="#ffd15a" stroke={IK} strokeWidth="1.8" strokeLinejoin="round" />),
  coin: (<><circle cx="12" cy="12" r="9" fill="#ffc93c" stroke={IK} strokeWidth="2" /><circle cx="12" cy="12" r="6" fill="none" stroke={IK} strokeWidth="1.2" strokeOpacity=".5" /><path d="M9 8.5l3 4 3-4M12 12.5v3M9.7 12.5h4.6M9.7 14h4.6" stroke={IK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></>),
  gem: (<><path d="M6 4.6h12l3 4.6-9 10.4L3 9.2 6 4.6Z" fill="#46d6c8" stroke={IK} strokeWidth="2" strokeLinejoin="round" /><path d="M3 9.2h18M9 4.6 12 19.6M15 4.6 12 19.6" stroke={IK} strokeWidth="1.2" strokeOpacity=".55" /></>),
}
function Ic({ n, s = 24, c }: { n: string; s?: number; c?: string }) {
  if (n === 'gear') return <Settings size={s} strokeWidth={2.6} color={c || '#8f5fe0'} />
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }} aria-hidden="true">{ICONS[n]}</svg>
}

const DRAW_COST = 100
const DUPE_REFUND = 20
const PITY_CEILING = 10
const DAILY_POINTS = 10

type Part = { key: string; name: string; rare: boolean; weight: number; price: number }
const POOL: Part[] = [
  { key: 'hat_common_01', name: '새싹 모자', rare: false, weight: 40, price: 200 },
  { key: 'hat_common_02', name: '비니', rare: false, weight: 40, price: 200 },
  { key: 'shoe_common_01', name: '포근 양말', rare: false, weight: 30, price: 200 },
  { key: 'glasses_common_01', name: '동글 안경', rare: false, weight: 30, price: 200 },
  { key: 'wing_rare_01', name: '✨빛나는 날개', rare: true, weight: 5, price: 800 },
  { key: 'crown_rare_01', name: '👑작은 왕관', rare: true, weight: 5, price: 800 },
]

function pickWeighted(pool: Part[]): Part {
  const total = pool.reduce((s, p) => s + p.weight, 0)
  let r = Math.random() * total
  for (const p of pool) { r -= p.weight; if (r <= 0) return p }
  return pool[pool.length - 1]
}

export default function Demo() {
  const [points, setPoints] = useState(520)
  const [stamps, setStamps] = useState(3)
  const [checkedIn, setCheckedIn] = useState(false)
  const [owned, setOwned] = useState<Set<string>>(new Set(['hat_common_01']))
  const [pity, setPity] = useState(4)
  const [lastDraw, setLastDraw] = useState<{ part: Part; dupe: boolean; refund: number } | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [arenaOpen, setArenaOpen] = useState(false)
  const refs = useRef<Record<string, HTMLDivElement | null>>({})

  const pushLog = (s: string) => setLog((l) => [s, ...l].slice(0, 5))
  const go = (id: string) => refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  function doDaily() {
    if (checkedIn) return
    setCheckedIn(true); setPoints((p) => p + DAILY_POINTS); setStamps((s) => s + 1)
    pushLog(`출석 완료 · +${DAILY_POINTS}P · 스탬프 +1 (하루 1회)`)
  }
  function doGacha() {
    if (points < DRAW_COST) { pushLog('포인트 부족 (insufficient_points)'); return }
    setPoints((p) => p - DRAW_COST)
    const forced = pity + 1 >= PITY_CEILING
    const part = forced ? POOL.filter((p) => p.rare)[Math.floor(Math.random() * 2)] : pickWeighted(POOL)
    const dupe = owned.has(part.key)
    let refund = 0
    if (dupe) { refund = DUPE_REFUND; setPoints((p) => p + DUPE_REFUND) }
    else setOwned((o) => new Set(o).add(part.key))
    setPity((c) => (part.rare ? 0 : c + 1))
    setLastDraw({ part, dupe, refund })
    pushLog(`뽑기: ${part.name}${part.rare ? ' (레어!)' : ''}${dupe ? ` · 중복→+${DUPE_REFUND}P` : ''}${forced ? ' · 천장' : ''}`)
  }
  function doBuy(part: Part) {
    if (owned.has(part.key)) { pushLog(`${part.name}: 이미 보유`); return }
    if (points < part.price) { pushLog(`포인트 부족: ${part.name} (${part.price}P)`); return }
    setPoints((p) => p - part.price); setOwned((o) => new Set(o).add(part.key))
    pushLog(`상점 구매: ${part.name} · -${part.price}P`)
  }

  const xpPct = 62
  return (
    <div className="hub">
      <div className="sky" aria-hidden="true">
        <div className="sun" />
        <div className="cloud c1" /><div className="cloud c2" /><div className="cloud c3" />
        <span className="spark s1">✦</span><span className="spark s2">✦</span>
        <span className="spark s3">✧</span><span className="spark s4">✦</span>
      </div>

      <div className="slim-banner">
        <b>⚠️ 시안(미리보기)</b> — 카툰 스타일(레퍼 01 톤). 캐릭터는 임시본. 버튼 눌러보면 뽑기·출석·상점 실제 동작(목업).
      </div>

      <div className="home">
        {/* 상단 HUD */}
        <div className="hud">
          <div className="hud-av">
            <div className="av"><Ic n="sprout" s={44} /></div>
            <span className="hud-lv">Lv.4</span>
          </div>
          <div className="hud-mid">
            <div className="hud-name">새싹이 <span className="tt">🏆 CARIS Pro 2급</span></div>
            <div className="exp"><div className="exp-fill" style={{ width: `${xpPct}%` }} /><span className="exp-lab">620 / 1000 XP</span></div>
          </div>
          <div className="cur">
            <span className="gchip"><Ic n="coin" s={26} /><span className="num">{points.toLocaleString()}</span><span className="plus"><Plus size={13} strokeWidth={3.5} /></span></span>
            <span className="gchip"><Ic n="gem" s={24} /><span className="num">12</span><span className="plus"><Plus size={13} strokeWidth={3.5} /></span></span>
          </div>
        </div>

        {/* 캐릭터 무대 + 양옆 레일 */}
        <div className="stage-zone">
          <div className="rail rail-l">
            <button className="ricon" onClick={() => go('daily')}><Ic n="calendar" s={34} />{!checkedIn && <span className="bd">1</span>}</button>
            <button className="ricon" onClick={() => go('coupon')}><Ic n="check" s={34} /><span className="bd">1</span></button>
            <button className="ricon" onClick={() => pushLog('설정 (목업)')}><Ic n="gear" s={34} /></button>
          </div>
          <div className="rail rail-r">
            <button className="fcard f-gacha" onClick={() => go('gacha')}><span className="fico"><Ic n="gift" s={42} /></span>뽑기</button>
            <button className="fcard f-shop" onClick={() => go('shop')}><span className="fico"><Ic n="shop" s={42} /></span>상점</button>
            <button className="fcard f-title" onClick={() => setArenaOpen(true)}><span className="fico" style={{ fontSize: 34, lineHeight: 1 }}>🌍</span>월드아레나</button>
          </div>
          <div className="stage">
            <div className="pedestal" />
            <img className="hero-char" src="/hub-char.png" alt="내 캐릭터" />
            <div className="nameplate"><b>새싹이</b> <span className="tt">🏆 Pro 2급</span></div>
          </div>
        </div>

        {/* 도크: 7일 출석 캘린더 + 메인 CTA */}
        <div className="dock">
          <div className="reward">
            <div className="rw-top"><Ic n="fire" s={20} /> 출석 보상 <span className="rw-streak">{stamps}일 연속!</span><span className="rw-n">{stamps} / 7</span></div>
            <div className="streak">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <div key={d} className={`day ${d <= stamps ? 'on' : ''}`}>
                  {d === 7 && <span className="gift"><Ic n="gift" s={26} /></span>}
                  {d}일<span className="chk">{d <= stamps ? '✓' : ''}</span>
                </div>
              ))}
            </div>
          </div>
          <button className="cta-main" onClick={() => pushLog('미니 게임으로 이동')}>
            <span className="cta-star"><Ic n="star" s={24} /></span>
            미니 게임
          </button>
        </div>
      </div>

      {log.length > 0 && <div className="log">{log.map((l, i) => <div key={i}>· {l}</div>)}</div>}

      {/* ===== 아래: 각 기능 동작(목업) ===== */}
      <Panel refCb={(el) => (refs.current.daily = el)} title="📅 일일 출석" be="complete-daily · daily_activity">
        <button className="pbtn" style={btn(checkedIn ? '#c3cbe0' : '#4b7bf5')} onClick={doDaily} disabled={checkedIn}>
          {checkedIn ? '오늘 출석 완료 ✓' : `오늘 출석 (+${DAILY_POINTS}P · 스탬프+1)`}
        </button>
        <span className="chip" style={{ marginLeft: 8 }}>⭐ 스탬프 {stamps}</span>
        <p className="note">하루 1회만(서버가 KST unique(user,day) 강제). 오늘 콘텐츠 소비=완료(정답 무관). 누적 스탬프로 뽑기권 마일스톤.</p>
      </Panel>

      <Panel refCb={(el) => (refs.current.gacha = el)} title="🎁 뽑기" be="gacha-draw · 서버권위/꽝없음/중복환급/천장">
        <div className="pill-row" style={{ alignItems: 'center' }}>
          <button className="pbtn" style={btn('#b98cf6')} onClick={doGacha}>뽑기 ({DRAW_COST}P)</button>
          <span className="note" style={{ margin: 0 }}>천장까지 {Math.max(0, PITY_CEILING - pity)}회 · 보유 {owned.size}종</span>
        </div>
        {lastDraw && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 14, background: lastDraw.part.rare ? '#fffaeb' : '#f6f8ff', border: `1px solid ${lastDraw.part.rare ? '#f4d27a' : '#e6ebfa'}` }}>
            <b>{lastDraw.part.name}</b>{lastDraw.part.rare && <span style={{ color: '#d97706' }}> · 레어 ✨</span>}
            {lastDraw.dupe && <span style={{ color: '#0891b2' }}> · 중복 +{lastDraw.refund}P 환급</span>}
          </div>
        )}
        <p className="note">꽝 없음(항상 파츠). 보유한 거 나오면 환급. 천장 도달 시 레어 확정. 전부 서버가 결정.</p>
      </Panel>

      <Panel refCb={(el) => (refs.current.shop = el)} title="🛍️ 상점" be="shop-buy · shop_catalog(가격은 서버가 결정)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {POOL.map((p) => (
            <div key={p.key} style={{ textAlign: 'center', padding: 12, borderRadius: 14, border: '1px solid #eceffa' }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: '#7c88ab', margin: '2px 0 8px' }}>{p.price}P{p.rare ? ' · 레어' : ''}</div>
              <button className="pbtn" style={{ ...btn(owned.has(p.key) ? '#c3cbe0' : '#6bbf9a'), width: '100%', padding: '7px 0', fontSize: 12 }} onClick={() => doBuy(p)} disabled={owned.has(p.key)}>
                {owned.has(p.key) ? '보유중' : '구매'}
              </button>
            </div>
          ))}
        </div>
        <p className="note">클라가 가격/파츠 못 정함 — 서버 카탈로그 가격만 사용. 무료·조작 구매 차단.</p>
      </Panel>

      <Panel refCb={(el) => (refs.current.region = el)} title="🏳️ 지역 경쟁 (협력형)" be="region/country/school_leaderboard">
        <p className="note" style={{ marginTop: 0 }}>바탕화면 프로토타입이 이제 <b>월드 아레나</b>로 들어왔어요 — 3D 지구본 + 국가·지역 랭킹 전체 화면. 위 <b>🌍 아레나</b> 또는 아래 버튼으로 열림:</p>
        <button className="pbtn" style={btn('#e0912f')} onClick={() => setArenaOpen(true)}>🌍 월드 아레나 열기</button>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {[['🥇', '서울', '평균 4.6 · 참여 41%'], ['🥈', '부산', '평균 4.3 · 참여 38%'], ['🥉', '경기', '평균 4.1 · 참여 35%']].map((r) => (
              <tr key={r[1]} style={{ borderTop: '1px solid #f0f2fa' }}>
                <td style={{ padding: '8px 6px', width: 30 }}>{r[0]}</td><td style={{ fontWeight: 800 }}>{r[1]}</td>
                <td style={{ textAlign: 'right', color: '#7c88ab' }}>{r[2]}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid #f0f2fa', color: '#aab' }}><td style={{ padding: '8px 6px' }}>–</td><td>세종</td><td style={{ textAlign: 'right' }}>집계중 (5명 미만)</td></tr>
          </tbody>
        </table>
        <p className="note">개인 순위 노출 없음(집단 익명 합산). "우리가 올라간다" 협력 톤.</p>
      </Panel>

      {arenaOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#f4efe4' }}>
          <button
            onClick={() => setArenaOpen(false)}
            style={{ position: 'absolute', top: 14, right: 16, zIndex: 2, border: 0, borderRadius: 999, padding: '9px 16px', fontWeight: 800, fontSize: 14, cursor: 'pointer', background: '#2c2114', color: '#fff', boxShadow: '0 6px 18px -6px rgba(0,0,0,.4)' }}
          >✕ 닫기</button>
          <iframe src="/world-arena.html" title="월드 아레나" style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />
        </div>
      )}

      <Panel refCb={(el) => (refs.current.coupon = el)} title="🎟️ 쿠폰함" be="user_coupons(레벨 최초 도달마다 1장)">
        {[['Lv.4 도달', '자격증 10% 할인', true], ['Lv.3 도달', '자격증 10% 할인', false], ['Lv.2 도달', '자격증 10% 할인', false]].map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', marginTop: 8, borderRadius: 12, border: '1px dashed #c7d2fe', background: '#f7f9ff' }}>
            <span><b>{c[1]}</b> <span style={{ fontSize: 12, color: '#7c88ab' }}>· {c[0]}</span></span>
            <span style={{ fontSize: 12, color: c[2] ? '#16a34a' : '#7c88ab' }}>{c[2] ? '최신 발급' : '보유'}</span>
          </div>
        ))}
        <p className="note">레벨 처음 올릴 때 1장(강등 후 재승급은 재발급 X). 사용은 결제 붙을 때.</p>
      </Panel>

      <Panel refCb={(el) => (refs.current.title = el)} title="🏅 칭호" be="user_titles(진짜 합격자만 · 구매/뽑기 불가)">
        <div className="pill-row">
          <span className="chip">🏅 CARIS Pro 2급</span>
          <span className="chip">🏅 CARIS Master 4급</span>
        </div>
        <p className="note">자격증 시험 합격(정답률 ≥ 60%)에서 자동 파생. 돈/뽑기로 못 얻음. 프로필·리더보드 노출.</p>
      </Panel>

      <Panel refCb={(el) => (refs.current.lecture = el)} title="💬 강의 AI" be="lecture-qa(그 강의 자료로만 · 수강자만 · 쿼터 · Flash)">
        <div style={{ padding: 12, borderRadius: 14, background: '#f6f8ff', border: '1px solid #e6ebfa', fontSize: 13 }}>
          <div style={{ color: '#7c88ab' }}>Q. 이번 강의에서 프롬프트 온도(temperature)가 뭐랬어?</div>
          <div style={{ marginTop: 6 }}>A. (그 강의 자료 기준) 온도는 응답의 무작위성을 조절하며… <span style={{ color: '#aab' }}>[강의 문맥 근거]</span></div>
        </div>
        <p className="note">수강 안 한 사람은 검색·비용 전에 차단. 강의당 질문 횟수 제한. 교차 강의 누출 없음. Flash 모델.</p>
      </Panel>

      <Panel refCb={(el) => (refs.current.mypage = el)} title="🙂 마이페이지" be="user_progress · 6축 · MyPage AI">
        <p className="note" style={{ marginTop: 0 }}>내 레벨·6축 레이더·약점·이력 + AI 학습 조언. (기존 마이페이지 재활용/확장 예정)</p>
      </Panel>

      <p className="note" style={{ textAlign: 'center', marginTop: 20 }}>— 여기까지 첫 시안. "이건 살리고 이건 바꿔" 찍어줘 —</p>
    </div>
  )
}

function Panel({ title, be, children, refCb }: { title: string; be: string; children: ReactNode; refCb: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={refCb} className="panel">
      <h3>{title}</h3>
      <div className="be">← 백엔드: {be}</div>
      {children}
    </div>
  )
}
function btn(bg: string): CSSProperties {
  return { background: bg }
}
