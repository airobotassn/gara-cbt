// 캐릭터 허브(실동작) — /demo 첫 시안 기반 단일 로비 화면.
//   출석·뽑기·상점·쿠폰·칭호는 전부 실제 백엔드 호출로 동작하며, 상세 동작은 팝업(모달)에서 처리한다.
//   초기 재화·보유파츠·스탬프·천장·출석여부·카탈로그·쿠폰·칭호는 get-hub 로 하이드레이트(RLS 잠금 테이블이라 이 함수만 읽음).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import '../styles/hub.css'
import { callFunction, supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { Avatar } from '../components/GemAvatar'
import RoomView from '../components/RoomView'
import { furnitureArt, roomUrl, type RoomSlot, type RoomSlots } from '../lib/room'
import { Link } from 'react-router-dom'
import { useT, type TFunc } from '../lib/i18n'
import {
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
import { tierName } from '../lib/caris'

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

// 파츠 이름은 사전(hub.part.<key>)에 있다 — 여기 name 은 두지 않는다(두면 화면마다 어느 쪽을 쓰는지 갈린다).
//
// ⚠️ 뽑기 풀 사본(옛 POOL 상수)은 **삭제했다.** 뽑기 결과를 그 사본에서 찾아 이름을 붙이고 있었는데,
//    풀이 가구로 바뀌자(20260814090000) 사본에 없는 키가 와서 결과창이 "가루만 받음" 으로 표시됐다.
//    서버가 준 part_key 를 그대로 쓰면 풀을 바꿔도 화면이 안 깨진다.
// 모듈 최상위라 훅을 못 쓴다 → t 를 넘겨받는다. 사전에 없는 키는 tr() 이 키를 그대로 돌려주므로 최소한 깨지진 않는다.
function partName(key: string, t: TFunc) {
  return t(`hub.part.${key}`)
}
function partEmoji(key: string) {
  // 가구는 방 렌더러와 **같은 그림**을 쓴다 — 상점 썸네일과 방에 놓인 물건이 다르면 뭘 산 건지 알 수 없다.
  if (key.startsWith('fur_')) return furnitureArt(key)
  if (key.startsWith('hat')) return '🧢'
  if (key.startsWith('shoe')) return '👟'
  if (key.startsWith('glasses')) return '👓'
  if (key.startsWith('wing')) return '✨'
  if (key.startsWith('crown')) return '👑'
  return '🎁'
}

// ── 서버 계약(입출력) ──
// kind·surface 는 방 꾸미기(2026-08-14)에서 붙었다. 파츠(kind='part')는 상점에서 내려가 이제 안 온다.
interface CatalogItem { partKey: string; price: number; rare: boolean; kind?: string; surface?: string | null }
interface HubState { authed: boolean; level?: number | null; rankPoints?: number | null; points?: number; dust?: number; cosmetics?: string[]; stamps?: number; pity?: number; dailyDone?: boolean; learnDone?: boolean; minigameDone?: boolean; referralCode?: string | null; referralUsed?: boolean; titles?: TitleItem[]; coupons?: { level: number; discount: number; used: boolean }[]; catalog?: CatalogItem[]; exclusives?: { partKey: string; dustPrice: number }[]; skillScore?: number | null; activityScore?: number | null; seasonTotal?: number | null; percentile?: number | null; pointsToPass?: number | null; rank?: number | null; rankTotal?: number | null; giftsToday?: GiftToday[]; giftsOlder?: number; giftsUnseen?: number;
  // 방(미니룸) — layout(슬롯 목록 + %좌표)은 서버가 통째로 준다. 프론트에 슬롯표를 두지 않는다.
  room?: { slots: RoomSlots; layout: RoomSlot[] }
  // 가구 전체(면 포함). catalog 와 달리 상점에서 내린 한정템도 들어 있다 — 이미 가진 사람은 계속 놓을 수 있어야 하므로.
  furniture?: { partKey: string; surface: string }[] }
interface GachaResp { part_key: string | null; dust_gained: number; pity_before: number; pity_after: number; points_after: number; dust_after: number; duplicate: boolean }
interface ShopResp { part_key: string; spent_points: number; points_after: number }
interface ExchangeResp { part_key: string; spent_dust: number; dust_after: number }
// stamps = 적립 뒤 7일 사이클 위치(1..7), bonus = 7일 완주 보너스 코인(0 이면 없음).
interface DailyResp { ok: boolean; day: string; first: boolean; stamps?: number | null; bonus?: number }

// 방 저장 거절 사유(room 함수)도 사람 말로 옮긴다 — 'wrong_surface' 가 그대로 뜨면 원인 불명의 오류로 보인다.
const FRIENDLY_ERR = new Set([
  'insufficient_points', 'insufficient_dust', 'already_owned', 'unauthorized',
  'not_owned', 'not_furniture', 'wrong_surface',
])
function friendlyError(e: unknown, t: TFunc): string {
  const msg = e instanceof Error ? e.message : ''
  return FRIENDLY_ERR.has(msg) ? t(`hub.err.${msg}`) : t('hub.err.generic')
}

type TitleItem = { tier: string; exam_title?: string }

type ModalKind = 'gacha' | 'shop' | 'coupon' | 'title' | 'share' | 'earn' | 'invite' | 'gift'

// 면 라벨 사전 키 — 'floor'/'wall' 이 곧 키라서 표를 두 벌 두지 않는다(hub.earn.row.<kind> 와 같은 관례).
const surfaceLabel = (surface: string, t: TFunc) => t(`hub.room.surface_${surface}`)

// 코인 선물 — 받은 것(오늘, 사람별 합산) / 이력 한 줄.
type GiftToday = { name: string; amount: number; count: number }
type GiftRow = { id: string; dir: 'in' | 'out'; name: string; amount: number; at: string }
type GiftLookupResp = { name?: string; error?: string }
type GiftSendResp = { duplicate: boolean; amount: number; recipient_name: string; points_after: number }
type GiftHistoryResp = { rows: GiftRow[]; next: string | null }

// 점수 획득 방법 모달의 활동 표 — 값은 전부 scoring.ts(원안 반영본) 파생이라 상수를 다시 적지 않는다.
//   ⚠️ 여기 '점수'는 랭킹 점수(user_progress.activity_score)다. HUD 의 코인(뽑기·상점 재화)과는 별개 지갑이다.
// 라벨은 사전 키(hub.earn.row.<kind>)로 조립한다 — kind 가 곧 키라서 표를 두 벌 관리하지 않는다.
const EARN_ROWS: { kind: ActivityKind; icon: string }[] = [
  { kind: 'attendance', icon: 'calendar' },
  { kind: 'daily_learn', icon: 'book' },
  { kind: 'minigame', icon: 'star' },
  { kind: 'referral', icon: 'gift' },
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
  // 코인 선물. giftNonce 는 **모달을 열 때 한 번** 만들고 전송이 성공할 때까지 고정한다 —
  // 뽑기·상점처럼 호출마다 randomUUID() 를 만들면 타임아웃 후 재시도가 두 번 보내기가 되고,
  // 즉시 이체라 회수할 방법이 없다. 서버 멱등(unique(sender_id, client_nonce))은 같은 값이 와야 걸린다.
  const [giftNonce, setGiftNonce] = useState<string | null>(null)
  const [giftCode, setGiftCode] = useState('')
  // 코드 8자 완성 시 자동 조회 결과. 실패는 **문구가 아니라 사전 키**로 들고 있는다 —
  // 그래야 조회 이펙트가 t 에 의존하지 않는다(t 는 렌더마다 새로 만들어져서 deps 에 넣으면 이펙트가 매 렌더 돈다).
  // 덤으로 조회 후 언어를 바꿔도 메시지가 같이 바뀐다.
  const [giftTo, setGiftTo] = useState<{ ok: true; name: string } | { ok: false; errKey: string } | null>(null)
  const [giftAmount, setGiftAmount] = useState('')
  const [giftConfirm, setGiftConfirm] = useState(false) // 되돌릴 수 없어서 확인 단계를 반드시 거친다
  const [giftSending, setGiftSending] = useState(false)
  const [giftMsg, setGiftMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [giftsToday, setGiftsToday] = useState<GiftToday[]>([])
  const [giftsOlder, setGiftsOlder] = useState(0)
  const [giftsUnseen, setGiftsUnseen] = useState(0)
  // 모달을 연 시점의 '받은 선물' 스냅샷. 화면은 이걸 그린다.
  //   서버 값(giftsToday)을 직접 그리면, 모달 안에서 선물을 보낸 뒤 hydrate() 가 돌 때
  //   이미 seen 처리된 목록이 빈 배열로 돌아와 **보고 있던 블록이 눈앞에서 사라진다.**
  const [giftGot, setGiftGot] = useState<GiftToday[]>([])
  const [giftGotOlder, setGiftGotOlder] = useState(0)
  const [giftHistory, setGiftHistory] = useState<GiftRow[] | null>(null)
  const [giftHistoryOpen, setGiftHistoryOpen] = useState(false)
  const [owned, setOwned] = useState<Set<string>>(new Set())
  // 방(미니룸). layout 은 서버가 준 것만 쓴다 — 슬롯표를 프론트에 복제하지 않는다(_shared/room.ts 가 단일 출처).
  const [roomSlots, setRoomSlots] = useState<RoomSlots>({})
  const [roomLayout, setRoomLayout] = useState<RoomSlot[]>([])
  const [furniture, setFurniture] = useState<{ partKey: string; surface: string }[]>([])
  const [editing, setEditing] = useState(false)
  const [pickSlot, setPickSlot] = useState<string | null>(null) // 가구 고르기 모달이 열린 슬롯
  const [roomCopied, setRoomCopied] = useState(false)
  const [pity, setPity] = useState(0)
  // 시험 사다리 등급(user_progress.rank). HUD 의 Lv 는 이제 ARENA 레벨(점수 밴드)이라 화면에는 안 쓴다
  // — 서버는 계속 내려주므로 받아만 둔다(기존 skillScore/activityScore 와 같은 패턴).
  const [, setLevel] = useState<number | null>(null)
  const [authed, setAuthed] = useState(false)
  // 칭호 = 합격한 티어. 급수(1급~4급)는 2026-07 체계 개편으로 사라졌다(20260807130000).
  const [titles, setTitles] = useState<TitleItem[]>([])
  const [coupons, setCoupons] = useState<{ level: number; discount: number; used: boolean }[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [dust, setDust] = useState(0)
  const [exclusives, setExclusives] = useState<{ partKey: string; dustPrice: number }[]>([])
  const [lastDraw, setLastDraw] = useState<{ dust: number; partKey: string | null } | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [purchased, setPurchased] = useState<{ partKey: string; kind: 'coin' | 'dust' } | null>(null)
  const [toast, setToast] = useState<{ text: string; bad: boolean } | null>(null)
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
  const [percentile, setPercentile] = useState<number | null>(null)
  // '다음 순위까지 N점' — 옛 랭킹 게이지 라벨. 경험치 바가 ARENA 레벨 진행도로 바뀌면서 화면에서 빠졌다.
  const [, setPointsToPass] = useState<number | null>(null)
  const [rank, setRank] = useState<number | null>(null)
  const [rankTotal, setRankTotal] = useState<number | null>(null)

  // ⚠️ 토스트는 **종류를 같이 들고 다닌다.** 예전엔 아이콘을 문구 정규식(/부족|필요|오류/)으로 골랐는데,
  //    그건 화면이 한국어일 때만 성립하는 판정이라 i18n 이관과 동시에 전부 ✅ 로 깨진다(2026-08-07).
  const pushLog = (s: string, bad = false) => {
    const next = { text: s, bad }
    setToast(next)
    window.setTimeout(() => setToast((cur) => (cur === next ? null : cur)), 2600)
  }
  const pushErr = (s: string) => pushLog(s, true)

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
    not_found: t('hub.invite.err_not_found'),
    self: t('hub.invite.err_self'),
    already: t('hub.invite.err_already'),
    unauthorized: t('hub.err.unauthorized'),
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
        setRedeemMsg({ ok: true, text: t('hub.invite.ok') })
        void hydrate()
      } else {
        setRedeemMsg({ ok: false, text: REDEEM_ERR[r.error ?? ''] ?? t('hub.invite.fail') })
      }
    } catch {
      setRedeemMsg({ ok: false, text: t('hub.invite.fail') })
    }
    setRedeeming(false)
  }

  // 오늘의 미션 3종(시안 좌상단 카드). to=null 인 출석은 이 화면에서 바로 처리(doDaily), 나머지는 해당 화면으로 보낸다.
  //   ⚠️ 미니게임은 **목록 페이지(/games)로 바로** 보낸다. 예전엔 /arena 로 보냈는데, 그때는
  //      아레나 하단 런처가 유일한 진입점이었기 때문이다. 지금은 /games 가 목록 페이지라
  //      /arena 로 보내면 지도만 뜨고 미션은 한 단계 더 찾아 들어가야 끝난다.
  const missions: { kind: ActivityKind; icon: string; label: string; done: boolean; to: string | null }[] = [
    { kind: 'attendance', icon: 'calendar', label: t('hub.mission.attendance'), done: checkedIn, to: null },
    { kind: 'daily_learn', icon: 'book', label: t('hub.mission.daily_learn'), done: learnDone, to: '/daily' },
    { kind: 'minigame', icon: 'star', label: t('hub.mission.minigame'), done: minigameDone, to: '/games' },
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
    setPercentile(h.percentile ?? null)
    setPointsToPass(h.pointsToPass ?? null)
    setRank(h.rank ?? null)
    setRankTotal(h.rankTotal ?? null)
    setGiftsToday(h.giftsToday ?? [])
    setGiftsOlder(h.giftsOlder ?? 0)
    setGiftsUnseen(h.giftsUnseen ?? 0)
    setFurniture(h.furniture ?? [])
    // ⚠️ 배치는 서버 응답으로 **덮어쓴다**(낙관적 반영을 되돌리는 게 아니라 권위값 동기화).
    //    layout 은 비어 있으면 갱신하지 않는다 — 옛 배포본 응답에 room 이 없으면 방이 통째로 사라진다.
    if (h.room) {
      setRoomSlots(h.room.slots ?? {})
      if (h.room.layout?.length) setRoomLayout(h.room.layout)
    }
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
      // 보너스 금액은 서버가 준 값을 그대로 쓴다(화면에 상수를 또 두면 서버와 어긋난다).
      const bonus = r.bonus ?? 0
      pushLog(
        !r.first ? t('hub.toast.checkin_already')
          : bonus > 0 ? t('hub.toast.checkin_bonus', { n: DAILY_POINTS, b: bonus })
            : t('hub.toast.checkin_done', { n: DAILY_POINTS }),
      )
      await hydrate()
    } catch (e) {
      pushErr(friendlyError(e, t))
    }
  }
  // 뽑기 → gacha-draw (서버권위/멱등 nonce/천장/환급). 서버 결과로 토스트, get-hub 로 재동기화.
  async function doGacha() {
    if (!isFullUser) { void loginWithGoogle(); return }
    if (points < DRAW_COST) { pushErr(t('hub.toast.no_coin')); return }
    try {
      setDrawing(true)
      setLastDraw(null)
      const r = await callFunction<GachaResp>('gacha-draw', { pool_key: 'default', client_nonce: crypto.randomUUID() })
      window.setTimeout(() => {
        setLastDraw({ dust: r.dust_gained, partKey: r.part_key })
        setDrawing(false)
      }, 900)
      await hydrate()
    } catch (e) {
      setDrawing(false)
      pushErr(friendlyError(e, t))
    }
  }
  // 상점 → shop-buy (가격은 서버 카탈로그 권위).
  async function doBuy(partKey: string, price: number) {
    if (!isFullUser) { void loginWithGoogle(); return }
    if (owned.has(partKey)) return
    if (points < price) { pushErr(t('hub.toast.no_points_item', { name: partName(partKey, t), price })); return }
    try {
      await callFunction<ShopResp>('shop-buy', { part_key: partKey, client_nonce: crypto.randomUUID() })
      setPurchased({ partKey, kind: 'coin' })
      await hydrate()
    } catch (e) {
      pushErr(friendlyError(e, t))
    }
  }

  // ── 방 꾸미기 ──
  // 배치 저장은 **낙관적 반영 + 실패 시 되돌리기**다. 가구를 놓는 건 눌렀을 때 바로 보여야 하는 동작이라
  // 서버 응답을 기다리면 한 박자 늦게 나타난다. 대신 서버가 거절하면 반드시 원래대로 돌려놓는다
  // — 안 돌리면 화면엔 놓여 있는데 새로고침하면 사라지는(= 원인 모를) 상태가 된다.
  async function saveRoom(next: RoomSlots) {
    const prev = roomSlots
    setRoomSlots(next)
    try {
      await callFunction('room', { action: 'save', slots: next })
    } catch (e) {
      setRoomSlots(prev)
      pushErr(friendlyError(e, t))
    }
  }
  // 슬롯에 가구를 놓거나(partKey) 치운다(null).
  function placeInSlot(slotKey: string, partKey: string | null) {
    const next: RoomSlots = { ...roomSlots }
    if (partKey) {
      // 같은 가구를 두 자리에 둘 수 없다 — 하나뿐인 물건이라 복제로 보인다. 옮기는 것으로 처리한다.
      for (const k of Object.keys(next)) if (next[k] === partKey) delete next[k]
      next[slotKey] = partKey
    } else {
      delete next[slotKey]
    }
    setPickSlot(null)
    void saveRoom(next)
  }
  async function copyRoomLink() {
    if (!user?.id) return
    const url = roomUrl(user.id)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setRoomCopied(true)
    window.setTimeout(() => setRoomCopied(false), 1600)
  }

  // 가루 교환 → gacha-exchange (뽑기 전용 한정템 지정 확정). 성공 시 리워드 팝업.
  async function doExchange(partKey: string, price: number) {
    if (!isFullUser) { void loginWithGoogle(); return }
    if (owned.has(partKey)) return
    if (dust < price) { pushErr(t('hub.toast.no_dust')); return }
    try {
      await callFunction<ExchangeResp>('gacha-exchange', { part_key: partKey, client_nonce: crypto.randomUUID() })
      setPurchased({ partKey, kind: 'dust' })
      await hydrate()
    } catch (e) {
      pushErr(friendlyError(e, t))
    }
  }

  // ---------- 코인 선물 ----------
  // 즉시 이체다. 취소·회수 경로가 없어서 방어선은 (a) 코드 8자 완성 시 닉네임 노출 (b) 확인 단계
  // (c) nonce 재사용 셋뿐이다. 서버는 잠금 순서·잔액·멱등·원장을 전부 RPC 한 트랜잭션에서 처리한다.
  function openGift() {
    if (!isFullUser) { void loginWithGoogle(); return }
    setGiftNonce(crypto.randomUUID()) // ⚠️ 여기서 한 번만. 전송 성공 전까지 이 값을 재사용한다.
    setGiftGot(giftsToday); setGiftGotOlder(giftsOlder) // 연 시점으로 고정 — 아래 seen 처리에 지워지지 않게
    setGiftCode(''); setGiftTo(null); setGiftAmount('')
    setGiftConfirm(false); setGiftMsg(null)
    setGiftHistory(null); setGiftHistoryOpen(false)
    setModal('gift')
    // 받은 선물은 모달을 여는 것으로 '확인'된다. 실패해도 무시 — 다음에 열면 다시 시도된다.
    if (giftsUnseen > 0) {
      callFunction('coin-gift', { action: 'seen' })
        .then(() => { setGiftsUnseen(0); setGiftsOlder(0) })
        .catch(() => {})
    }
  }

  // 코드 8자가 채워지면 자동 조회 — 조회 버튼을 따로 두지 않는다(동선 하나 줄이고, 이름이 곧 확인 절차다).
  // 서버 쿼터는 10분 30회라 사람이 타이핑하는 속도로는 닿지 않는다.
  useEffect(() => {
    if (modal !== 'gift') return
    const code = giftCode.trim().toUpperCase()
    // 8자 미만이면 아무것도 하지 않는다 — 이전 이름을 지우는 건 onChange 가 맡는다.
    // (이 파일 규칙: 이펙트 본문에서 동기 setState 금지. setState 는 프라미스 콜백에서만.)
    if (code.length !== 8) return
    let alive = true
    const timer = window.setTimeout(() => {
      callFunction<GiftLookupResp>('coin-gift', { action: 'lookup', code })
        .then((r) => {
          if (!alive) return
          if (r.name) { setGiftTo({ ok: true, name: r.name }); return }
          const map: Record<string, string> = {
            not_found: 'hub.gift.err_not_found',
            self: 'hub.gift.err_self_code',
            too_many: 'hub.gift.err_too_many',
          }
          setGiftTo({ ok: false, errKey: map[r.error ?? ''] ?? 'hub.gift.err_lookup' })
        })
        .catch(() => { if (alive) setGiftTo({ ok: false, errKey: 'hub.gift.err_lookup' }) })
    }, 250)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [giftCode, modal])

  async function doGift() {
    if (!giftNonce || giftSending) return
    const amount = Math.floor(Number(giftAmount))
    if (!Number.isFinite(amount) || amount <= 0) { setGiftMsg({ ok: false, text: t('hub.gift.err_amount_required') }); return }
    try {
      setGiftSending(true)
      setGiftMsg(null)
      const r = await callFunction<GiftSendResp>('coin-gift', {
        action: 'send',
        code: giftCode.trim().toUpperCase(),
        amount,
        client_nonce: giftNonce, // ⚠️ 재시도에도 같은 값 — 새로 만들면 두 번 보내진다.
      })
      setGiftMsg({ ok: true, text: t('hub.gift.sent_ok', { name: r.recipient_name, n: r.amount.toLocaleString() }) })
      // 성공했으니 이 nonce 는 소진됐다. 이어서 또 보내려면 새 값이 필요하다.
      setGiftNonce(crypto.randomUUID())
      setGiftCode(''); setGiftTo(null); setGiftAmount(''); setGiftConfirm(false)
      setGiftHistory(null) // 이력을 펼쳐놨다면 다음에 열 때 새로 받는다
      await hydrate()
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      const map: Record<string, string> = {
        insufficient: t('hub.gift.err_insufficient'),
        not_found: t('hub.gift.err_not_found'),
        self: t('hub.gift.err_self'),
        invalid_amount: t('hub.gift.err_invalid_amount'),
        too_fast: t('hub.gift.err_too_fast'),
        unauthorized: t('hub.err.unauthorized'),
      }
      setGiftMsg({ ok: false, text: map[code] ?? t('hub.gift.err_send_fail') })
      setGiftConfirm(false)
    } finally {
      setGiftSending(false)
    }
  }

  async function toggleGiftHistory() {
    const next = !giftHistoryOpen
    setGiftHistoryOpen(next)
    if (!next || giftHistory) return
    try {
      const r = await callFunction<GiftHistoryResp>('coin-gift', { action: 'history', limit: 30 })
      setGiftHistory(r.rows ?? [])
    } catch {
      setGiftHistory([])
    }
  }

  // 쿠폰 배지 카운트 — 진입 버튼을 숨겨(비활성화) 현재 미사용. 버튼 되살리면 함께 복구.
  // const unusedCoupons = coupons.filter((c) => !c.used).length
  // RPC 가 exam_tiers.sort 내림차순으로 주므로 [0] 이 최상위 자격이다.
  const titleBadge = titles[0] ? <span className="tt">🏆 CARIS {tierName(titles[0].tier)}</span> : null
  // 가구 고르기 모달 파생값 — 고른 슬롯의 면과 맞고 **내가 가진** 가구만 후보다.
  //   면을 안 거르면 벽시계가 바닥 후보로 뜨고, 눌러도 서버가 wrong_surface 로 거절해 헛클릭이 된다.
  const pickSlotDef = pickSlot ? roomLayout.find((s) => s.key === pickSlot) ?? null : null
  const pickable = pickSlotDef ? furniture.filter((f) => f.surface === pickSlotDef.surface && owned.has(f.partKey)) : []
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
          <p className="hub-gate-sub">{t('hub.gate_sub')}</p>
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
        {/* 오른쪽 두 버튼은 묶어둔다 — .hub-backrow 가 space-between 이라 낱개로 넣으면 셋이 흩어진다.
            선물은 초대하기 모달에 넣지 않고 여기 독립 진입점으로 둔다(2026-08-07 결정). */}
        <div className="hub-backrow-act">
          {/* 코인 선물 = 친구코드로 CARI 코인을 즉시 이체. 뱃지 = 아직 확인 안 한 받은 선물 건수. */}
          <button className="hub-share hub-gift" onClick={openGift}>
            <span className="ic"><Ic n="coin" s={16} /></span>{t('hub.gift_btn')}
            {giftsUnseen > 0 && <span className="bd">{giftsUnseen}</span>}
          </button>
          {/* 공유 = 지금 순위·티어·칭호로 카드(PNG) 를 만들어 내보낸다(ShareCardModal) */}
          <button className="hub-share" onClick={() => setModal('share')}>
            <span className="ic"><Ic n="share" s={16} /></span>{t('hub.share')}
          </button>
        </div>
      </div>

      {!isFullUser && (
        <div className="slim-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span>{t('hub.banner_login')}</span>
          <button className="pbtn" style={{ background: '#4b7bf5', padding: '7px 14px', fontSize: 13 }} onClick={() => loginWithGoogle()}>{t('common.login_google')}</button>
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
              <button className="hub-help" onClick={() => setModal('earn')} aria-label={t('hub.help_aria')}>?</button>
              {/* data-tip = 호버 툴팁("보유한 CARI 코인") — hub.css 의 .gchip[data-tip]::after */}
              <span className="gchip" data-tip={t('hub.coin_tip')}><Ic n="coin" s={26} /><span className="num">{points.toLocaleString()}</span></span>
            </div>
          </div>
        </div>

        {/* 오늘의 미션 — 무대 **위 가로 한 줄**(하단 '출석 보상' 스트립과 같은 형태).
            좌측 열로 두면 카드 하나 때문에 캐릭터가 옆으로 밀려서 전체 폭 한 줄로 옮겼다 → 캐릭터는 정중앙 유지.
            완료 판정은 서버 플래그(daily_activity 종류별), 점수는 scoring.ts 의 ACTIVITY_DELTA 파생. */}
        <div className="mission-bar">
          <span className="ms-title"><Ic n="star" s={16} /> {t('hub.mission_title')}</span>
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
              <button className="fcard f-daily" onClick={doDaily}><span className="fico"><Ic n="calendar" s={42} /></span>{t('hub.rail.daily')}{authed && !checkedIn && <span className="bd">1</span>}</button>
              <button className="fcard f-gacha" onClick={() => setModal('gacha')}><span className="fico"><Ic n="gift" s={42} /></span>{t('hub.rail.gacha')}</button>
              <button className="fcard f-shop" onClick={() => setModal('shop')}><span className="fico"><Ic n="shop" s={42} /></span>{t('hub.rail.shop')}</button>
              <button className="fcard f-title" onClick={() => setModal('title')}><span className="fico"><Ic n="medal" s={42} /></span>{t('hub.rail.title')}</button>
              <button className="fcard f-invite" onClick={() => setModal('invite')}><span className="ev">EVENT</span><span className="fico"><Ic n="share" s={42} /></span>{t('hub.rail.invite')}</button>
            </div>
            {/* 방(미니룸) — /room/:handle(남의 방)과 **같은 컴포넌트**를 쓴다.
                내 방과 남이 보는 내 방이 갈리면 배치를 바꿔봐야 드러나서 제일 늦게 발견된다. */}
            <RoomView
              layout={roomLayout}
              slots={roomSlots}
              name="CARI"
              badge={titleBadge}
              editing={editing}
              activeSlot={pickSlot}
              onSlotClick={(k) => setPickSlot(k)}
            />
            {/* 왼쪽 조작 버튼 — 오른쪽 레일의 반대편. 방 링크는 여기 둔다(위 backrow 는 이미 버튼 둘이라 셋이면 밀린다). */}
            <div className="room-acts">
              <button className={`room-btn${editing ? ' on' : ''}`} onClick={() => { setEditing((v) => !v); setPickSlot(null) }}>
                {t(editing ? 'hub.room.done' : 'hub.room.edit')}
              </button>
              <button className="room-btn" onClick={copyRoomLink}>
                {t(roomCopied ? 'hub.room.copied' : 'hub.room.link')}
              </button>
            </div>
        </div>

        {/* 도크: 7일 출석 캘린더 + 메인 CTA(출석) */}
        <div className="dock">
          <div className="reward">
            <div className="rw-top"><Ic n="fire" s={20} /> {t('hub.reward_head')}<span className="rw-n">{stamps} / 7</span></div>
            <div className="streak">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <div key={d} className={`day ${d <= stamps ? 'on' : ''}`}>
                  {d === 7 && <span className="gift"><Ic n="gift" s={26} /></span>}
                  {t('hub.day_n', { n: d })}<span className="chk">{d <= stamps ? '✓' : ''}</span>
                </div>
              ))}
            </div>
          </div>
          {/* 미니게임은 /arena 하단 런처로 옮겼고, 이 자리는 랭킹 진입점이 됐다(옛 레벨선택 화면의 랭킹 버튼). */}
          <Link className="cta-main" to="/ranking">
            <span className="cta-star"><Ic n="trophy" s={24} /></span>
            {t('common.ranking')}
          </Link>
        </div>
      </div>

      {toast && (
        <div className="hub-toast" onClick={() => setToast(null)}>
          {/* 아이콘은 문구가 아니라 toast.bad 가 정한다 — 문구 정규식은 번역되는 순간 무의미해진다. */}
          <span className="hub-toast-ic">{toast.bad ? '⚠️' : '✅'}</span>
          <span>{toast.text}</span>
          <button className="hub-toast-x" onClick={() => setToast(null)} aria-label={t('common.close')}>×</button>
        </div>
      )}

      {purchased && (
        <div className="hub-modal-backdrop buy-pop-backdrop" onClick={() => setPurchased(null)}>
          <div className="buy-pop" onClick={(e) => e.stopPropagation()}>
            <div className="buy-pop-spark"><span>✨</span><span>🎉</span><span>✨</span></div>
            <div className="buy-pop-title">{t(purchased.kind === 'dust' ? 'hub.buy.exchanged' : 'hub.buy.purchased')}</div>
            <div className="buy-pop-thumb">{partEmoji(purchased.partKey)}</div>
            <div className="buy-pop-name">{partName(purchased.partKey, t)}</div>

            <button className="pbtn buy-pop-ok" style={btn('#6bbf9a')} onClick={() => setPurchased(null)}>{t('hub.confirm')}</button>
          </div>
        </div>
      )}

      {/* 가구 고르기 — 슬롯 하나에 놓을 것을 고른다. 면이 맞고 내가 가진 것만 나온다. */}
      {pickSlot && pickSlotDef && (
        <Modal title={t('hub.room.pick_title', { where: surfaceLabel(pickSlotDef.surface, t) })} onClose={() => setPickSlot(null)}>
          {pickable.length === 0 ? (
            <p className="rmpick-empty">{t('hub.room.none_owned', { where: surfaceLabel(pickSlotDef.surface, t) })}</p>
          ) : (
            <div className="rmpick-grid">
              {pickable.map((f) => (
                <button
                  key={f.partKey}
                  className={`rmpick-item${roomSlots[pickSlot] === f.partKey ? ' on' : ''}`}
                  onClick={() => placeInSlot(pickSlot, f.partKey)}
                >
                  <span className="rmpick-art">{furnitureArt(f.partKey)}</span>
                  <span>{partName(f.partKey, t)}</span>
                </button>
              ))}
            </div>
          )}
          {roomSlots[pickSlot] && (
            <button className="pbtn" style={{ ...btn('#c3cbe0'), width: '100%', marginTop: 12 }} onClick={() => placeInSlot(pickSlot, null)}>
              {t('hub.room.remove')}
            </button>
          )}
          <p className="hub-modal-help">{t('hub.room.help')}</p>
        </Modal>
      )}

      {modal === 'gacha' && (
        <Modal title={t('hub.gacha.title')} onClose={() => setModal(null)}>
          <div className="gacha-head">
            <span className="gchip gchip-dust"><span className="dust-ic">✨</span><span className="num">{dust.toLocaleString()}</span><span className="dust-lab">{t('hub.gacha.dust')}</span></span>
            <span className="chip" style={{ margin: 0 }}>{t('hub.gacha.owned_n', { n: owned.size })}</span>
          </div>
          <div className="gacha-gauge">
            <div className="gacha-gauge-bar"><div className="gacha-gauge-fill" style={{ width: `${Math.min(100, (pity / PITY_CEILING) * 100)}%` }} /></div>
            <span className="gacha-gauge-lab">{t('hub.gacha.pity', { n: Math.max(0, PITY_CEILING - pity) })}</span>
          </div>
          <div className="gacha-stage">
            {drawing && (
              <div className="gacha-capsule">
                <span className="gacha-capsule-box">🎁</span>
              </div>
            )}
            {!drawing && lastDraw && (
              lastDraw.partKey ? (
                <div className="gacha-result is-rare">
                  <span className="gacha-ribbon">{t('hub.gacha.limited')}</span>
                  <span className="gacha-spark s1">✨</span><span className="gacha-spark s2">✨</span><span className="gacha-spark s3">✨</span>
                  <div className="gacha-result-icon">{partEmoji(lastDraw.partKey)}</div>
                  <b>{partName(lastDraw.partKey, t)}</b>
                  <span className="gacha-dustgain">{t('hub.gacha.dust_gain', { n: lastDraw.dust })}</span>
                </div>
              ) : (
                <div className="gacha-result is-dust">
                  <div className="gacha-result-icon">✨</div>
                  <b>{t('hub.gacha.dust_gain', { n: lastDraw.dust })}</b>
                  <span className="gacha-dust-hint">{t('hub.gacha.dust_hint')}</span>
                </div>
              )
            )}
          </div>
          <button className="pbtn gacha-draw-btn gacha-draw-full" onClick={doGacha} disabled={drawing}>{drawing ? t('hub.gacha.drawing') : t('hub.gacha.draw', { n: DRAW_COST })}</button>
          <div className="gacha-exchange">
            <div className="gacha-ex-head">✨ {t('hub.gacha.ex_head')} <span className="gacha-ex-sub">{t('hub.gacha.ex_sub')}</span></div>
            <div className="gacha-ex-list">
              {exclusives.map((e) => {
                const has = owned.has(e.partKey)
                const canAfford = dust >= e.dustPrice
                return (
                  <div key={e.partKey} className={`gacha-ex-item ${has ? 'is-owned' : ''}`}>
                    {has && <span className="gacha-ex-owned">{t('hub.gacha.have')}</span>}
                    <div className="gacha-ex-thumb">{partEmoji(e.partKey)}</div>
                    <div className="gacha-ex-name">{partName(e.partKey, t)}</div>
                    <div className="gacha-ex-price">✨ {e.dustPrice}</div>
                    <button className="pbtn gacha-ex-buy" style={btn(has || !canAfford ? '#c3cbe0' : '#7b6bd6')} onClick={() => doExchange(e.partKey, e.dustPrice)} disabled={has}>{t(has ? 'hub.gacha.have' : 'hub.gacha.exchange')}</button>
                  </div>
                )
              })}
            </div>
          </div>
          <p className="hub-modal-help">{t('hub.gacha.help', { n: PITY_CEILING })}</p>
        </Modal>
      )}

      {modal === 'shop' && (
        <Modal title={t('hub.shop.title')} onClose={() => setModal(null)}>
          <div className="hub-shop-head">
            <span className="hub-shop-head-lab">{t('hub.shop.balance')}</span>
            <span className="gchip" style={{ margin: 0 }}><Ic n="coin" s={22} /><span className="num">{points.toLocaleString()}</span></span>
          </div>
          {catalog.length > 0 ? (
            <div className="hub-modal-grid">
              {catalog.map((c) => (
                <div key={c.partKey} className={`hub-shop-item ${c.rare ? 'is-rare' : ''}`}>
                  {c.rare && <span className="hub-shop-ribbon">{t('hub.shop.rare')}</span>}
                  {owned.has(c.partKey) && <span className="hub-shop-owned">{t('hub.shop.owned')}</span>}

                  <div className="hub-shop-thumb">{partEmoji(c.partKey)}</div>
                  {/* 어느 면에 놓는 물건인지 이름 옆에 밝힌다 — 방에 자리가 벽 2칸·바닥 3칸으로 나뉘어 있어서,
                      안 밝히면 벽 자리만 남았는데 바닥 가구를 사는 일이 생긴다. */}
                  <div className="hub-shop-name">
                    {partName(c.partKey, t)}
                    {c.surface ? <small style={{ display: 'block', fontWeight: 800, opacity: .7 }}>{surfaceLabel(c.surface, t)}</small> : null}
                  </div>
                  <div className="hub-shop-price">🪙 {c.price}</div>
                  <button className="pbtn hub-shop-buy" style={btn(owned.has(c.partKey) ? '#c3cbe0' : '#6bbf9a')} onClick={() => doBuy(c.partKey, c.price)} disabled={owned.has(c.partKey)}>
                    {t(owned.has(c.partKey) ? 'hub.shop.owned' : 'hub.shop.buy')}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="hub-modal-help">{t(isFullUser ? 'hub.shop.empty' : 'hub.shop.login')}</p>
          )}
        </Modal>
      )}

      {modal === 'coupon' && (
        <Modal title={t('hub.coupon.title')} onClose={() => setModal(null)}>
          {coupons.length > 0 ? (
            <div className="ticket-shelf">
              {coupons.map((c) => (
                <div key={c.level} className={`ticket ${c.used ? 'is-used' : ''}`}>
                  <div className="ticket-stub">Lv.{c.level}</div>
                  <div className="ticket-main">
                    <b className="ticket-pct">{t('hub.coupon.discount', { n: c.discount })}</b>
                    <span className="ticket-sub">{t('hub.coupon.sub', { n: c.level })}</span>
                  </div>
                  <span className="ticket-stamp">{t(c.used ? 'hub.coupon.used' : 'hub.coupon.have')}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="ticket-shelf ticket-shelf-empty">
              <div className="ticket ticket-ghost"><span className="ticket-ghost-ic">🎫</span></div>
              <p className="hub-modal-help">{t(authed ? 'hub.coupon.empty' : 'hub.coupon.login')}</p>
            </div>
          )}
        </Modal>
      )}

      {modal === 'share' && (
        <ShareCardModal
          onClose={() => setModal(null)}
          data={{
            lang,
            name: displayName?.trim() || user?.user_metadata?.name || 'CARI',
            avatarUrl,
            seed: user?.id ?? 'guest',
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
            referralCode,
          }}
        />
      )}

      {modal === 'title' && (
        <Modal title={t('hub.title.title')} onClose={() => setModal(null)}>
          {titles.length > 0 ? (
            <div className="title-vault">
              {titles.map((tt, i) => (
                <span key={i} className="title-badge">🏅<b>CARIS {tierName(tt.tier)}</b></span>
              ))}
            </div>
          ) : (
            <div className="title-vault title-vault-empty">
              {[1, 2, 3].map((i) => (
                <span key={i} className="title-slot">🔒</span>
              ))}
              <p className="hub-modal-help">{t(authed ? 'hub.title.empty' : 'hub.title.login')}</p>
            </div>
          )}
        </Modal>
      )}

      {/* 점수 획득 방법 — 표의 모든 수치는 scoring.ts(원안 반영본) 파생이라 여기서 하드코딩하지 않는다. */}
      {modal === 'earn' && (
        <Modal title={t('hub.earn.title')} onClose={() => setModal(null)}>
          <p className="hub-modal-help earn-lead">{t('hub.earn.lead')}</p>
          <table className="earn-tb">
            <thead><tr><th>{t('hub.earn.col_act')}</th><th>{t('hub.earn.col_pt')}</th></tr></thead>
            <tbody>
              {EARN_ROWS.map((r) => (
                <tr key={r.kind}>
                  <td className="earn-nm"><span className="earn-ic"><Ic n={r.icon} s={20} /></span>{t(`hub.earn.row.${r.kind}`)}</td>
                  <td className="earn-v">
                    {t('hub.earn.pt', { n: ACTIVITY_DELTA[r.kind] })}
                    <em>{t('hub.earn.limit', { n: ACTIVITY_PER_DAY[r.kind], max: ACTIVITY_SEASON_MAX[r.kind].toLocaleString() })}</em>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="earn-lv">
            <div className="earn-lv-head"><Ic n="trophy" s={18} /> {t('hub.earn.lv_head')} <em>{t('hub.earn.lv_sub')}</em></div>
            <div className="earn-lv-grid">
              {[1, 2, 3, 4, 5, 6, 7].map((lv) => (
                <div key={lv} className="earn-lv-cell"><b>Lv.{lv}</b>+{LEVELTEST_CLEAR_POINTS.toLocaleString()}</div>
              ))}
            </div>
            <p className="hub-modal-help">{t('hub.earn.foot', { a: LEVELTEST_MAX.toLocaleString(), b: SEASON_MAX_POINTS.toLocaleString() })}</p>
          </div>

        </Modal>
      )}

      {modal === 'invite' && (
        <Modal title={t('hub.invite.title')} onClose={() => setModal(null)}>
          <div className="iv-title">{t('hub.invite.lead')}</div>
          <p className="hub-modal-help">{t('hub.invite.help')}</p>
          <div className="iv-code iv-code-lg">
            <span className="iv-code-lab">{t('hub.invite.my_code')}</span>
            <b className="iv-code-v">{referralCode ?? '––––'}</b>
            <button className="iv-copy" onClick={copyInvite} disabled={!referralCode}>{t(copied ? 'hub.invite.copied' : 'hub.invite.copy')}</button>
          </div>
          {!referralCode && <p className="hub-modal-help">{t(authed ? 'hub.invite.issuing' : 'hub.invite.login')}</p>}

          {/* 받는 쪽 — 계정당 1회, 성공하면 영구 잠금. 실패는 이유를 그대로 알려준다. */}
          <div className="iv-redeem">
            <div className="iv-redeem-head">{t('hub.invite.redeem_head')}</div>
            {referralUsed ? (
              <p className="iv-redeem-done">{t('hub.invite.redeem_done')}</p>
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
                    aria-label={t('hub.gift.code_label')}
                  />
                  <button className="iv-copy" onClick={redeemReferral} disabled={redeeming || !redeemInput.trim()}>
                    {t(redeeming ? 'hub.invite.checking' : 'hub.invite.register')}
                  </button>
                </div>
                <p className="hub-modal-help iv-redeem-hint">{t('hub.invite.hint')}</p>
              </>
            )}
            {redeemMsg && <p className={`iv-redeem-msg${redeemMsg.ok ? ' is-ok' : ''}`}>{redeemMsg.text}</p>}
          </div>
        </Modal>
      )}

      {modal === 'gift' && (
        <Modal title={t('hub.gift.title')} onClose={() => setModal(null)}>
          <div className="gf-bal">
            <Ic n="coin" s={22} /><span className="gf-bal-n">{points.toLocaleString()}</span><span className="gf-bal-lab">{t('hub.gift.balance')}</span>
          </div>

          {/* 받은 선물 — 오늘 것만 상세로. 저장은 건별이지만 표시는 사람별 합산이라 도배돼도 한 줄이다. */}
          {(giftGot.length > 0 || giftGotOlder > 0) && (
            <div className="gf-got">
              <div className="gf-got-head">{t('hub.gift.received')}</div>
              {giftGot.map((g) => (
                <div className="gf-got-row" key={g.name}>
                  <b className="gf-got-name">{g.name}</b>
                  <span className="gf-got-amt">+{g.amount.toLocaleString()}</span>
                  {g.count > 1 && <span className="gf-got-n">{t('hub.gift.count_n', { n: g.count })}</span>}
                </div>
              ))}
              {giftGotOlder > 0 && (
                <button className="gf-older" onClick={toggleGiftHistory}>
                  {t('hub.gift.older', { n: giftGotOlder })} <span className="gf-chev">›</span>
                </button>
              )}
            </div>
          )}

          {/* 보내기 — 되돌릴 수 없으니 코드 → 이름 확인 → 금액 → 확인 순서를 강제한다. */}
          <div className="gf-send">
            <div className="gf-send-head">{t('hub.gift.send_head')}</div>
            <label className="gf-lab" htmlFor="gf-code">{t('hub.gift.code_label')}</label>
            <input
              id="gf-code"
              className="gf-in"
              value={giftCode}
              /* 코드가 바뀌면 앞서 띄운 이름은 그 자리에서 무효다 — 여기서 지운다(이펙트가 아니라).
                 남겨두면 코드를 고치는 도중에도 옛 이름이 붙어 있어 엉뚱한 사람 이름을 보고 보내게 된다. */
              onChange={(e) => { setGiftCode(e.target.value.toUpperCase()); setGiftTo(null); setGiftConfirm(false); setGiftMsg(null) }}
              placeholder="CARIXXXX"
              maxLength={8}
              disabled={giftSending}
              autoComplete="off"
            />
            {/* 8자를 다 치면 여기 이름이 뜬다. 이게 오타를 막는 유일한 장치라 반드시 실명(닉네임)을 보여준다. */}
            {giftTo && <p className={`gf-to${giftTo.ok ? ' is-ok' : ''}`}>{giftTo.ok ? t('hub.gift.to_ok', { name: giftTo.name }) : t(giftTo.errKey)}</p>}

            <label className="gf-lab" htmlFor="gf-amt">{t('hub.gift.amount_label')}</label>
            <input
              id="gf-amt"
              className="gf-in"
              value={giftAmount}
              onChange={(e) => { setGiftAmount(e.target.value.replace(/[^0-9]/g, '')); setGiftConfirm(false); setGiftMsg(null) }}
              placeholder="0"
              inputMode="numeric"
              disabled={giftSending}
              autoComplete="off"
            />

            {!giftConfirm ? (
              <button
                className="gf-btn"
                onClick={() => { setGiftMsg(null); setGiftConfirm(true) }}
                disabled={giftSending || !giftTo?.ok || !giftAmount || Number(giftAmount) <= 0}
              >
                {t('hub.gift.send')}
              </button>
            ) : (
              <div className="gf-confirm">
                {/* 강조를 위한 인라인 <b> 는 뺐다 — 어순이 언어마다 달라서 문장을 쪼개면 번역이 불가능해진다. */}
                <p className="gf-confirm-q">
                  {t('hub.gift.confirm_q', { name: giftTo?.ok ? giftTo.name : '', n: Number(giftAmount).toLocaleString() })}
                </p>
                <p className="gf-confirm-warn">{t('hub.gift.confirm_warn')}</p>
                <div className="gf-confirm-act">
                  <button className="gf-btn gf-btn-ghost" onClick={() => setGiftConfirm(false)} disabled={giftSending}>{t('common.cancel')}</button>
                  <button className="gf-btn" onClick={doGift} disabled={giftSending}>{t(giftSending ? 'hub.gift.sending' : 'hub.gift.send')}</button>
                </div>
              </div>
            )}
            {giftMsg && <p className={`gf-msg${giftMsg.ok ? ' is-ok' : ''}`}>{giftMsg.text}</p>}
          </div>

          {/* 전체 이력 — 오늘 것 말고는 전부 여기. 보낸 것·받은 것이 건별로 다 남는다. */}
          <button className="gf-hist-toggle" onClick={toggleGiftHistory}>
            {t('hub.gift.history')} <span className={`gf-chev${giftHistoryOpen ? ' is-open' : ''}`}>›</span>
          </button>
          {giftHistoryOpen && (
            <div className="gf-hist">
              {giftHistory === null && <p className="hub-modal-help">{t('common.loading')}</p>}
              {giftHistory?.length === 0 && <p className="hub-modal-help">{t('hub.gift.empty')}</p>}
              {giftHistory?.map((r) => (
                <div className={`gf-hist-row is-${r.dir}`} key={r.id}>
                  <span className="gf-hist-dir">{t(r.dir === 'in' ? 'hub.gift.dir_in' : 'hub.gift.dir_out')}</span>
                  <b className="gf-hist-name">{r.name}</b>
                  <span className="gf-hist-amt">{r.dir === 'in' ? '+' : '−'}{r.amount.toLocaleString()}</span>
                  <span className="gf-hist-at">{r.at.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

    </div>
  )
}

function Modal({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  // Hub() 밖이라 t 를 물려받지 못한다 — 여기서 다시 훅을 부른다(닫기 버튼 aria-label 용).
  const { t } = useT()
  return (
    <div className="hub-modal-backdrop" onClick={onClose}>
      <div className={`hub-modal${className ? ' ' + className : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="hub-modal-head">
          <h3>{title}</h3>
          <button className="hub-modal-close" onClick={onClose} aria-label={t('common.close')}>×</button>
        </div>
        <div className="hub-modal-body">{children}</div>
      </div>
    </div>
  )
}
function btn(bg: string): CSSProperties {
  return { background: bg }
}
