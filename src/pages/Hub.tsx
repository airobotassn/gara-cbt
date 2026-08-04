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
import TierBadge from '../components/TierBadge'
import {
  type Tier,
  type ActivityKind,
  arenaLevelForScore,
  arenaBand,
  ACTIVITY_DELTA,
  ACTIVITY_PER_DAY,
  ACTIVITY_SEASON_MAX,
  LEVELTEST_CLEAR_POINTS,
  LEVELTEST_MAX,
  SEASON_MAX_POINTS,
} from '../lib/scoring'
import ShareCardModal from '../components/ShareCardModal'
import { countryName } from '../lib/regions'

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
  share: (<><circle cx="18" cy="5.5" r="2.8" fill="#86b2e2" stroke={IK} strokeWidth="1.8" /><circle cx="6" cy="12" r="2.8" fill="#f2c65e" stroke={IK} strokeWidth="1.8" /><circle cx="18" cy="18.5" r="2.8" fill="#74c6bf" stroke={IK} strokeWidth="1.8" /><path d="M8.5 10.7 15.5 6.9M8.5 13.3l7 3.8" stroke={IK} strokeWidth="1.8" strokeLinecap="round" /></>),
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
interface HubState { authed: boolean; level?: number | null; rankPoints?: number | null; points?: number; dust?: number; cosmetics?: string[]; stamps?: number; pity?: number; dailyDone?: boolean; learnDone?: boolean; minigameDone?: boolean; referralCode?: string | null; referralUsed?: boolean; titles?: { track: string; grade: string }[]; coupons?: { level: number; discount: number; used: boolean }[]; catalog?: CatalogItem[]; exclusives?: { partKey: string; dustPrice: number }[]; skillScore?: number | null; activityScore?: number | null; seasonTotal?: number | null; tier?: Tier | null; percentile?: number | null; pointsToPass?: number | null; rank?: number | null; rankTotal?: number | null }
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

type ModalKind = 'gacha' | 'shop' | 'coupon' | 'title' | 'share' | 'earn' | 'invite'

// 점수 획득 방법 모달의 활동 표 — 값은 전부 scoring.ts(원안 반영본) 파생이라 상수를 다시 적지 않는다.
//   ⚠️ 여기 '점수'는 랭킹 점수(user_progress.activity_score)다. HUD 의 코인(뽑기·상점 재화)과는 별개 지갑이다.
const EARN_ROWS: { kind: ActivityKind; icon: string; label: string }[] = [
  { kind: 'attendance', icon: 'calendar', label: '출석하기' },
  { kind: 'daily_learn', icon: 'book', label: '오늘의 학습 완료' },
  { kind: 'minigame', icon: 'star', label: '미니게임 플레이' },
  { kind: 'referral', icon: 'gift', label: '친구 초대' },
]

