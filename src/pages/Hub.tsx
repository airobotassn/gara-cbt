// 캐릭터 허브(실동작) — /demo 첫 시안 기반 단일 로비 화면.
//   출석·뽑기·상점·쿠폰·칭호는 전부 실제 백엔드 호출로 동작하며, 상세 동작은 팝업(모달)에서 처리한다.
//   초기 재화·보유파츠·스탬프·천장·출석여부·카탈로그·쿠폰·칭호는 get-hub 로 하이드레이트(RLS 잠금 테이블이라 이 함수만 읽음).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import '../styles/hub.css'
import { callFunction, supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { Avatar } from '../components/GemAvatar'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { ACTIVITY_DELTA, type Tier } from '../lib/scoring'

// ── 아이콘: 기존 SVG 유지 ──
const IK = '#2b2015'
const ICONS: Record<string, ReactNode> = {
  sprout: (<><path d="M12 22v-9" stroke="#5fbf46" strokeWidth="2.6" strokeLinecap="round" /><path d="M12 15.5c0-3.4-2.7-5.6-6.2-5.6 0 3.4 2.7 5.6 6.2 5.6Z" fill="#69cf4e" stroke={IK} strokeWidth="1.4" strokeLinejoin="round" /><path d="M12 13c0-3.4 2.7-5.6 6.2-5.6 0 3.4-2.7 5.6-6.2 5.6Z" fill="#82df66" stroke={IK} strokeWidth="1.4" strokeLinejoin="round" /></>),
  calendar: (<><rect x="3.5" y="5.2" width="17" height="15" rx="2.6" fill="#eaf2ff" stroke={IK} strokeWidth="2" /><path d="M3.5 9.6h17" stroke={IK} strokeWidth="2" /><rect x="3.5" y="5.2" width="17" height="4.4" rx="2.6" fill="#5b9bf5" /><rect x="6.6" y="2.8" width="2.4" height="4.2" rx="1.2" fill={IK} /><rect x="15" y="2.8" width="2.4" height="4.2" rx="1.2" fill={IK} /><g fill="#5b9bf5"><circle cx="8" cy="13.6" r="1.2" /><circle cx="12" cy="13.6" r="1.2" /><circle cx="16" cy="13.6" r="1.2" /><circle cx="8" cy="17" r="1.2" /><circle cx="12" cy="17" r="1.2" /></g></>),
  check: (<><rect x="4.5" y="3.5" width="15" height="17" rx="2.4" fill="#fff" stroke={IK} strokeWidth="2" /><path d="M7.4 8.4l1.6 1.6 2.6-2.8M7.4 14.2l1.6 1.6 2.6-2.8" stroke="#4fbf5a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M13.4 8h3.4M13.4 13.8h3.4" stroke={IK} strokeWidth="2" strokeLinecap="round" /></>),
  ticket: (<><rect x="3" y="6.5" width="18" height="11" rx="2.5" fill="#ffd15a" stroke={IK} strokeWidth="2" /><path d="M9 6.5v11" stroke={IK} strokeWidth="1.7" strokeDasharray="2.2 2.2" /><circle cx="13" cy="10.5" r="1.15" fill="none" stroke={IK} strokeWidth="1.5" /><circle cx="16.3" cy="13.7" r="1.15" fill="none" stroke={IK} strokeWidth="1.5" /><path d="M16.6 9.8l-4 4.6" stroke={IK} strokeWidth="1.7" strokeLinecap="round" /></>),
  gift: (<><rect x="3.6" y="9.6" width="16.8" height="4.6" rx="1.4" fill="#ffd15a" stroke={IK} strokeWidth="2" /><rect x="5" y="14" width="14" height="7.4" rx="1.6" fill="#ff6b6b" stroke={IK} strokeWidth="2" /><rect x="10.6" y="9.6" width="2.8" height="11.8" fill="#ffe08a" stroke={IK} strokeWidth="1.6" /><path d="M12 9.4C10.6 6.4 6.6 6.8 6.6 9c0 1.6 2.4 1.6 5.4.4ZM12 9.4c1.4-3 5.4-2.6 5.4-.4 0 1.6-2.4 1.6-5.4.4Z" fill="#ff9db0" stroke={IK} strokeWidth="1.6" strokeLinejoin="round" /></>),
  shop: (<><path d="M4 9.5 5.4 5h13.2L20 9.5v.5a2.2 2.2 0 0 1-4 1 2.2 2.2 0 0 1-4 0 2.2 2.2 0 0 1-4 0 2.2 2.2 0 0 1-4-1v-.5Z" fill="#5b9bf5" stroke={IK} strokeWidth="2" strokeLinejoin="round" /><path d="M5.5 11.4v8.1h13v-8.1" fill="#eaf2ff" stroke={IK} strokeWidth="2" strokeLinejoin="round" /><rect x="9.6" y="14" width="4.8" height="5.5" rx="1" fill="#5b9bf5" stroke={IK} strokeWidth="1.6" /></>),
  medal: (<><path d="M8.4 3h-4l3 6 3.4-1.2L8.4 3Zm7.2 0h4l-3 6-3.4-1.2L15.6 3Z" fill="#ff6b6b" stroke={IK} strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="15" r="6" fill="#ffd15a" stroke={IK} strokeWidth="2" /><path d="M12 11.6l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3 1.1-2.3Z" fill="#fff" stroke={IK} strokeWidth="1" strokeLinejoin="round" /></>),
  book: (<><path d="M12 6.5C10 4.8 6.6 4.6 4 5.4v13c2.6-.8 6-.6 8 1.1 2-1.7 5.4-1.9 8-1.1v-13c-2.6-.8-6-.6-8 1.1Z" fill="#37c9b8" stroke={IK} strokeWidth="2" strokeLinejoin="round" /><path d="M12 6.5v13.1" stroke={IK} strokeWidth="1.8" /><path d="M6.4 9h3.2M6.4 12h3.2M14.4 9h3.2M14.4 12h3.2" stroke="#eafff9" strokeWidth="1.5" strokeLinecap="round" /></>),

  fire: (<path d="M12 2.5c1.5 3 .5 4.8-.8 6.2C9.7 10.4 8 11.7 8 14.4a4 4 0 1 0 8 0c0-1.3-.5-2.4-1.2-3.4.3 1.1-.4 2-1.2 2-1 0-1.3-1-1-2.3.5-2.3 1-4.6-.6-8.2Z" fill="#ff7a3c" stroke={IK} strokeWidth="1.6" strokeLinejoin="round" />),
  star: (<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18l-5.8 3 1.1-6.5L2.6 9.9l6.5-.9L12 2.6Z" fill="#ffd15a" stroke={IK} strokeWidth="1.8" strokeLinejoin="round" />),
  coin: (<><circle cx="12" cy="12" r="9" fill="#ffc93c" stroke={IK} strokeWidth="2" /><circle cx="12" cy="12" r="6" fill="none" stroke={IK} strokeWidth="1.2" strokeOpacity=".5" /><path d="M9 8.5l3 4 3-4M12 12.5v3M9.7 12.5h4.6M9.7 14h4.6" stroke={IK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></>),
  trophy: (<><path d="M7 3.5h10V9a5 5 0 0 1-10 0V3.5Z" fill="#ffd15a" stroke={IK} strokeWidth="2" strokeLinejoin="round" /><path d="M7 5.2H4.4c0 2 1.2 3.5 2.9 3.8M17 5.2h2.6c0 2-1.2 3.5-2.9 3.8" fill="none" stroke={IK} strokeWidth="1.7" strokeLinecap="round" /><path d="M12 14v3" stroke={IK} strokeWidth="2.2" strokeLinecap="round" /><rect x="8.2" y="17" width="7.6" height="3.5" rx="1.2" fill="#ff6b6b" stroke={IK} strokeWidth="2" /></>),
}
function Ic({ n, s = 24 }: { n: string; s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }} aria-hidden="true">{ICONS[n]}</svg>
}

const DRAW_COST = 20
const PITY_CEILING = 15
const DAILY_POINTS = 10

type Part = { key: string; name: string; rare: boolean; weight: number; price: number }
const POOL: Part[] = [
  { key: 'hat_common_01', name: '새싹 모자', rare: false, weight: 40, price: 200 },
  { key: 'hat_common_02', name: '비니', rare: false, weight: 40, price: 200 },
  { key: 'shoe_common_01', name: '포근 양말', rare: false, weight: 30, price: 200 },
  { key: 'glasses_common_01', name: '동글 안경', rare: false, weight: 30, price: 200 },
  { key: 'wing_rare_01', name: '빛나는 날개', rare: true, weight: 5, price: 800 },
  { key: 'crown_rare_01', name: '작은 왕관', rare: true, weight: 5, price: 800 },
]
function partName(key: string) {
  return POOL.find((p) => p.key === key)?.name ?? key
}
function partEmoji(key: string) {
  if (key.startsWith('hat')) return '🧢'
  if (key.startsWith('shoe')) return '👟'
  if (key.startsWith('glasses')) return '👓'
  if (key.startsWith('wing')) return '✨'
  if (key.startsWith('crown')) return '👑'
  return '🎁'
}

// ── 서버 계약(입출력) ──
interface CatalogItem { partKey: string; price: number; rare: boolean }
interface HubState { authed: boolean; level?: number | null; rankPoints?: number | null; points?: number; dust?: number; cosmetics?: string[]; stamps?: number; pity?: number; dailyDone?: boolean; titles?: { track: string; grade: string }[]; coupons?: { level: number; discount: number; used: boolean }[]; catalog?: CatalogItem[]; exclusives?: { partKey: string; dustPrice: number }[]; skillScore?: number | null; activityScore?: number | null; seasonTotal?: number | null; tier?: Tier | null; percentile?: number | null; pointsToPass?: number | null }
interface GachaResp { part_key: string | null; dust_gained: number; pity_before: number; pity_after: number; points_after: number; dust_after: number; duplicate: boolean }
interface ShopResp { part_key: string; spent_points: number; points_after: number }
interface ExchangeResp { part_key: string; spent_dust: number; dust_after: number }
interface DailyResp { ok: boolean; day: string; first: boolean }

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : ''
  if (msg === 'insufficient_points') return '포인트가 부족해요'
  if (msg === 'insufficient_dust') return '가루가 부족해요'
  if (msg === 'already_owned') return '이미 보유한 한정템이에요'
  if (msg === 'unauthorized') return '로그인이 필요해요'
  return '오류가 발생했어요. 잠시 후 다시 시도해주세요'
}

type ModalKind = 'gacha' | 'shop' | 'coupon' | 'title'

export default function Hub() {
  const { isFullUser, loginWithGoogle, user, loading } = useAuth()
  const { t } = useT()
  const [points, setPoints] = useState(0)
  const [stamps, setStamps] = useState(0)
  const [checkedIn, setCheckedIn] = useState(false)
  const [owned, setOwned] = useState<Set<string>>(new Set())
  const [pity, setPity] = useState(0)
  const [level, setLevel] = useState<number | null>(null)
  const [authed, setAuthed] = useState(false)
  const [titles, setTitles] = useState<{ track: string; grade: string }[]>([])
  const [coupons, setCoupons] = useState<{ level: number; discount: number; used: boolean }[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [dust, setDust] = useState(0)
  const [exclusives, setExclusives] = useState<{ partKey: string; dustPrice: number }[]>([])
  const [lastDraw, setLastDraw] = useState<{ dust: number; part: Part | null } | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [purchased, setPurchased] = useState<{ partKey: string; kind: 'coin' | 'dust' } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalKind | null>(null)
  const [skillScore, setSkillScore] = useState(0)
  const [activityScore, setActivityScore] = useState(0)
  const [seasonTotal, setSeasonTotal] = useState(0)
  const [tier, setTier] = useState<Tier | null>(null)
  const [percentile, setPercentile] = useState<number | null>(null)
  const [pointsToPass, setPointsToPass] = useState<number | null>(null)

  const pushLog = (s: string) => {
    setToast(s)
    window.setTimeout(() => setToast((cur) => (cur === s ? null : cur)), 2600)
  }

  // 프로필 아바타(본인 profiles.avatar_url) — 로그인 시 조회. setState 는 프라미스 콜백에서만.
  useEffect(() => {
    const uid = user?.id
    if (!uid) return
    let alive = true
    supabase.from('profiles').select('avatar_url').eq('id', uid).maybeSingle()
      .then(({ data }) => { if (alive) setAvatarUrl((data?.avatar_url as string | null) ?? null) })
    return () => { alive = false }
  }, [user?.id])

  // get-hub 응답을 상태에 반영(서버 권위값으로 동기화).
  function applyHub(h: HubState) {
    setPoints(h.points ?? 0)
    setStamps(h.stamps ?? 0)
    setPity(h.pity ?? 0)
    setCheckedIn(!!h.dailyDone)
    setOwned(new Set(h.cosmetics ?? []))
    setLevel(h.level ?? null)
    setAuthed(!!h.authed)
    setTitles(h.titles ?? [])
    setCoupons(h.coupons ?? [])
    setCatalog(h.catalog ?? [])
    setDust(h.dust ?? 0)
    setExclusives(h.exclusives ?? [])
    setSkillScore(h.skillScore ?? 0)
    setActivityScore(h.activityScore ?? 0)
    setSeasonTotal(h.seasonTotal ?? 0)
    setTier(h.tier ?? null)
    setPercentile(h.percentile ?? null)
    setPointsToPass(h.pointsToPass ?? null)
  }
  async function hydrate() {
    try {
      applyHub(await callFunction<HubState>('get-hub', {}))
    } catch {
      /* 유지 */
    }
  }

  // 마운트 시 하이드레이트. setState 는 프라미스 콜백에서만(동기 setState 금지 규칙 준수).
  useEffect(() => {
    let alive = true
    callFunction<HubState>('get-hub', {})
      .then((h) => { if (alive) applyHub(h) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // 출석 → complete-daily (하루 1회 서버 강제). 성공 후 get-hub 로 재화/스탬프 재동기화.
  async function doDaily() {
    if (!isFullUser) { void loginWithGoogle(); return }
    if (checkedIn) return
    try {
      await callFunction<DailyResp>('complete-daily', {})
      pushLog(`출석 완료 · +${DAILY_POINTS}P · 스탬프 +1`)
      await hydrate()
    } catch (e) {
      pushLog(friendlyError(e))
    }
  }
  // 뽑기 → gacha-draw (서버권위/멱등 nonce/천장/환급). 서버 결과로 토스트, get-hub 로 재동기화.
  async function doGacha() {
    if (!isFullUser) { void loginWithGoogle(); return }
    if (points < DRAW_COST) { pushLog('코인이 부족해요'); return }
    try {
      setDrawing(true)
      setLastDraw(null)
      const r = await callFunction<GachaResp>('gacha-draw', { pool_key: 'default', client_nonce: crypto.randomUUID() })
      const part = r.part_key ? (POOL.find((p) => p.key === r.part_key) ?? null) : null
      window.setTimeout(() => {
        setLastDraw({ dust: r.dust_gained, part })
        setDrawing(false)
      }, 900)
      await hydrate()
    } catch (e) {
      setDrawing(false)
      pushLog(friendlyError(e))
    }
  }
  // 상점 → shop-buy (가격은 서버 카탈로그 권위).
  async function doBuy(partKey: string, price: number) {
    if (!isFullUser) { void loginWithGoogle(); return }
    if (owned.has(partKey)) return
    if (points < price) { pushLog(`포인트가 부족해요: ${partName(partKey)} (${price}P)`); return }
    try {
      await callFunction<ShopResp>('shop-buy', { part_key: partKey, client_nonce: crypto.randomUUID() })
      setPurchased({ partKey, kind: 'coin' })
      await hydrate()
    } catch (e) {
      pushLog(friendlyError(e))
    }
  }

  // 가루 교환 → gacha-exchange (뽑기 전용 한정템 지정 확정). 성공 시 리워드 팝업.
  async function doExchange(partKey: string, price: number) {
    if (!isFullUser) { void loginWithGoogle(); return }
    if (owned.has(partKey)) return
    if (dust < price) { pushLog('가루가 부족해요'); return }
    try {
      await callFunction<ExchangeResp>('gacha-exchange', { part_key: partKey, client_nonce: crypto.randomUUID() })
      setPurchased({ partKey, kind: 'dust' })
      await hydrate()
    } catch (e) {
      pushLog(friendlyError(e))
    }
  }

  // 쿠폰 배지 카운트 — 진입 버튼을 숨겨(비활성화) 현재 미사용. 버튼 되살리면 함께 복구.
  // const unusedCoupons = coupons.filter((c) => !c.used).length
  const titleBadge = titles[0] ? <span className="tt">🏆 CARIS {titles[0].track} {titles[0].grade}</span> : null
  // 다음 순위 게이지: percentile(0~1, 상위일수록 작음) 기반 fill = 1 - percentile → 상위일수록 가득(단조).
  //   percentile null(미배치)이면 0. tier 는 있는데 percentile 이 없고 pointsToPass 도 null(=1위 엣지케이스)이면 가득(1).
  const aboveScore = seasonTotal + (pointsToPass ?? 0)
  const gaugeFillPct =
    percentile != null ? Math.max(0, Math.min(100, (1 - percentile) * 100)) : tier && pointsToPass == null ? 100 : 0
  const gaugeLabel = !tier ? t('rank.unplaced') : pointsToPass == null ? t('rank.top_tier') : t('rank.next_gap', { n: pointsToPass })

  // 허브는 로그인 전용(게스트는 출석·뽑기·상점이 전부 잠긴 빈 화면이라 진입 자체를 막는다).
  //   로그인 후 /hub 로 복귀 — /auth/callback?next=/hub 로 왕복해도 next 가 URL 에 실려 안 날아간다.
  //   loading 중엔 판정 보류(허브가 한 프레임 번쩍였다 게이트로 바뀌는 것 방지).
  if (loading) {
    return <div className="hub hub-gate"><div className="hub-gate-card">{t('common.loading')}</div></div>
  }
  if (!isFullUser) {
    return (
      <div className="hub hub-gate">
        <div className="sky" aria-hidden="true">
          <div className="sun" />
          <div className="cloud c1" /><div className="cloud c2" /><div className="cloud c3" />
        </div>
        <div className="hub-gate-card">
          <img className="hub-gate-char" src="/hub-char.png" alt="CARI" />
          <h2 className="hub-gate-title">CARI</h2>
          <p className="hub-gate-sub">로그인하고 출석·뽑기·상점을 이용해보세요</p>
          <button
            className="hub-gate-btn"
            onClick={() => loginWithGoogle(`${window.location.origin}/auth/callback?next=/hub`)}
          >
            {t('common.login_google')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="hub">
      <div className="sky" aria-hidden="true">
        <div className="sun" />
        <div className="cloud c1" /><div className="cloud c2" /><div className="cloud c3" />
        <span className="spark s1">✦</span><span className="spark s2">✦</span>
        <span className="spark s3">✧</span><span className="spark s4">✦</span>
      </div>

      {/* 허브는 아레나 런처(CARI 버튼)로 들어오는 화면 — 뒤로가기도 아레나로 */}
      <div className="hub-backrow">
        <Link className="hub-back" to="/arena">
          <span className="ic">←</span>WORLD ARENA
        </Link>
      </div>

      {!isFullUser && (
        <div className="slim-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span>로그인해야 출석·뽑기·상점이 작동해요</span>
          <button className="pbtn" style={{ background: '#4b7bf5', padding: '7px 14px', fontSize: 13 }} onClick={() => loginWithGoogle()}>구글로 로그인</button>
        </div>
      )}


      <div className="home">
        {/* 상단 HUD */}
        <div className="hud">
          <div className="hud-av">
            <div className="av"><Avatar avatarUrl={avatarUrl} seed={user?.id ?? 'guest'} size={44} /></div>
            <span className="hud-lv">Lv.{level ?? '—'}</span>
          </div>
          <div className="hud-mid">
            <div className="hud-name">CARI {titleBadge}{tier && <span className="tier-chip">{t(`rank.tier_${tier}`)}{percentile != null && <em>{t('rank.top', { p: Math.round(percentile * 100) })}</em>}</span>}</div>
            <div className="hud-xp">
              <div className="rank-gauge">
                <div className="rank-gauge-lab">{gaugeLabel}</div>
                <div className="rank-gauge-track">
                  <span className="rank-gauge-end lo">{seasonTotal.toLocaleString()}</span>
                  <div className="exp"><div className="exp-fill" style={{ width: `${gaugeFillPct}%` }} /></div>
                  <span className="rank-gauge-end hi">{aboveScore.toLocaleString()}</span>
                </div>
                <div className="rank-gauge-break">
                  <span>{t('db.skill_score')} {skillScore.toLocaleString()}</span>
                  <span>{t('db.activity_score')} {activityScore.toLocaleString()}</span>
                </div>
              </div>
              <span className="gchip"><Ic n="coin" s={26} /><span className="num">{points.toLocaleString()}</span></span>
            </div>
          </div>
        </div>

        {/* 캐릭터 무대 + 양옆 레일 */}
        <div className="stage-zone">
          {/* 왼쪽 레일 제거 — 출석을 오른쪽 뽑기 위로 옮기고 나머지(쿠폰)는 비활성화(숨김). */}
          {/* 쿠폰 복구 시: 아래 레일에 <button className="ricon" onClick={() => setModal('coupon')}>…</button> 추가. 모달·상태는 그대로. */}
          <div className="rail rail-r">
            <button className="fcard f-daily" onClick={doDaily}><span className="fico"><Ic n="calendar" s={42} /></span>출석{authed && !checkedIn && <span className="bd">1</span>}</button>
            <button className="fcard f-gacha" onClick={() => setModal('gacha')}><span className="fico"><Ic n="gift" s={42} /></span>뽑기</button>
            <button className="fcard f-shop" onClick={() => setModal('shop')}><span className="fico"><Ic n="shop" s={42} /></span>상점</button>
            <button className="fcard f-title" onClick={() => setModal('title')}><span className="fico"><Ic n="medal" s={42} /></span>칭호</button>
          </div>
          <div className="stage">
            <div className="pedestal" />
            <img className="hero-char" src="/hub-char.png" alt="CARI" />
            <div className="nameplate"><b>CARI</b> {titleBadge}</div>
          </div>
        </div>

        {/* 도크: 7일 출석 캘린더 + 메인 CTA(출석) */}
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
          {/* 미니게임은 /arena 하단 런처로 옮겼고, 이 자리는 랭킹 진입점이 됐다(옛 레벨선택 화면의 랭킹 버튼). */}
          <Link className="cta-main" to="/ranking">
            <span className="cta-star"><Ic n="trophy" s={24} /></span>
            랭킹
          </Link>
        </div>
        <div className="todo">
          <div className="todo-head">{t('hub.today_todo')}</div>
          <div className="todo-list">
            <div className={`todo-item ${checkedIn ? 'done' : ''}`}>
              <span className="todo-ic"><Ic n="calendar" s={22} /></span>
              <span className="todo-name">{t('hub.todo_attendance')}</span>
              <span className="todo-pt">+{ACTIVITY_DELTA.attendance}P</span>
              {checkedIn ? <span className="todo-chk">✓</span> : (
                <button className="todo-cta" onClick={doDaily}>GO</button>
              )}
            </div>
            <div className="todo-item is-placeholder">
              <span className="todo-ic"><Ic n="star" s={22} /></span>
              <span className="todo-name">{t('hub.todo_problem')}</span>
              <span className="todo-pt">—</span>
              <span className="todo-soon">Soon</span>
            </div>
            <div className="todo-item">
              <span className="todo-ic"><Ic n="book" s={22} /></span>
              <span className="todo-name">{t('hub.todo_learn')}</span>
              <span className="todo-pt">+{ACTIVITY_DELTA.daily_learn}P</span>
              <Link className="todo-cta" to="/daily">GO</Link>
            </div>
            <div className="todo-item">
              <span className="todo-ic"><Ic n="gift" s={22} /></span>
              <span className="todo-name">{t('hub.todo_game')}</span>
              <span className="todo-pt">+{ACTIVITY_DELTA.minigame}P</span>
              <Link className="todo-cta" to="/arena">GO</Link>
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className="hub-toast" onClick={() => setToast(null)}>
          <span className="hub-toast-ic">{/부족|필요|오류/.test(toast) ? '⚠️' : '✅'}</span>
          <span>{toast}</span>
          <button className="hub-toast-x" onClick={() => setToast(null)} aria-label="닫기">×</button>
        </div>
      )}

      {purchased && (
        <div className="hub-modal-backdrop buy-pop-backdrop" onClick={() => setPurchased(null)}>
          <div className="buy-pop" onClick={(e) => e.stopPropagation()}>
            <div className="buy-pop-spark"><span>✨</span><span>🎉</span><span>✨</span></div>
            <div className="buy-pop-title">{purchased.kind === 'dust' ? '교환 완료!' : '구매 완료!'}</div>
            <div className="buy-pop-thumb">{partEmoji(purchased.partKey)}</div>
            <div className="buy-pop-name">{partName(purchased.partKey)}</div>

            <button className="pbtn buy-pop-ok" style={btn('#6bbf9a')} onClick={() => setPurchased(null)}>확인</button>
          </div>
        </div>
      )}

      {modal === 'gacha' && (
        <Modal title="뽑기" onClose={() => setModal(null)}>
          <div className="gacha-head">
            <span className="gchip gchip-dust"><span className="dust-ic">✨</span><span className="num">{dust.toLocaleString()}</span><span className="dust-lab">가루</span></span>
            <span className="chip" style={{ margin: 0 }}>보유 {owned.size}종</span>
          </div>
          <div className="gacha-gauge">
            <div className="gacha-gauge-bar"><div className="gacha-gauge-fill" style={{ width: `${Math.min(100, (pity / PITY_CEILING) * 100)}%` }} /></div>
            <span className="gacha-gauge-lab">천장까지 {Math.max(0, PITY_CEILING - pity)}회</span>
          </div>
          <div className="gacha-stage">
            {drawing && (
              <div className="gacha-capsule">
                <span className="gacha-capsule-box">🎁</span>
              </div>
            )}
            {!drawing && lastDraw && (
              lastDraw.part ? (
                <div className="gacha-result is-rare">
                  <span className="gacha-ribbon">한정템!</span>
                  <span className="gacha-spark s1">✨</span><span className="gacha-spark s2">✨</span><span className="gacha-spark s3">✨</span>
                  <div className="gacha-result-icon">{partEmoji(lastDraw.part.key)}</div>
                  <b>{lastDraw.part.name}</b>
                  <span className="gacha-dustgain">가루 +{lastDraw.dust}</span>
                </div>
              ) : (
                <div className="gacha-result is-dust">
                  <div className="gacha-result-icon">✨</div>
                  <b>가루 +{lastDraw.dust}</b>
                  <span className="gacha-dust-hint">모아서 한정템 교환!</span>
                </div>
              )
            )}
          </div>
          <button className="pbtn gacha-draw-btn gacha-draw-full" onClick={doGacha} disabled={drawing}>{drawing ? '뽑는 중…' : `뽑기 (${DRAW_COST} 🪙)`}</button>
          <div className="gacha-exchange">
            <div className="gacha-ex-head">✨ 가루 교환소 <span className="gacha-ex-sub">뽑기 전용 한정템</span></div>
            <div className="gacha-ex-list">
              {exclusives.map((e) => {
                const has = owned.has(e.partKey)
                const canAfford = dust >= e.dustPrice
                return (
                  <div key={e.partKey} className={`gacha-ex-item ${has ? 'is-owned' : ''}`}>
                    {has && <span className="gacha-ex-owned">보유중</span>}
                    <div className="gacha-ex-thumb">{partEmoji(e.partKey)}</div>
                    <div className="gacha-ex-name">{partName(e.partKey)}</div>
                    <div className="gacha-ex-price">✨ {e.dustPrice}</div>
                    <button className="pbtn gacha-ex-buy" style={btn(has || !canAfford ? '#c3cbe0' : '#7b6bd6')} onClick={() => doExchange(e.partKey, e.dustPrice)} disabled={has}>{has ? '보유중' : '교환'}</button>
                  </div>
                )
              })}
            </div>
          </div>
          <p className="hub-modal-help">뽑기하면 항상 가루가 쌓여요. 천장(15회)엔 한정템이 확정! 가루로 원하는 한정템을 바로 교환할 수도 있어요.</p>
        </Modal>
      )}

      {modal === 'shop' && (
        <Modal title="상점" onClose={() => setModal(null)}>
          <div className="hub-shop-head">
            <span className="hub-shop-head-lab">보유 코인</span>
            <span className="gchip" style={{ margin: 0 }}><Ic n="coin" s={22} /><span className="num">{points.toLocaleString()}</span></span>
          </div>
          {catalog.length > 0 ? (
            <div className="hub-modal-grid">
              {catalog.map((c) => (
                <div key={c.partKey} className={`hub-shop-item ${c.rare ? 'is-rare' : ''}`}>
                  {c.rare && <span className="hub-shop-ribbon">레어</span>}
                  {owned.has(c.partKey) && <span className="hub-shop-owned">보유중</span>}

                  <div className="hub-shop-thumb">{partEmoji(c.partKey)}</div>
                  <div className="hub-shop-name">{partName(c.partKey)}</div>
                  <div className="hub-shop-price">🪙 {c.price}</div>
                  <button className="pbtn hub-shop-buy" style={btn(owned.has(c.partKey) ? '#c3cbe0' : '#6bbf9a')} onClick={() => doBuy(c.partKey, c.price)} disabled={owned.has(c.partKey)}>
                    {owned.has(c.partKey) ? '보유중' : '구매'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="hub-modal-help">{isFullUser ? '상점에 물건이 없어요.' : '로그인하면 상점을 이용할 수 있어요.'}</p>
          )}
        </Modal>
      )}

      {modal === 'coupon' && (
        <Modal title="쿠폰함" onClose={() => setModal(null)}>
          {coupons.length > 0 ? (
            <div className="ticket-shelf">
              {coupons.map((c) => (
                <div key={c.level} className={`ticket ${c.used ? 'is-used' : ''}`}>
                  <div className="ticket-stub">Lv.{c.level}</div>
                  <div className="ticket-main">
                    <b className="ticket-pct">{c.discount}% 할인</b>
                    <span className="ticket-sub">Lv.{c.level} 달성 보상</span>
                  </div>
                  <span className="ticket-stamp">{c.used ? '사용함' : '보유'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="ticket-shelf ticket-shelf-empty">
              <div className="ticket ticket-ghost"><span className="ticket-ghost-ic">🎫</span></div>
              <p className="hub-modal-help">{authed ? '아직 모은 쿠폰이 없어요. 레벨업하면 할인 쿠폰을 받아요!' : '로그인하면 쿠폰함이 보여요.'}</p>
            </div>
          )}
        </Modal>
      )}

      {modal === 'title' && (
        <Modal title="칭호" onClose={() => setModal(null)}>
          {titles.length > 0 ? (
            <div className="title-vault">
              {titles.map((tt, i) => (
                <span key={i} className="title-badge">🏅<b>CARIS {tt.track}</b><span className="title-badge-grade">{tt.grade}</span></span>
              ))}
            </div>
          ) : (
            <div className="title-vault title-vault-empty">
              {[1, 2, 3].map((i) => (
                <span key={i} className="title-slot">🔒</span>
              ))}
              <p className="hub-modal-help">{authed ? '아직 획득한 칭호가 없어요 — 자격증에 합격하면 채워져요' : '로그인하면 칭호 보관소가 보여요.'}</p>
            </div>
          )}
        </Modal>
      )}

    </div>
  )
}

function Modal({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="hub-modal-backdrop" onClick={onClose}>
      <div className={`hub-modal${className ? ' ' + className : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="hub-modal-head">
          <h3>{title}</h3>
          <button className="hub-modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="hub-modal-body">{children}</div>
      </div>
    </div>
  )
}
function btn(bg: string): CSSProperties {
  return { background: bg }
}