export default function Hub() {
  const { isFullUser, loginWithGoogle, user, loading } = useAuth()
  const { t, lang } = useT()
  const [points, setPoints] = useState(0)
  const [stamps, setStamps] = useState(0)
  const [checkedIn, setCheckedIn] = useState(false)
  // 오늘의 미션 3종 완료 플래그(daily_activity 의 종류별 플래그 — 행 존재로 판정하면 안 된다).
  const [learnDone, setLearnDone] = useState(false)
  const [minigameDone, setMinigameDone] = useState(false)
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // 초대코드 등록(받는 쪽) — used 는 계정당 1회라 한 번 true 가 되면 입력칸이 영구 비활성.
  const [referralUsed, setReferralUsed] = useState(false)
  const [redeemInput, setRedeemInput] = useState('')
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [owned, setOwned] = useState<Set<string>>(new Set())
  const [pity, setPity] = useState(0)
  // 시험 사다리 등급(user_progress.rank). HUD 의 Lv 는 이제 ARENA 레벨(점수 밴드)이라 화면에는 안 쓴다
  // — 서버는 계속 내려주므로 받아만 둔다(기존 skillScore/activityScore 와 같은 패턴).
  const [, setLevel] = useState<number | null>(null)
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
  const [displayName, setDisplayName] = useState<string | null>(null)
  // 공유 카드 하단 바용 프로필 값(가입일 · 국가 · 지역). 학교는 넣지 않는다.
  const [joinedAt, setJoinedAt] = useState<string | null>(null)
  const [countryCode, setCountryCode] = useState<string | null>(null)
  const [regionCode, setRegionCode] = useState<string | null>(null)
  // 공유 카드의 국가·지역 순위 — get-hub 는 전세계 순위만 준다. /ranking 의 두 탭과 같은 함수·같은 모수.
  const [scopedRanks, setScopedRanks] = useState<{
    country: { rank: number | null; total: number | null }
    region: { rank: number | null; total: number | null }
  } | null>(null)
  const [modal, setModal] = useState<ModalKind | null>(null)
  const [, setSkillScore] = useState(0)
  const [, setActivityScore] = useState(0)
  const [seasonTotal, setSeasonTotal] = useState(0) // 공유 카드의 시즌 점수 / 전투력
  const [tier, setTier] = useState<Tier | null>(null)
  const [percentile, setPercentile] = useState<number | null>(null)
  // '다음 순위까지 N점' — 옛 랭킹 게이지 라벨. 경험치 바가 ARENA 레벨 진행도로 바뀌면서 화면에서 빠졌다.
  const [, setPointsToPass] = useState<number | null>(null)
  const [rank, setRank] = useState<number | null>(null)
  const [rankTotal, setRankTotal] = useState<number | null>(null)

  const pushLog = (s: string) => {
    setToast(s)
    window.setTimeout(() => setToast((cur) => (cur === s ? null : cur)), 2600)
  }

  // 초대코드 복사 — navigator.clipboard 는 보안 컨텍스트(https/localhost)에서만 동작해 실패 시 폴백한다.
  async function copyInvite() {
    if (!referralCode) return
    try {
      await navigator.clipboard.writeText(referralCode)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = referralCode
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  // 초대코드 등록(받는 쪽). 온보딩과 달리 **실패를 그대로 알려준다** — 모달은 다시 열 수 있으니
  // 왜 안 됐는지 말해줘야 다시 칠 수 있다. 성공하면 계정당 1회라 입력칸이 영구 잠긴다.
  const REDEEM_ERR: Record<string, string> = {
    not_found: '없는 초대코드예요. 다시 확인해주세요',
    self: '내 초대코드는 쓸 수 없어요',
    already: '이미 초대코드를 등록했어요',
    unauthorized: '로그인이 필요해요',
  }
  async function redeemReferral() {
    const code = redeemInput.trim().toUpperCase()
    if (!code || redeeming || referralUsed) return
    setRedeeming(true)
    setRedeemMsg(null)
    try {
      const r = await callFunction<{ ok?: boolean; error?: string; credited?: boolean }>('redeem-referral', { code })
      if (r.ok) {
        setReferralUsed(true)
        setRedeemInput('')
        setRedeemMsg({ ok: true, text: '등록 완료! 초대해준 친구에게 점수가 들어갔어요' })
        void hydrate()
      } else {
        setRedeemMsg({ ok: false, text: REDEEM_ERR[r.error ?? ''] ?? '등록하지 못했어요' })
      }
    } catch {
      setRedeemMsg({ ok: false, text: '등록하지 못했어요' })
    }
    setRedeeming(false)
  }

  // 오늘의 미션 3종(시안 좌상단 카드). to=null 인 출석은 이 화면에서 바로 처리(doDaily), 나머지는 해당 화면으로 보낸다.
  //   ⚠️ 미니게임 진입점은 /arena 하단 런처다(허브에는 미니게임 진입점이 없다 — 중복 제거 결정).
  const missions: { kind: ActivityKind; icon: string; label: string; done: boolean; to: string | null }[] = [
    { kind: 'attendance', icon: 'calendar', label: '출석', done: checkedIn, to: null },
    { kind: 'daily_learn', icon: 'book', label: '오늘의 학습', done: learnDone, to: '/daily' },
    { kind: 'minigame', icon: 'star', label: '미니게임', done: minigameDone, to: '/arena' },
  ]
  const missionDone = missions.filter((m) => m.done).length

  // 프로필(본인 profiles) — 아바타는 HUD, 표시이름은 공유 카드에 쓴다. setState 는 프라미스 콜백에서만.
  useEffect(() => {
    const uid = user?.id
    if (!uid) return
    let alive = true
    supabase.from('profiles').select('avatar_url, display_name, created_at, country_code, region_code').eq('id', uid).maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setAvatarUrl((data?.avatar_url as string | null) ?? null)
        setDisplayName((data?.display_name as string | null) ?? null)
        setJoinedAt((data?.created_at as string | null) ?? null)
        setCountryCode((data?.country_code as string | null) ?? null)
        setRegionCode((data?.region_code as string | null) ?? null)
      })
    return () => { alive = false }
  }, [user?.id])

  // 국가·지역 순위는 공유 모달을 열 때만 가져온다 — 허브 진입마다 부르면 안 쓰는 조회가 2번 늘어난다.
  // 온보딩 전(needsRegion)이면 me 가 null 로 오고 카드엔 '—' 가 찍힌다.
  useEffect(() => {
    if (modal !== 'share' || scopedRanks) return
    let alive = true
    type LbResp = { total?: number; me?: { rank?: number } | null }
    Promise.all([
      callFunction<LbResp>('leaderboard', { scope: 'my-country' }).catch(() => null),
      callFunction<LbResp>('leaderboard', { scope: 'my-region' }).catch(() => null),
    ]).then(([c, r]) => {
      if (!alive) return
      const pick = (d: LbResp | null) => ({
        rank: d?.me?.rank ?? null,
        total: d?.me?.rank != null ? d?.total ?? null : null,
      })
      setScopedRanks({ country: pick(c), region: pick(r) })
    })
    return () => { alive = false }
  }, [modal, scopedRanks])

  // get-hub 응답을 상태에 반영(서버 권위값으로 동기화).
  function applyHub(h: HubState) {
    setPoints(h.points ?? 0)
    setStamps(h.stamps ?? 0)
    setPity(h.pity ?? 0)
    setCheckedIn(!!h.dailyDone)
    setLearnDone(!!h.learnDone)
    setMinigameDone(!!h.minigameDone)
    setReferralCode(h.referralCode ?? null)
    // referred_by 는 되돌릴 수 없다 — 한 번 true 면 서버 응답으로도 풀지 않는다(등록 직후 hydrate 가 덮어쓰는 것 방지).
    setReferralUsed((cur) => cur || !!h.referralUsed)
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
    setRank(h.rank ?? null)
    setRankTotal(h.rankTotal ?? null)
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
      // kind 명시 — 서버 기본값에 기대지 않는다(오늘의 학습과 종류가 갈린다).
      const r = await callFunction<DailyResp>('complete-daily', { kind: 'attendance' })
      // first=false 면 오늘 '오늘의 학습'으로 이미 재화를 받은 것 — 없는 적립을 있다고 쓰지 않는다.
      pushLog(r.first ? `출석 완료 · +${DAILY_POINTS}P · 스탬프 +1` : '출석 완료 · 오늘 보상은 이미 받았어요')
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
  // 다음 순위 게이지: 신규/무점수 유저는 '미배치'가 아니라 백분위 100%(꼴찌)·브론즈에서 시작 — 콘텐츠로 위로 올라간다.
  const dispTier: Tier = tier ?? 'bronze'
  // HUD 경험치 바 = **ARENA 레벨 진행도**(시즌 총점의 1,000점 밴드). 옛 '다음 순위까지 N점' 랭킹 게이지를 대체한다.
  //   ⚠️ 여기 Lv 는 시험 사다리 등급(user_progress.rank)이 아니라 점수 밴드다 — 둘은 별개 축이다(scoring.ts 참고).
  const arenaLv = arenaLevelForScore(seasonTotal)
  const [bandLo, bandHi] = arenaBand(arenaLv)
  // ⚠️ 라벨은 **바와 같은 기준**이어야 한다 — 구간 내 진행분/구간 폭. 절대 총점(5,700/6,000)을 쓰면
  //    사용자는 95% 로 읽는데 바는 70%(구간 5,000~6,000 안에서 700) 라 눈에 바로 어긋나 보인다.
  const bandSpan = bandHi + 1 - bandLo
  const bandCur = Math.max(0, Math.min(bandSpan, seasonTotal - bandLo))
  const gaugeFillPct = Math.max(0, Math.min(100, (bandCur / bandSpan) * 100))
  // 지역 표시명 — /ranking 탭 라벨과 같은 규칙(사전에 없는 코드는 코드 그대로 노출).
  const regionName = (code: string | null): string | null => {
    if (!code) return null
    const nm = t(`region.${code}`)
    return nm === `region.${code}` ? code : nm
  }

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
            onClick={() => {
              // 복귀 경로는 sessionStorage 로 넘긴다 — Supabase 가 redirect_to 의 query 를 유실시키므로(AuthCallback 참고).
              try { sessionStorage.setItem('postLoginRedirect', '/hub') } catch { /* 무시 */ }
              loginWithGoogle(`${window.location.origin}/auth/callback`)
            }}
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
        {/* 공유 = 지금 순위·티어·칭호로 카드(PNG) 를 만들어 내보낸다(ShareCardModal) */}
        <button className="hub-share" onClick={() => setModal('share')}>
          <span className="ic"><Ic n="share" s={16} /></span>공유
        </button>
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
            {/* 아바타 밑 Lv 배지는 뺐다 — 경험치 바가 'ARENA Lv.N' 을 이미 말한다(중복 + Lv 축 혼동). */}
            <div className="av"><Avatar avatarUrl={avatarUrl} seed={user?.id ?? 'guest'} size={44} /></div>
          </div>
          <div className="hud-mid">
            <div className="hud-name">
              CARI {titleBadge}
              {/* 티어 = 엠블렘 이미지 단독(public/emblems/<tier>.webp). 백분위(상위 N%)는 뺐다 —
                  허브에서 굳이 알려줄 값이 아니고, 순위 맥락은 랭킹 화면이 담당한다. */}
              <span className="tier-chip"><TierBadge tier={dispTier} size={26} alt={t(`rank.tier_${dispTier}`)} /></span>
            </div>
            <div className="hud-xp">
              {/* ARENA 레벨 경험치 바. 라벨은 바 안 오른쪽(exp-lab) — 바깥에 맨텍스트로 두면 덜렁거린다. */}
              {/* 바 안 왼쪽에 'ARENA Lv.N' — 레벨테스트 등급(Lv.1~7)과 이름이 겹쳐서, 이 바의 Lv 가 어느 축인지
                  바 스스로 밝히게 했다(원안 표의 표기도 'ARENA Lv.N' 이다). 오른쪽은 진행 점수. */}
              <div className="exp">
                <div className="exp-fill" style={{ width: `${gaugeFillPct}%` }} />
                <span className="exp-txt">
                  <span className="exp-lv">ARENA Lv.{arenaLv}</span>
                  {/* 좁은 화면은 분수를 넣으면 'ARENA Lv.N' 이 잘려서 %로 줄인다(둘 다 같은 값이라 어긋나지 않는다). */}
                  <span className="exp-lab">
                    <span className="exp-pct">{Math.round(gaugeFillPct)}%</span>
                    <span className="exp-frac">{bandCur.toLocaleString()} / {bandSpan.toLocaleString()}</span>
                  </span>
                </span>
              </div>
              {/* '?' 는 점수(경험치 바) 쪽 도움말이다 — 코인 옆에 두면 코인 설명으로 읽혀서 바 바로 뒤에 붙였다. */}
              <button className="hub-help" onClick={() => setModal('earn')} aria-label="점수 획득 방법">?</button>
              {/* data-tip = 호버 툴팁("보유한 CARI 코인") — hub.css 의 .gchip[data-tip]::after */}
              <span className="gchip" data-tip="보유한 CARI 코인"><Ic n="coin" s={26} /><span className="num">{points.toLocaleString()}</span></span>
            </div>
          </div>
        </div>

        {/* 오늘의 미션 — 무대 **위 가로 한 줄**(하단 '출석 보상' 스트립과 같은 형태).
            좌측 열로 두면 카드 하나 때문에 캐릭터가 옆으로 밀려서 전체 폭 한 줄로 옮겼다 → 캐릭터는 정중앙 유지.
            완료 판정은 서버 플래그(daily_activity 종류별), 점수는 scoring.ts 의 ACTIVITY_DELTA 파생. */}
        <div className="mission-bar">
          <span className="ms-title"><Ic n="star" s={16} /> 오늘의 미션</span>
          <div className="ms-chips">
          {missions.map((m) => {
            const body = (
              <>
                <Ic n={m.icon} s={16} />
                <span className="ms-chip-lab">{m.label}</span>
                <span className="ms-chip-pt">+{ACTIVITY_DELTA[m.kind]}</span>
                {m.done && <span className="ms-chip-chk">✓</span>}
              </>
            )
            const cls = `ms-chip${m.done ? ' on' : ''}`
            return m.to
              ? <Link key={m.kind} className={cls} to={m.to}>{body}</Link>
              : <button key={m.kind} className={cls} onClick={doDaily}>{body}</button>
          })}
          </div>
          <span className="ms-n">{missionDone}/{missions.length}</span>
        </div>

        {/* 친구 초대는 화면에 카드로 꺼내지 않는다 — 도크 '초대하기' 버튼 모달 하나로 모았다(진입점 중복 제거). */}
        <div className="stage-zone">
            {/* 왼쪽 레일 제거 — 출석을 오른쪽 뽑기 위로 옮기고 나머지(쿠폰)는 비활성화(숨김). */}
            {/* 쿠폰 복구 시: 아래 레일에 <button className="ricon" onClick={() => setModal('coupon')}>…</button> 추가. 모달·상태는 그대로. */}
            <div className="rail rail-r">
              <button className="fcard f-daily" onClick={doDaily}><span className="fico"><Ic n="calendar" s={42} /></span>출석{authed && !checkedIn && <span className="bd">1</span>}</button>
              <button className="fcard f-gacha" onClick={() => setModal('gacha')}><span className="fico"><Ic n="gift" s={42} /></span>뽑기</button>
              <button className="fcard f-shop" onClick={() => setModal('shop')}><span className="fico"><Ic n="shop" s={42} /></span>상점</button>
              <button className="fcard f-title" onClick={() => setModal('title')}><span className="fico"><Ic n="medal" s={42} /></span>칭호</button>
              <button className="fcard f-invite" onClick={() => setModal('invite')}><span className="ev">EVENT</span><span className="fico"><Ic n="share" s={42} /></span>초대하기</button>
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
            <span className="hub-shop-head-lab">보유 CARI 코인</span>
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

      {modal === 'share' && (
        <ShareCardModal
          onClose={() => setModal(null)}
          data={{
            name: displayName?.trim() || user?.user_metadata?.name || 'CARI',
            avatarUrl,
            seed: user?.id ?? 'guest',
            tier,
            tierLabel: t(`rank.tier_${dispTier}`),
            percentile,
            rank,
            rankTotal,
            countryRank: scopedRanks?.country.rank ?? null,
            countryTotal: scopedRanks?.country.total ?? null,
            regionRank: scopedRanks?.region.rank ?? null,
            regionTotal: scopedRanks?.region.total ?? null,
            seasonTotal,
            joinedAt,
            country: countryCode ? countryName(countryCode, lang) : null,
            region: regionName(regionCode),
          }}
        />
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

      {/* 점수 획득 방법 — 표의 모든 수치는 scoring.ts(원안 반영본) 파생이라 여기서 하드코딩하지 않는다. */}
      {modal === 'earn' && (
        <Modal title="점수 획득 방법" onClose={() => setModal(null)}>
          <p className="hub-modal-help earn-lead">다양한 활동에 참여하고 점수를 모아 랭킹에 도전하세요!</p>
          <table className="earn-tb">
            <thead><tr><th>활동 항목</th><th>획득 점수</th></tr></thead>
            <tbody>
              {EARN_ROWS.map((r) => (
                <tr key={r.kind}>
                  <td className="earn-nm"><span className="earn-ic"><Ic n={r.icon} s={20} /></span>{r.label}</td>
                  <td className="earn-v">
                    +{ACTIVITY_DELTA[r.kind]}점
                    <em>일 {ACTIVITY_PER_DAY[r.kind]}회 · 시즌 최대 {ACTIVITY_SEASON_MAX[r.kind].toLocaleString()}점</em>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="earn-lv">
            <div className="earn-lv-head"><Ic n="trophy" s={18} /> 레벨테스트 <em>레벨 클리어 시</em></div>
            <div className="earn-lv-grid">
              {[1, 2, 3, 4, 5, 6, 7].map((lv) => (
                <div key={lv} className="earn-lv-cell"><b>Lv.{lv}</b>+{LEVELTEST_CLEAR_POINTS.toLocaleString()}</div>
              ))}
            </div>
            <p className="hub-modal-help">7단계를 모두 통과하면 {LEVELTEST_MAX.toLocaleString()}점 · 활동까지 더한 시즌 만점은 {SEASON_MAX_POINTS.toLocaleString()}점이에요.</p>
          </div>

        </Modal>
      )}

      {modal === 'invite' && (
        <Modal title="친구 초대" onClose={() => setModal(null)}>
          <div className="iv-title">친구와 함께 CARIS 하세요!</div>
          <p className="hub-modal-help">내 초대코드를 알려주면 친구가 바로 시작할 수 있어요.</p>
          <div className="iv-code iv-code-lg">
            <span className="iv-code-lab">내 초대코드</span>
            <b className="iv-code-v">{referralCode ?? '––––'}</b>
            <button className="iv-copy" onClick={copyInvite} disabled={!referralCode}>{copied ? '복사됨' : '복사'}</button>
          </div>
          {!referralCode && <p className="hub-modal-help">{authed ? '초대코드를 발급하는 중이에요.' : '로그인하면 초대코드가 발급돼요.'}</p>}

          {/* 받는 쪽 — 계정당 1회, 성공하면 영구 잠금. 실패는 이유를 그대로 알려준다. */}
          <div className="iv-redeem">
            <div className="iv-redeem-head">친구 초대코드 입력</div>
            {referralUsed ? (
              <p className="iv-redeem-done">✓ 초대코드를 등록했어요 (한 번만 가능해요)</p>
            ) : (
              <>
                <div className="iv-code">
                  <input
                    className="iv-redeem-in"
                    value={redeemInput}
                    onChange={(e) => { setRedeemInput(e.target.value); setRedeemMsg(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') void redeemReferral() }}
                    placeholder="CARIXXXX"
                    maxLength={8}
                    disabled={redeeming}
                    aria-label="친구 초대코드"
                  />
                  <button className="iv-copy" onClick={redeemReferral} disabled={redeeming || !redeemInput.trim()}>
                    {redeeming ? '확인 중' : '등록'}
                  </button>
                </div>
                <p className="hub-modal-help iv-redeem-hint">한 번 등록하면 바꿀 수 없어요.</p>
              </>
            )}
            {redeemMsg && <p className={`iv-redeem-msg${redeemMsg.ok ? ' is-ok' : ''}`}>{redeemMsg.text}</p>}
          </div>
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
