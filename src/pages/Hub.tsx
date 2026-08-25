// 캐릭터 허브(실동작) — /demo 첫 시안 기반 단일 로비 화면.
//   출석·상점·쿠폰·칭호는 전부 실제 백엔드 호출로 동작하며, 상세 동작은 팝업(모달)에서 처리한다.
//   초기 재화·보유파츠·스탬프·천장·출석여부·카탈로그·쿠폰·칭호는 get-hub 로 하이드레이트(RLS 잠금 테이블이라 이 함수만 읽음).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import '../styles/hub.css'
import { callFunction, supabase } from '../lib/supabase'
import { ensureCheckedIn } from '../lib/autoCheckin'
import { useAuth } from '../context/AuthProvider'
import { Avatar } from '../components/GemAvatar'
import { Link, useNavigate } from 'react-router-dom'
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
  showPercentile,
} from '../lib/scoring'
import ShareCardModal from '../components/ShareCardModal'
import ContributionGraph from '../components/ContributionGraph'
import CharArt from '../components/CharArt'
import { countryName, flagUrl } from '../lib/regions'
import { tierName } from '../lib/caris'
import { rememberPostLogin } from '../lib/postLogin'
import {
  CHAR_KEYS, CHAR_LEVELS, CHAR_MIN_LEVEL, charSeriesOf,
  DEFAULT_SKIN_PART, SKINS, isCharKey, isSkinKey, skinByPart, skinThumb,
} from '../lib/hubCosmetics'

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

/** 허브 스킨. 화면(마크업)은 한 벌이고 테마는 **값과 그림만** 갈아끼운다 —
 *  배경 = `hub.css` 의 `.hub[data-skin='<이름>']`, UI 한 벌 = `.hub[data-ui='<이름>']`,
 *  그림 = 아이콘 폴더(`SkinDef.iconDir`) + 그 블록들의 URL.
 *  2026-08-20: 고정 상수였던 것을 **장착값**으로 바꿨다(상점에서 스킨을 판다).
 *  ⚠️ 스킨 이름은 화면 코드에 흩어져 있지 않다 — 루트의 `data-skin`·`data-ui` 와 아이콘 폴더뿐이고,
 *     나머지는 전부 CSS 가 그 속성에서 파생한다. 그래서 갈아입으면 화면이 통째로 바뀐다.
 *  ⚠️ **배경과 UI 는 축이 둘이다**(2026-08-25). 고궁 낮·밤은 배경만 다르고 UI 는 한 벌을 같이 쓰며,
 *     기본 초원은 아무 그림도 안 얹는 옛 카툰 CSS(`data-ui='base'`)를 그대로 쓴다.
 *  목록·경로의 단일 출처 = `src/lib/hubCosmetics.ts` 의 `SKINS`. */
type HubUiIconName = 'calendar' | 'shop' | 'medal' | 'invite' | 'ranking'
/** 스킨 그림이 없을 때 대신 그릴 기본 SVG(`ICONS` 의 키). 이름이 다른 것만 적는다. */
const HUB_ICON_FALLBACK: Partial<Record<HubUiIconName, string>> = { invite: 'share', ranking: 'star' }

/** 허브 아이콘. 폴더가 없으면 원래 쓰던 SVG 로 돌아간다 — 스킨은 '덧입히는 것'이지 전제가 아니다.
 *  ⚠️ **스킨 PNG 를 마크업에 직접 박지 말 것.** 랭킹 CTA 가 `<img src="/hub/ui/icon-ranking.png">` 를
 *     그대로 들고 있었는데, 그 그림에 크기를 주는 건 궁궐 스킨 CSS 뿐이라 기본 배경에서는
 *     512px 원본이 통째로 튀어나와 도크와 캐릭터를 덮었다(2026-08-25). 아이콘은 전부 여기를 지난다. */
function HubUiIcon({ n, dir, s = 42 }: { n: HubUiIconName; dir: string | null; s?: number }) {
  if (!dir) return <Ic n={HUB_ICON_FALLBACK[n] ?? n} s={s} />
  return <img className="hub-ui-icon" src={`${dir}/icon-${n}.png`} alt="" aria-hidden="true" />
}

const DAILY_POINTS = 10
/** 닉네임 최대 길이 — set-nickname 의 MAX 와 같은 값이어야 한다(서버가 그 길이로 거절한다).
 *  선물 입력칸의 maxLength 와 조회 발동 조건이 이 값을 쓴다. */
const NICK_MAX = 12
/** 7일 출석 도장을 채운 날 얹어주는 보너스 코인.
 *  ⚠️ 권위는 DB 다 — `20260812120000_stamp_7day_cycle.sql` 의 `c_cycle_bonus`. 여기는 표시용 사본이라
 *     그 값을 고치면 같이 고칠 것(DAILY_POINTS ↔ complete-daily 의 관계와 같다). */
const STAMP_BONUS = 20
/** 친구 초대 보상 코인 — 초대한 쪽·코드를 쓴 쪽 **양쪽 다** 같은 금액을 받는다.
 *  ⚠️ 권위는 DB 다 — `20260825200000_referral_coin_500.sql` 의 `c_coin`. 여기는 표시용 사본이다.
 *  ⚠️ 초대자 쪽에는 상한이 없다(2026-08-24 지시) — 초대할수록 계속 받는다. 코드를 쓰는 쪽만 계정당 1회. */
const REFERRAL_COIN = 500

// 파츠 이름은 사전(hub.part.<key>)에 있다 — 여기 name 은 두지 않는다(두면 화면마다 어느 쪽을 쓰는지 갈린다).
// 모듈 최상위라 훅을 못 쓴다 → t 를 넘겨받는다. 사전에 없는 키는 tr() 이 키를 그대로 돌려주므로 최소한 깨지진 않는다.
function partName(key: string, t: TFunc) {
  return t(`hub.part.${key}`)
}
function partEmoji(key: string) {
  if (key.startsWith('hat')) return '🧢'
  if (key.startsWith('shoe')) return '👟'
  if (key.startsWith('glasses')) return '👓'
  if (key.startsWith('wing')) return '✨'
  if (key.startsWith('crown')) return '👑'
  return '🎁'
}

/** 상점 진열 순서 = 이 표의 순서. 종류별로 묶어야 캐릭터·배경·가구가 한 격자에 섞이지 않는다. */
const CLOSET_GROUPS: { kind: string; labelKey: string }[] = [
  { kind: 'character', labelKey: 'hub.closet.g_character' },
  { kind: 'skin', labelKey: 'hub.closet.g_skin' },
  { kind: 'part', labelKey: 'hub.closet.g_part' },
]

/** 상점 썸네일 — 종류마다 그림이 다르다(캐릭터=그림 / 스킨=배경 / 그 외=이모지·가구 그림). */
function CosmeticThumb({ partKey }: { partKey: string }) {
  // 상점 썸네일은 **Lv.1** 이다 — 사면 처음 만나는 모습이라야 산 것과 보이는 게 같다.
  if (isCharKey(partKey)) return <CharArt charKey={partKey} level={CHAR_MIN_LEVEL} className="closet-char-img" />
  if (isSkinKey(partKey)) return <img className="closet-skin-img" src={skinThumb(skinByPart(partKey))} alt="" />
  return <>{partEmoji(partKey)}</>
}

// ── 서버 계약(입출력) ──
// kind·surface 는 방 꾸미기(2026-08-14)에서 붙었다. 파츠(kind='part')는 상점에서 내려가 이제 안 온다.
interface CatalogItem { partKey: string; price: number; kind?: string; surface?: string | null }
interface HubState { authed: boolean; level?: number | null; rankPoints?: number | null; points?: number; cosmetics?: string[]; stamps?: number; dailyDone?: boolean; learnDone?: boolean; minigameDone?: boolean; referralCode?: string | null; referralUsed?: boolean; titles?: TitleItem[]; coupons?: { level: number; discount: number; used: boolean }[]; catalog?: CatalogItem[]; skillScore?: number | null; activityScore?: number | null; seasonTotal?: number | null; percentile?: number | null; pointsToPass?: number | null; rank?: number | null; rankTotal?: number | null; giftsToday?: GiftToday[]; giftsOlder?: number; giftsUnseen?: number;
  // 출석한 날짜('YYYY-MM-DD', 최근 1년) — 도크 스탬프판을 눌러 여는 '출석 기록' 달력의 유일한 출처.
  //   서버는 예전부터 내려주고 있었고(옛 마이페이지 학습 대시보드가 쓰던 값), 2026-08-25 에 그 화면을
  //   찢으면서 이 자리로 왔다. 새로 부르는 요청이 없다 — 허브가 이미 받고 있던 응답이다.
  attendanceDays?: string[] | null;
  // 꾸미기 — 장착한 캐릭터(baseKey) · 그 외 장착(equipped.skin) · 첫 진입 흐름 진행 상태.
  //   ⚠️ charChosen·tutorialDone 은 **서버만이 안다**. 화면이 localStorage 로 기억하면
  //      브라우저를 바꾸거나 지운 사람에게 첫 진입 흐름이 다시 강제된다.
  baseKey?: string
  equipped?: Record<string, string>
  charChosen?: boolean
  tutorialDone?: boolean }
interface ShopResp { part_key: string; spent_points: number; points_after: number }

const FRIENDLY_ERR = new Set([
  'insufficient_points', 'already_owned', 'unauthorized', 'not_owned',
  // 꾸미기(character 함수) — 장착·선택 거절 사유.
  'invalid_character', 'invalid_kind', 'invalid_part',
])
function friendlyError(e: unknown, t: TFunc): string {
  const msg = e instanceof Error ? e.message : ''
  return FRIENDLY_ERR.has(msg) ? t(`hub.err.${msg}`) : t('hub.err.generic')
}

type TitleItem = { tier: string; exam_title?: string }

// 'closet' = 옛 'shop'. 상점과 인벤토리가 한 모달의 두 탭이 되면서 이름을 바꿨다(2026-08-20)
// — 사는 곳과 갈아입는 곳이 같은 자리라 버튼 이름이 '상점' 이면 절반을 숨기는 말이 된다.
type ModalKind = 'closet' | 'coupon' | 'title' | 'share' | 'earn' | 'invite' | 'gift' | 'attend'
/** 꾸미기 모달의 두 탭. */
type ClosetTab = 'shop' | 'items'

// 코인 선물 — 받은 것(오늘, 사람별 합산) / 이력 한 줄.
type GiftToday = { name: string; amount: number; count: number }
type GiftRow = { id: string; dir: 'in' | 'out'; name: string; amount: number; at: string }
/** 선물 상대 카드 — **이름만 돌려주면 확인이 안 된다**(사용자가 친 값이 그대로 되돌아온다).
 *  아바타·시즌점수·국가·지역은 사용자가 안 친 정보라 "이 사람 맞네" 를 판단할 수 있다. */
type GiftCard = { name: string; avatar: string | null; countryCode: string | null; regionCode: string | null; seasonTotal: number }
type GiftLookupResp = { name?: string; avatar?: string | null; country_code?: string | null; region_code?: string | null; season_total?: number; error?: string }
type GiftSendResp = { duplicate: boolean; amount: number; recipient_name: string; points_after: number }
type GiftHistoryResp = { rows: GiftRow[]; next: string | null }

// 점수 획득 방법 모달의 활동 표 — 값은 전부 scoring.ts(원안 반영본) 파생이라 상수를 다시 적지 않는다.
//   ⚠️ 여기 '점수'는 랭킹 점수(user_progress.activity_score)다. HUD 의 코인(상점 재화)과는 별개 지갑이다.
// 라벨은 사전 키(hub.earn.row.<kind>)로 조립한다 — kind 가 곧 키라서 표를 두 벌 관리하지 않는다.
const EARN_ROWS: { kind: ActivityKind; icon: string }[] = [
  { kind: 'attendance', icon: 'calendar' },
  { kind: 'daily_learn', icon: 'book' },
  { kind: 'minigame', icon: 'star' },
]

/** 코인 선물 노출 스위치 — 화면에서만 감춘다(2026-08-25).
 *  서버(coin-gift 함수·RPC)와 이 파일의 선물 코드는 그대로 살아 있고, 진입점만 안 그린다.
 *  ⚠️ 켤 때는 이 값 하나만 true 로. 아래 코인 표의 '선물' 줄도 같은 값을 본다 —
 *     표만 남으면 화면이 "선물로 코인을 받을 수 있다"고 말하는데 보낼 길이 없다. */
const GIFT_ENABLED: boolean = false

/** 코인이 들어오는 길 — **이게 전부다.** 미니게임·레벨테스트는 시즌 점수만 주고 코인은 안 준다.
 *  n=null 은 정해진 값이 없다는 뜻(선물은 보낸 사람이 금액을 정한다).
 *  ⚠️ 새 코인 지급처를 만들면 여기에도 줄을 추가할 것 — 화면이 '전부'라고 말하는 표라
 *     빠지면 사용자는 그 경로가 없는 줄 안다. */
const COIN_ROWS: { key: string; icon: string; n: number | null }[] = [
  { key: 'daily', icon: 'calendar', n: DAILY_POINTS },
  { key: 'stamp', icon: 'gift', n: STAMP_BONUS },
  { key: 'referral', icon: 'share', n: REFERRAL_COIN },  // ICONS 에 'invite' 는 없다 — 초대 아이콘은 'share' 다
  { key: 'gift', icon: 'coin', n: null },
]

export default function Hub() {
  const { isFullUser, loginWithGoogle, user, loading } = useAuth()
  const navigate = useNavigate()
  const { t, lang } = useT()
  const [points, setPoints] = useState(0)
  const [stamps, setStamps] = useState(0)
  const [checkedIn, setCheckedIn] = useState(false)
  // 출석 기록 달력(스탬프판을 눌러 여는 모달) — 최근 1년치 출석일.
  const [attendanceDays, setAttendanceDays] = useState<string[]>([])
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
  // 상점처럼 호출마다 randomUUID() 를 만들면 타임아웃 후 재시도가 두 번 보내기가 되고,
  // 즉시 이체라 회수할 방법이 없다. 서버 멱등(unique(sender_id, client_nonce))은 같은 값이 와야 걸린다.
  const [giftNonce, setGiftNonce] = useState<string | null>(null)
  const [giftNick, setGiftNick] = useState('')
  // 닉네임을 2자 이상 치면 자동 조회한 결과. 실패는 **문구가 아니라 사전 키**로 들고 있는다 —
  // 그래야 조회 이펙트가 t 에 의존하지 않는다(t 는 렌더마다 새로 만들어져서 deps 에 넣으면 이펙트가 매 렌더 돈다).
  // 덤으로 조회 후 언어를 바꿔도 메시지가 같이 바뀐다.
  const [giftTo, setGiftTo] = useState<{ ok: true; card: GiftCard } | { ok: false; errKey: string } | null>(null)
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
  // 시험 사다리 등급(user_progress.rank). HUD 의 Lv 는 이제 ARENA 레벨(점수 밴드)이라 화면에는 안 쓴다
  // — 서버는 계속 내려주므로 받아만 둔다(기존 skillScore/activityScore 와 같은 패턴).
  const [, setLevel] = useState<number | null>(null)
  const [authed, setAuthed] = useState(false)
  // 칭호 = 합격한 티어. 급수(1급~4급)는 2026-07 체계 개편으로 사라졌다(20260807130000).
  const [titles, setTitles] = useState<TitleItem[]>([])
  const [coupons, setCoupons] = useState<{ level: number; discount: number; used: boolean }[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [purchased, setPurchased] = useState<string | null>(null)
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
  const [closetTab, setClosetTab] = useState<ClosetTab>('shop')
  // ── 꾸미기(캐릭터·스킨) ──
  // 장착값. 서버(get-hub)가 권위고 화면은 낙관적으로 먼저 반영한 뒤 hydrate 로 맞춘다.
  const [charKey, setCharKey] = useState<string | null>(null)
  const [skinPart, setSkinPart] = useState<string>(DEFAULT_SKIN_PART)
  // 첫 진입 흐름 — null = 아직 서버에 안 물어봄(모름). 모르는 동안은 아무 오버레이도 띄우지 않는다.
  //   ⚠️ false 로 시작하면 하이드레이트 전 한 프레임 동안 이미 끝낸 사람에게도 선택 화면이 번쩍인다.
  const [charChosen, setCharChosen] = useState<boolean | null>(null)
  const [tutorialDone, setTutorialDone] = useState<boolean | null>(null)
  // 선택 화면에서 계열마다 지금 보고 있는 칸(좌우 버튼). 계열들이 각자 기억한다.
  //   ⚠️ 'm'|'f' 가 아니라 **인덱스**다 — 한 계열에 변형이 셋 이상 생겨도 화면이 그대로 돌아간다.
  const [charLook, setCharLook] = useState<Record<string, number>>({})
  // 미리보기로 열어둔 품목(part_key). 상점·보관함 어디서 눌렀든 같은 창이 뜬다 —
  // 사기 전과 산 뒤에 보는 그림이 다르면 "산 게 그거 맞나" 를 다시 확인하러 가야 한다.
  const [preview, setPreview] = useState<string | null>(null)
  // 미리보기에서 지금 보고 있는 레벨. ⚠️ 열 때마다 정해준다 — 안 그러면 앞에 보던 레벨이 남는다.
  const [pvLevel, setPvLevel] = useState(CHAR_MIN_LEVEL)
  /** 잠깐 입어본 스킨(part_key). **저장되지 않는다** — 화면에만 얹힌다.
   *  ⚠️ 스킨은 모달 안 그림으로는 미리볼 수 없다. 배경뿐 아니라 HUD·미션바·판·게이지·도장·아이콘이
   *     전부 바뀌는데, 그 자산들은 CSS 변수 안에만 있어서 코드가 경로를 알지 못한다.
   *     그래서 **진짜 화면에 얹는다** — 그러면 위치가 어긋날 수가 없고 구현도 이쪽이 더 간단하다. */
  const [previewSkin, setPreviewSkin] = useState<string | null>(null)
  /** 입어보기를 시작한 탭 — '되돌리기'가 여기로 돌려보낸다.
   *  ⚠️ state 가 아니라 ref 다. 이 값이 바뀌어도 다시 그릴 게 없고(모달은 닫혀 있다),
   *     state 로 두면 입어보기를 시작할 때 화면이 한 번 더 도는 값이 하나 늘 뿐이다. */
  const tryOnFrom = useRef<ClosetTab>('shop')
  const [charPick, setCharPick] = useState<string | null>(null) // 고른 칸(확정 전)
  const [charSaving, setCharSaving] = useState(false)
  const [tutorialStep, setTutorialStep] = useState(0)
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
      const r = await callFunction<{ ok?: boolean; error?: string; coin?: number }>('redeem-referral', { code })
      if (r.ok) {
        setReferralUsed(true)
        setRedeemInput('')
        // 금액은 서버가 준 값을 쓴다 — 화면 상수(REFERRAL_COIN)는 안내표용 사본이라
        // DB 값을 고쳤을 때 성공 문구까지 같이 틀리면 안 된다.
        setRedeemMsg({ ok: true, text: t('hub.invite.ok', { n: r.coin ?? REFERRAL_COIN }) })
        void hydrate()
      } else {
        setRedeemMsg({ ok: false, text: REDEEM_ERR[r.error ?? ''] ?? t('hub.invite.fail') })
      }
    } catch {
      setRedeemMsg({ ok: false, text: t('hub.invite.fail') })
    }
    setRedeeming(false)
  }

  // 오늘의 미션 3종(시안 좌상단 카드). to=null 인 출석은 **누를 것이 없다** — 사이트에 들어오면
  // 자동으로 찍히므로(lib/autoCheckin.ts) 이 칩은 현황 표시 전용이다. 나머지는 해당 화면으로 보낸다.
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
    setCheckedIn(!!h.dailyDone)
    setAttendanceDays(h.attendanceDays ?? [])
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
    // 꾸미기 장착값 — 서버가 권위다. 'default'(아직 안 고름)는 null 로 눕혀 폴백 그림 하나로 처리한다.
    setCharKey(h.baseKey && h.baseKey !== 'default' ? h.baseKey : null)
    setSkinPart(h.equipped?.skin ?? DEFAULT_SKIN_PART)
    // 첫 진입 흐름. **비로그인 응답(authed=false)에는 이 값이 없다** — 그때는 모름(null)으로 두어야
    // 게스트 화면에 캐릭터 선택이 뜨는 일이 없다(허브는 로그인 전용이라 실제로 도달하진 않는다).
    if (h.authed) {
      setCharChosen(!!h.charChosen)
      setTutorialDone(!!h.tutorialDone)
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

  // 자동 출석이 오늘 치를 찍고 나면 미션바·스탬프를 한 번 더 받는다.
  //   ⚠️ **출석을 기다렸다 그리지 않는다** — 그 왕복이 허브 첫 그림을 늦춘다. 위 효과가 먼저 그리고,
  //      출석이 실제로 찍힌 경우(=화면이 달라진 경우)에만 여기서 다시 받는다.
  //   ⚠️ 부르는 자리가 App.tsx 에도 있지만 세션당 1회로 접히므로(ensureCheckedIn) 요청은 하나다.
  //      여기서 또 부르는 이유는 **언제 끝났는지 알아야** 다시 받을 수 있기 때문이다.
  useEffect(() => {
    const uid = user?.id
    if (!uid) return
    let alive = true
    void ensureCheckedIn(uid).then((changed) => {
      if (!changed || !alive) return
      callFunction<HubState>('get-hub', {}).then((h) => { if (alive) applyHub(h) }).catch(() => {})
    })
    return () => { alive = false }
  }, [user?.id])
  // 상점 → shop-buy (가격은 서버 카탈로그 권위).
  async function doBuy(partKey: string, price: number) {
    if (!isFullUser) { void loginWithGoogle(); return }
    if (owned.has(partKey)) return
    if (points < price) { pushErr(t('hub.toast.no_points_item', { name: partName(partKey, t), price })); return }
    try {
      await callFunction<ShopResp>('shop-buy', { part_key: partKey, client_nonce: crypto.randomUUID() })
      setPurchased(partKey)
      // 산 물건은 입으라고 산 것이다 — 축하 팝업을 닫으면 인벤토리 탭이 열려 있게 둔다.
      //   ⚠️ 여기서 바로 장착하지는 않는다. 산 순간 화면이 통째로 바뀌면(스킨) 뭘 산 건지 못 보고 지나간다.
      setClosetTab('items')
      await hydrate()
    } catch (e) {
      pushErr(friendlyError(e, t))
    }
  }

  // 미리보기 열기. **이미 가진 캐릭터는 지금 내 레벨**로, 아직 안 산 것은 Lv.1 로 연다 —
  // 보관함에서는 "지금 이렇게 보인다"가, 상점에서는 "사면 이 모습부터 시작한다"가 궁금한 것이라서다.
  function openPreview(key: string) {
    // 스킨은 창에 그리지 않고 **화면에 입혀 본다**(위 previewSkin 주석 참고).
    //   모달을 닫는 게 핵심이다 — 안 닫으면 정작 바뀐 화면이 모달에 가려 안 보인다.
    if (isSkinKey(key)) {
      // ⚠️ **떠나온 탭을 적어 둔다.** '되돌리기'는 보던 자리로 돌려보내는 버튼인데, 돌아갈 곳을
      //    보관함으로 못박아 두면 상점에서 입어본 사람이 엉뚱한 탭에 떨어져 자기가 보던 진열을 잃는다.
      tryOnFrom.current = closetTab
      setPreviewSkin(key)
      setModal(null)
      return
    }
    setPvLevel(isCharKey(key) && owned.has(key) ? arenaLevelForScore(seasonTotal) : CHAR_MIN_LEVEL)
    setPreview(key)
  }
  /** 입어보기 끝 — 원래 스킨으로 돌아가고 **떠나온 그 탭으로** 되돌린다(상점에서 왔으면 상점으로). */
  function endTryOn(reopen = true) {
    setPreviewSkin(null)
    if (reopen) { setClosetTab(tryOnFrom.current); setModal('closet') }
  }

  // ── 캐릭터 · 스킨 ──────────────────────────────────────────────────────────
  // 캐릭터 선택. 첫 선택이면 서버가 무료로 지급하고 장착까지 한 트랜잭션에서 끝낸다.
  //   ⚠️ 낙관적 반영을 하지 않는다 — 첫 선택은 되돌릴 수 없는 지급이라 "화면엔 골라졌는데 서버는
  //      거절한" 상태가 남으면 사용자가 그걸 자기 캐릭터로 알고 지나간다. 응답을 받고 나서 닫는다.
  async function chooseCharacter(key: string) {
    if (charSaving) return
    setCharSaving(true)
    try {
      await callFunction<{ base_key: string; first: boolean }>('character', { action: 'choose', key })
      setCharKey(key)
      setCharChosen(true)
      setCharPick(null)
      await hydrate()
    } catch (e) {
      pushErr(friendlyError(e, t))
    } finally {
      setCharSaving(false)
    }
  }

  // 스킨 등 갈아입기. 캐릭터는 위 전용 경로로 간다(첫 선택 무료 규칙이 걸려 있다).
  //   여기는 낙관적 반영이 맞다 — 실패해도 잃는 게 없고, 갈아입기는 눌렀을 때 바로 보여야 한다.
  async function equip(kind: string, key: string) {
    if (kind === 'character') { void chooseCharacter(key); return }
    const prev = skinPart
    // 적용했으면 더는 '입어보는 중'이 아니다 — 띠를 남겨두면 저장된 스킨을 임시값처럼 보이게 한다.
    if (kind === 'skin') { setSkinPart(key); setPreviewSkin(null) }
    try {
      await callFunction('character', { action: 'equip', kind, key })
    } catch (e) {
      if (kind === 'skin') setSkinPart(prev)
      pushErr(friendlyError(e, t))
    }
  }

  // 튜토리얼 종료(끝까지 봤든 건너뛰었든 같다).
  //   ⚠️ 화면을 먼저 닫고 서버에 알린다 — 저장이 늦어도 사용자를 검은 화면에 잡아두지 않는다.
  //      실패하면 다음 진입에 한 번 더 뜨는데, 그게 "닫혔는데 서버는 모르는" 상태보다 낫다.
  async function finishTutorial() {
    setTutorialDone(true)
    try {
      await callFunction('character', { action: 'tutorial' })
    } catch {
      /* 다음 진입에 다시 뜬다 — 조용히 넘긴다 */
    }
  }

  // ---------- 코인 선물 ----------
  // 즉시 이체다. 취소·회수 경로가 없어서 방어선은 (a) 닉네임을 치면 뜨는 **상대 카드**(아바타·ARENA
  // 레벨·국가·지역) (b) 확인 단계 (c) nonce 재사용 셋뿐이다. (a) 가 이름만이면 사용자가 방금 친 값이
  // 되돌아오는 것이라 확인이 성립하지 않는다 — 카드에 안 친 정보가 있어야 방어선이 된다.
  // 서버는 잠금 순서·잔액·멱등·원장을 전부 RPC 한 트랜잭션에서 처리한다.
  function openGift() {
    if (!isFullUser) { void loginWithGoogle(); return }
    setGiftNonce(crypto.randomUUID()) // ⚠️ 여기서 한 번만. 전송 성공 전까지 이 값을 재사용한다.
    setGiftGot(giftsToday); setGiftGotOlder(giftsOlder) // 연 시점으로 고정 — 아래 seen 처리에 지워지지 않게
    setGiftNick(''); setGiftTo(null); setGiftAmount('')
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

  // 닉네임을 2자 이상 치면 자동 조회 — 조회 버튼을 따로 두지 않는다(동선 하나 줄인다).
  //   ⚠️ 옛 코드 입력은 길이가 8 로 고정이라 **정확히 한 번** 조회했지만, 닉네임은 길이가 제각각이라
  //      타이핑 중에 여러 번 나간다. 그래서 디바운스를 250 → 450ms 로 늘리고 서버 쿼터도 60회로 올렸다.
  //   ⚠️ 대소문자를 바꾸지 않는다 — 닉네임은 사용자가 정한 표기이고, 대소문자 무시 비교는 DB 가 한다
  //      (정규화 키가 lower + 공백제거). 여기서 upper() 를 걸면 다국어 닉네임이 화면에서 망가진다.
  useEffect(() => {
    if (modal !== 'gift') return
    const nickname = giftNick.trim()
    // 2자 미만·12자 초과면 아무것도 하지 않는다 — 이전 카드를 지우는 건 onChange 가 맡는다.
    // (이 파일 규칙: 이펙트 본문에서 동기 setState 금지. setState 는 프라미스 콜백에서만.)
    if (nickname.length < 2 || nickname.length > NICK_MAX) return
    let alive = true
    const timer = window.setTimeout(() => {
      callFunction<GiftLookupResp>('coin-gift', { action: 'lookup', nickname })
        .then((r) => {
          if (!alive) return
          if (r.name) {
            setGiftTo({ ok: true, card: {
              name: r.name,
              avatar: r.avatar ?? null,
              countryCode: r.country_code ?? null,
              regionCode: r.region_code ?? null,
              seasonTotal: r.season_total ?? 0,
            } })
            return
          }
          const map: Record<string, string> = {
            not_found: 'hub.gift.err_not_found',
            self: 'hub.gift.err_self_code',
            too_many: 'hub.gift.err_too_many',
          }
          setGiftTo({ ok: false, errKey: map[r.error ?? ''] ?? 'hub.gift.err_lookup' })
        })
        .catch(() => { if (alive) setGiftTo({ ok: false, errKey: 'hub.gift.err_lookup' }) })
    }, 450)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [giftNick, modal])

  async function doGift() {
    if (!giftNonce || giftSending) return
    const amount = Math.floor(Number(giftAmount))
    if (!Number.isFinite(amount) || amount <= 0) { setGiftMsg({ ok: false, text: t('hub.gift.err_amount_required') }); return }
    try {
      setGiftSending(true)
      setGiftMsg(null)
      const r = await callFunction<GiftSendResp>('coin-gift', {
        action: 'send',
        nickname: giftNick.trim(),
        amount,
        client_nonce: giftNonce, // ⚠️ 재시도에도 같은 값 — 새로 만들면 두 번 보내진다.
      })
      setGiftMsg({ ok: true, text: t('hub.gift.sent_ok', { name: r.recipient_name, n: r.amount.toLocaleString() }) })
      // 성공했으니 이 nonce 는 소진됐다. 이어서 또 보내려면 새 값이 필요하다.
      setGiftNonce(crypto.randomUUID())
      setGiftNick(''); setGiftTo(null); setGiftAmount(''); setGiftConfirm(false)
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
  // HUD·내 방에 뜨는 이름 = 내 닉네임. (예전엔 'CARI' 가 박혀 있어서 누구 화면이든 같은 이름이었다.)
  // ⚠️ 구글 계정 이름(user_metadata.name)으로 폴백하지 말 것 — 실명이다. 닉네임 게이트가 막고 있는 걸
  //    프로필을 받아오는 짧은 사이에 그대로 흘린다. 아직 못 받았으면 마스코트 이름으로 둔다.
  const heroName = displayName?.trim() || 'CARI'

  // 지금 **그릴** 스킨 = 입어보는 중이면 그것, 아니면 실제 장착값.
  //   ⚠️ 저장값(skinPart)과 화면값(skin)을 갈라놓는 게 입어보기의 전부다. 저장 경로는 이 값을 안 본다.
  const skin = skinByPart(previewSkin ?? skinPart)
  // 인벤토리 = **가진 것**. 기본 스킨은 산 적이 없어도 늘 있는 것으로 친다(되돌아갈 길이 필요하다).
  const ownedChars = CHAR_KEYS.filter((k) => owned.has(k))
  const ownedSkins = SKINS.filter((s) => s.partKey === DEFAULT_SKIN_PART || owned.has(s.partKey))
  // 첫 진입 흐름 — 순서가 곧 규칙이다: 캐릭터를 고른 다음에 튜토리얼.
  //   ⚠️ null(아직 모름)일 때는 **아무것도 띄우지 않는다.** false 로 판정하면 하이드레이트 전 한 프레임에
  //      이미 끝낸 사람 화면에도 선택창이 번쩍인다.
  // 첫 선택 후보 = **판매 중인 캐릭터 전부**. 값은 안 본다 — 첫 선택은 값과 무관하게 공짜고
  //   (20260824120000), 두 번째부터 상점에서 값을 내고 산 것만 갈아입는다.
  //   ⚠️ 값으로 거르면 안 된다 — 캐릭터가 전부 유료(500)라 후보가 0종이 되어 첫 화면이 빈다.
  //   ⚠️ 코드의 CHAR_KEYS 를 그대로 쓰면 안 된다 — 진열에서 내린 캐릭터까지 후보에 섞여서,
  //      고르는 순간 서버가 not_owned 로 거절한다(화면과 서버가 다른 말을 한다).
  //      카탈로그는 get-hub 가 active 만 내려주므로 그게 곧 후보다.
  //   ⚠️ 카탈로그가 아직 안 왔거나 비어 있으면 코드 목록으로 떨어진다 — 빈 화면에 가두는 것보단 낫다.
  const starterKeys = catalog.filter((c) => (c.kind ?? '') === 'character').map((c) => c.partKey)
  const pickKeys = starterKeys.length ? starterKeys : CHAR_KEYS
  // 계열별로 묶는다 — 한 계열이 카드 한 장이고, 좌우 버튼이 그 안에서 모습을 바꾼다.
  const pickSeries: { series: string; keys: string[] }[] = []
  for (const k of pickKeys) {
    const series = charSeriesOf(k)
    const found = pickSeries.find((g) => g.series === series)
    if (found) found.keys.push(k)
    else pickSeries.push({ series, keys: [k] })
  }
  const needCharPick = authed && charChosen === false
  const needTutorial = authed && charChosen === true && tutorialDone === false
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

  // 허브는 로그인 전용(게스트는 출석·상점이 전부 잠긴 빈 화면이라 진입 자체를 막는다).
  //   로그인 후 /hub 로 복귀 — /auth/callback?next=/hub 로 왕복해도 next 가 URL 에 실려 안 날아간다.
  //   loading 중엔 판정 보류(허브가 한 프레임 번쩍였다 게이트로 바뀌는 것 방지).
  if (loading) {
    return (
      <div className="bg-background text-on-surface min-h-screen flex items-center justify-center">
        <p className="font-body-md text-body-md text-on-surface-variant">{t('common.loading')}</p>
      </div>
    )
  }
  if (!isFullUser) {
    return (
      <div className="bg-background text-on-surface min-h-screen flex flex-col">
        <main className="flex-grow flex items-center justify-center px-margin-mobile py-24">
          <div className="max-w-md w-full text-center bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-10 ambient-shadow">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
              <span className="material-symbols-outlined text-[32px]">login</span>
            </div>
            <h1 className="mb-2 font-title-md text-title-md font-bold text-on-surface">{t('hub.gate_title')}</h1>
            <p className="mb-6 font-body-md text-body-md text-on-surface-variant break-keep">{t('hub.gate_sub')}</p>
            <button
              onClick={() => {
                // 복귀 경로는 저장소에 심어 넘긴다 — Supabase 가 redirect_to 의 query 를 유실시킨다(lib/postLogin 참고).
                rememberPostLogin('/hub')
                navigate('/login')
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-label-md text-label-md font-bold text-on-primary ambient-shadow"
            >
              {t('common.login')}
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    // ⚠️ 입어보기 띠는 화면 맨 위 고정이라 그대로 두면 뒤로가기 줄을 덮는다 → 그때만 위를 비운다.
    <div className={`hub${previewSkin ? ' is-tryon' : ''}`} data-skin={skin.key} data-ui={skin.ui}>
      {/* 무대 = 배경 사진 + 캐릭터, 화면에 붙은 한 쌍(2026-08-14 레퍼런스: 전체화면 사진 위 정중앙 캐릭터).
          ⚠️ 그림 URL·크기·발끝 위치는 **여기 없다** — 전부 hub.css 의 스킨 값 블록이다.
             그래서 스킨을 바꿔도 이 마크업은 그대로다(그게 스킨 구조의 목적이다).
          ⚠️ `.hub` 는 max-width 480px 가운데 열이라 배경을 그 안에 두면 화면을 못 채운다 → viewport 고정 레이어로 뺐다.
          ⚠️ 그래서 hub.css 의 `.hub > *:not(...)` 예외 목록에 `.hub-scene` 이 들어가 있다.
             빼면 flex/relative 아이템으로 접혀 0×0 이 된다(랜딩 `.rg` 에서 실제로 겪은 사고).
          ⚠️ pointer-events:none 필수 — 화면 전체를 덮으므로 없으면 아래 UI 가 하나도 안 눌린다.
          ⚠️ 캐릭터 그림을 갈면 **투명 여백을 트림할 것** — 아래에 빈 알파가 남으면 발끝이 그만큼 떠서
             `--skin-char-bottom` 이 거짓말이 된다(받은 원본은 아래 14%가 여백이었다).
          ⚠️ 캐릭터만 CSS 배경이 아니라 <img> 다(2026-08-20). 이유 = **그림이 없을 때 폴백**이 필요해서다
             — background-image 는 실패를 알 수 없어, 아직 안 그려진 캐릭터를 고르면 무대가 텅 빈다.
             칸(위치·키)은 그대로 `.hub-scene-char` 가 잡고 그림만 그 안을 채운다. */}
      <div className="hub-scene" aria-hidden="true">
        <div className="hub-scene-bg" />
        <div className="hub-scene-char">
          {/* 캐릭터 레벨 = ARENA 레벨(시즌 총점 밴드, 1~7). 점수가 오르면 무대 위 캐릭터가 그대로 자란다.
              ⚠️ 시험 사다리 등급(user_progress.rank)이 아니다 — 둘 다 1~7 이라 헷갈리기 쉽다. */}
          <CharArt charKey={charKey} level={arenaLv} className="hub-scene-char-img" />
        </div>
      </div>

      <div className="sky" aria-hidden="true">
        <div className="sun" />
        <div className="cloud c1" /><div className="cloud c2" /><div className="cloud c3" />
        <span className="spark s1">✦</span><span className="spark s2">✦</span>
        <span className="spark s3">✧</span><span className="spark s4">✦</span>
      </div>

      {/* 허브는 아레나 런처(CARI 버튼)로 들어오는 화면 — 뒤로가기도 아레나로 */}
      <div className="hub-backrow">
        <Link className="hub-back" to="/arena">
          <span className="material-symbols-outlined">arrow_back</span>WORLD ARENA
        </Link>
        {/* 오른쪽 두 버튼은 묶어둔다 — .hub-backrow 가 space-between 이라 낱개로 넣으면 셋이 흩어진다.
            선물은 초대하기 모달에 넣지 않고 여기 독립 진입점으로 둔다(2026-08-07 결정). */}
        <div className="hub-backrow-act">
          {/* 코인 선물 = 닉네임으로 CARI 코인을 즉시 이체. 뱃지 = 아직 확인 안 한 받은 선물 건수.
              GIFT_ENABLED=false 인 동안은 이 버튼이 유일한 진입점이라 안 그리면 모달도 못 연다. */}
          {GIFT_ENABLED && (
            <button className="hub-share hub-gift" onClick={openGift}>
              <span className="ic"><Ic n="coin" s={16} /></span>{t('hub.gift_btn')}
              {giftsUnseen > 0 && <span className="bd">{giftsUnseen}</span>}
            </button>
          )}
          {/* 공유 = 지금 순위·티어·칭호로 카드(PNG) 를 만들어 내보낸다(ShareCardModal) */}
          <button className="hub-share" onClick={() => setModal('share')}>
            <span className="ic"><Ic n="share" s={17} /></span>{t('hub.share')}
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
              {/* 닉네임은 12자까지 들어오므로 좁은 화면에서 자격 배지를 밀어낸다 → 이름만 말줄임(.hud-nick). */}
              <span className="hud-nick">{heroName}</span> {titleBadge}
              {/* 랭킹 점수 = 시즌 총점. 서버가 늘 내려주던 값인데 화면에 쓰는 곳이 없었다(2026-08-20).
                  ⚠️ **이름에 바로 붙인다 — 오른쪽 끝으로 밀지 말 것.** 끝에 붙였더니 바로 아래 코인 칩과
                     세로로 겹쳐 서서 같은 종류로 읽혔다(랭킹 점수 ↔ 상점 재화는 지갑이 다르다).
                     자기 줄로 빼는 안도 만들어봤는데 HUD 가 3단이 되어 반려됐다.
                  ⚠️ 경험치 바의 분수(16/1,000)는 **밴드 안 진행분**이라 총점이 아니다 — 그래서 총점을
                     따로 보여줘야 한다. 반대로 바의 분수를 총점으로 바꾸면 바와 글자가 어긋나 보인다.
                  ⚠️ 순위·백분위는 **모수가 충분할 때만** 붙인다(showPercentile). 사람이 적으면
                     '12명 중 3위' 가 되어 1등도 초라해 보인다. 점수는 몇 명이든 안전하다. */}
              {authed && (
                <span className="hud-score">
                  {t('hub.score_line', { n: seasonTotal.toLocaleString() })}
                  {percentile != null && showPercentile(rankTotal) && (
                    <span className="hud-score-pct"> · {t('hub.score_top', { n: Math.max(1, Math.round(percentile * 100)) })}</span>
                  )}
                </span>
              )}
            </div>
            <div className="hud-xp">
              {/* ARENA 레벨 경험치 바. 라벨은 바 안 오른쪽(exp-lab) — 바깥에 맨텍스트로 두면 덜렁거린다. */}
              {/* 바 안 왼쪽에 'ARENA Lv.N' — 레벨테스트 등급(Lv.1~7)과 이름이 겹쳐서, 이 바의 Lv 가 어느 축인지
                  바 스스로 밝히게 했다(원안 표의 표기도 'ARENA Lv.N' 이다). 오른쪽은 진행 점수. */}
              <div className="exp">
                <div className="exp-fill" style={{ width: `${gaugeFillPct}%` }} />
                <span className="exp-txt">
                  <span className="exp-lv">ARENA Lv.{arenaLv}</span>
                  {/* 화면 폭과 무관하게 **%만** 쓴다(2026-08-25 지시). 옛날엔 PC 에서 '159 / 1,000' 분수를
                      보여줬는데, 분모가 밴드 폭(1,000)이라 시즌 총점으로 오해하기 쉬웠고 좁은 화면에서는
                      어차피 'ARENA Lv.N' 이 잘려 %로 바꿔야 했다 — 두 표기를 유지할 이유가 없다. */}
                  <span className="exp-lab">{Math.round(gaugeFillPct)}%</span>
                </span>
              </div>
              {/* '?' 는 점수(경험치 바) 쪽 도움말이다 — 코인 옆에 두면 코인 설명으로 읽혀서 바 바로 뒤에 붙였다. */}
              <button className="hub-help" onClick={() => setModal('earn')} aria-label={t('hub.help_aria')}>?</button>
              {/* data-tip = 호버 툴팁("보유한 CARI 코인") — hub.css 의 .gchip[data-tip]::after */}
              <span className="gchip" data-tip={t('hub.coin_tip')}><span className="num">{points.toLocaleString()}</span></span>
            </div>
          </div>
        </div>

        {/* 오늘의 미션 — 무대 **위 가로 한 줄**(하단 '출석 보상' 스트립과 같은 형태).
            좌측 열로 두면 카드 하나 때문에 캐릭터가 옆으로 밀려서 전체 폭 한 줄로 옮겼다 → 캐릭터는 정중앙 유지.
            완료 판정은 서버 플래그(daily_activity 종류별), 점수는 scoring.ts 의 ACTIVITY_DELTA 파생. */}
        <div className="mission-bar" data-tut="mission">
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
            // to=null(출석) 은 **버튼이 아니다** — 자동으로 찍히는 것을 누르게 두면
            // 눌러도 아무 일이 없는 칸이 되어 "고장났나" 로 읽힌다.
            return m.to
              ? <Link key={m.kind} className={cls} to={m.to}>{body}</Link>
              : <span key={m.kind} className={`${cls} is-static`}>{body}</span>
          })}
          </div>
          <span className="ms-n">{missionDone}/{missions.length}</span>
        </div>

        {/* 친구 초대는 화면에 카드로 꺼내지 않는다 — 도크 '초대하기' 버튼 모달 하나로 모았다(진입점 중복 제거). */}
        <div className="stage-zone">
            {/* 왼쪽 레일 제거 — 출석을 오른쪽 맨 위로 옮기고 나머지(쿠폰)는 비활성화(숨김). */}
            {/* 쿠폰 복구 시: 아래 레일에 <button className="ricon" onClick={() => setModal('coupon')}>…</button> 추가. 모달·상태는 그대로. */}
            <div className="rail rail-r">
              {/* 옛 '출석' 칸은 제거됐다(2026-08-24) — 출석은 사이트에 들어오면 자동으로 찍힌다(lib/autoCheckin.ts).
                  ⚠️ 칸을 되살릴 일이 있어도 누르는 버튼으로 두지 말 것. 이미 찍힌 걸 또 누르는 자리가 된다. */}
              {/* '상점' → '꾸미기'. 사는 곳과 갈아입는 곳이 한 모달의 두 탭이라 상점만 말하면 절반을 숨긴다. */}
              <button className="fcard f-shop" data-tut="closet" onClick={() => { setClosetTab('shop'); setModal('closet') }}><span className="fico"><HubUiIcon n="shop" dir={skin.iconDir} /></span>{t('hub.rail.closet')}</button>
              <button className="fcard f-title" onClick={() => setModal('title')}><span className="fico"><HubUiIcon n="medal" dir={skin.iconDir} /></span>{t('hub.rail.title')}</button>
              <button className="fcard f-invite" onClick={() => setModal('invite')}><span className="ev">EVENT</span><span className="fico"><HubUiIcon n="invite" dir={skin.iconDir} /></span>{t('hub.rail.invite')}</button>
            </div>
        </div>

        {/* 도크: 7일 출석 스탬프 + 메인 CTA(랭킹) */}
        <div className="dock">
          {/* 스탬프판을 누르면 '출석 기록' 달력이 열린다(2026-08-25 — 옛 마이페이지 학습 대시보드의
              활동 기록 달력이 여기로 왔다). 이 판이 곧 출석이라 진입점을 따로 만들지 않았다:
              레일에 칸을 하나 더 넣으면 정사각 칸이 4개가 되면서 그만큼 작아진다.
              ⚠️ <div> 가 아니라 <button> 이라 hub.css 에서 font/색을 상속으로 되돌려야 한다. */}
          <button type="button" className="reward" data-tut="stamp" onClick={() => setModal('attend')}>
            <div className="rw-top">
              <Ic n="fire" s={20} /> {t('hub.reward_head')}
              <span className="rw-n">{stamps} / 7</span>
              {/* ⚠️ svg 가 아니라 글자다 — 궁궐 벌이 `.rw-top svg { display:none }` 라
                  아이콘으로 넣으면 그 스킨에서만 조용히 사라져 '눌리는 판' 이라는 표시가 없어진다. */}
              <span className="rw-more" aria-hidden="true">›</span>
            </div>
            <div className="streak">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <div key={d} className={`day ${d <= stamps ? 'on' : ''}`}>
                  {d === 7 && <span className="gift"><Ic n="gift" s={26} /></span>}
                  {t('hub.day_n', { n: d })}<span className="chk">{d <= stamps ? '✓' : ''}</span>
                </div>
              ))}
            </div>
          </button>
          {/* 미니게임은 /arena 하단 런처로 옮겼고, 이 자리는 랭킹 진입점이 됐다(옛 레벨선택 화면의 랭킹 버튼). */}
          <Link className="cta-main" to="/ranking">
            <span className="cta-star" aria-hidden="true">
              <HubUiIcon n="ranking" dir={skin.iconDir} s={24} />
            </span>
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
            <div className="buy-pop-title">{t('hub.buy.purchased')}</div>
            <div className="buy-pop-thumb">{partEmoji(purchased)}</div>
            <div className="buy-pop-name">{partName(purchased, t)}</div>

            <button className="pbtn buy-pop-ok" style={btn('#6bbf9a')} onClick={() => setPurchased(null)}>{t('hub.confirm')}</button>
          </div>
        </div>
      )}

      {/* 꾸미기 = 상점 + 인벤토리 한 모달의 두 탭(2026-08-20).
          ⚠️ 둘을 나누지 않은 이유 — 사고 나서 입는 게 한 동작이라, 화면을 나누면 산 뒤에 "그래서 어디서
             입지" 를 찾아야 한다. 구매 직후 인벤토리 탭으로 자동으로 넘어가는 것도 그래서다. */}
      {modal === 'closet' && (
        <Modal title={t('hub.closet.title')} className="closet-modal" onClose={() => setModal(null)}>
          <div className="hub-shop-head">
            <span className="hub-shop-head-lab">{t('hub.shop.balance')}</span>
            <span className="gchip" style={{ margin: 0 }}><span className="num">{points.toLocaleString()}</span></span>
          </div>

          <div className="closet-tabs" role="tablist">
            {(['shop', 'items'] as ClosetTab[]).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={closetTab === k}
                className={`closet-tab${closetTab === k ? ' on' : ''}`}
                onClick={() => setClosetTab(k)}
              >
                {t(k === 'shop' ? 'hub.closet.tab_shop' : 'hub.closet.tab_items')}
              </button>
            ))}
          </div>

          {closetTab === 'shop' ? (
            catalog.length > 0 ? (
              // 종류별로 묶어서 진열한다 — 캐릭터·배경·가구가 한 격자에 섞이면 뭘 사는 건지 안 갈린다.
              // 진열 순서는 서버(sort_order)가 정하므로 여기서 다시 정렬하지 않는다.
              <>
                {CLOSET_GROUPS.map(({ kind, labelKey }) => {
                  const items = catalog.filter((c) => (c.kind ?? 'part') === kind)
                  if (!items.length) return null
                  return (
                    <div key={kind} className="closet-group">
                      <h4 className="closet-group-h">{t(labelKey)}</h4>
                      <div className="hub-modal-grid">
                        {items.map((c) => {
                          const has = owned.has(c.partKey)
                          return (
                            <div key={c.partKey} className="hub-shop-item">
                              {has && <span className="hub-shop-owned">{t('hub.shop.owned')}</span>}
                              {/* 썸네일 = 미리보기 버튼. 74px 로는 캐릭터가 어떻게 생겼는지도,
                                  스킨이 화면을 어떻게 바꾸는지도 알 수 없다 — 사기 전에 크게 볼 길이 필요하다. */}
                              <button className="hub-shop-thumb pv-open" onClick={() => openPreview(c.partKey)} aria-label={t('hub.closet.preview')}>
                                <CosmeticThumb partKey={c.partKey} />
                                <span className="pv-mag" aria-hidden="true"><span className="material-symbols-outlined">search</span></span>
                              </button>
                              {/* 어느 면에 놓는 물건인지 이름 옆에 밝힌다 — 방에 자리가 벽 2칸·바닥 3칸으로 나뉘어 있어서,
                                  안 밝히면 벽 자리만 남았는데 바닥 가구를 사는 일이 생긴다. */}
                              <div className="hub-shop-name">{partName(c.partKey, t)}</div>
                              <div className="hub-shop-price">{c.price > 0 ? `🪙 ${c.price}` : t('hub.shop.free')}</div>
                              <button className="pbtn hub-shop-buy" style={btn(has ? '#c3cbe0' : '#6bbf9a')} onClick={() => doBuy(c.partKey, c.price)} disabled={has}>
                                {t(has ? 'hub.shop.owned' : 'hub.shop.buy')}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </>
            ) : (
              <p className="hub-modal-help">{t(isFullUser ? 'hub.shop.empty' : 'hub.shop.login')}</p>
            )
          ) : (
            // ── 인벤토리 — 가진 것을 눌러 갈아입는다. 지금 입은 것에 표시가 붙는다. ──
            <>
              <div className="closet-group">
                <h4 className="closet-group-h">{t('hub.closet.g_character')}</h4>
                {ownedChars.length ? (
                  <div className="hub-modal-grid">
                    {ownedChars.map((k) => (
                      // ⚠️ 카드 전체를 버튼으로 두지 않는다 — 누르는 곳이 둘(미리보기 · 적용)이라
                      //    카드가 통째로 버튼이면 미리보기를 누를 자리가 없다.
                      <div key={k} className={`closet-item${charKey === k ? ' on' : ''}`}>
                        <button className="closet-item-thumb pv-open" onClick={() => openPreview(k)} aria-label={t('hub.closet.preview')}>
                          <CharArt charKey={k} level={arenaLv} className="closet-char-img" />
                          <span className="pv-mag" aria-hidden="true"><span className="material-symbols-outlined">search</span></span>
                        </button>
                        <span className="closet-item-name">{partName(k, t)}</span>
                        <button className="closet-item-act" onClick={() => equip('character', k)} disabled={charSaving || charKey === k}>
                          {t(charKey === k ? 'hub.closet.worn' : 'hub.closet.wear')}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="hub-modal-help">{t('hub.closet.empty_character')}</p>
                )}
              </div>

              <div className="closet-group">
                <h4 className="closet-group-h">{t('hub.closet.g_skin')}</h4>
                <div className="hub-modal-grid">
                  {ownedSkins.map((sk) => (
                    <div key={sk.partKey} className={`closet-item${skinPart === sk.partKey ? ' on' : ''}`}>
                      <button className="closet-item-thumb pv-open" onClick={() => openPreview(sk.partKey)} aria-label={t('hub.closet.preview')}>
                        <img className="closet-skin-img" src={skinThumb(sk)} alt="" />
                        <span className="pv-mag" aria-hidden="true"><span className="material-symbols-outlined">search</span></span>
                      </button>
                      <span className="closet-item-name">{partName(sk.partKey, t)}</span>
                      <button className="closet-item-act" onClick={() => equip('skin', sk.partKey)} disabled={skinPart === sk.partKey}>
                        {t(skinPart === sk.partKey ? 'hub.closet.worn' : 'hub.closet.wear')}
                      </button>
                    </div>
                  ))}
                </div>
                {/* 스킨은 배경만 바꾸는 게 아니라 판·게이지·스탬프까지 통째로 바뀐다 — 미리 말해둔다. */}
                <p className="hub-modal-help">{t('hub.closet.skin_help')}</p>
              </div>
            </>
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
            // 카드 좌 패널 = 지금 입고 있는 배경 + 캐릭터. 허브에서 보던 그 그림이 그대로 나간다.
            character: charKey,
            skin: skinPart,
            charLevel: arenaLv,
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

      {/* 출석 기록 — 도크 스탬프판을 눌러서 연다. 7일 판이 '이번 사이클', 이 달력이 '지금까지 전부'다.
          ⚠️ 안내문(hub.attend.help)을 빼지 말 것 — 출석은 2026-08-24 부터 **사이트에 들어오면 자동으로**
             찍힌다. 누르는 버튼이 없어졌으니 어떻게 찍히는지 말해주는 자리가 여기밖에 없다. */}
      {modal === 'attend' && (
        <Modal title={t('hub.attend.title')} className="attend-modal" onClose={() => setModal(null)}>
          <ContributionGraph days={new Set(attendanceDays)} />
          <p className="hub-modal-help">{t('hub.attend.help')}</p>
        </Modal>
      )}

      {/* 점수·코인 획득 방법 — 점수 수치는 scoring.ts(원안 반영본) 파생이라 여기서 하드코딩하지 않는다.
          ⚠️ **두 지갑을 한 표에 섞지 말 것.** 시즌 점수는 랭킹, 코인은 상점이라 쓰는 곳도 버는 길도 다르다.
             섞으면 "미니게임 하면 코인이 늘겠지" 같은 오해가 그대로 생긴다(미니게임은 점수만 준다). */}
      {modal === 'earn' && (
        <Modal title={t('hub.earn.title')} onClose={() => setModal(null)}>
          <div className="earn-sec"><Ic n="trophy" s={17} />{t('hub.earn.sec_score')}</div>
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

          <div className="earn-sec earn-sec-2"><Ic n="coin" s={17} />{t('hub.earn.sec_coin')}</div>
          <p className="hub-modal-help earn-lead">{t('hub.earn.coin_lead')}</p>
          <table className="earn-tb">
            <thead><tr><th>{t('hub.earn.col_act')}</th><th>{t('hub.earn.col_coin')}</th></tr></thead>
            <tbody>
              {COIN_ROWS.filter((r) => GIFT_ENABLED || r.key !== 'gift').map((r) => (
                <tr key={r.key}>
                  <td className="earn-nm"><span className="earn-ic"><Ic n={r.icon} s={20} /></span>{t(`hub.earn.coin.${r.key}`)}</td>
                  <td className="earn-v">
                    {r.n === null ? t('hub.earn.coin_any') : t('hub.earn.coin_pt', { n: r.n })}
                    <em>{t(`hub.earn.coin_note.${r.key}`)}</em>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {modal === 'invite' && (
        <Modal title={t('hub.invite.title')} onClose={() => setModal(null)}>
          <div className="iv-title">{t('hub.invite.lead')}</div>
          {/* 두 안내문(help·hint)은 각각 "내 코드를 남이 쓰면" / "남의 코드를 내가 쓰면" 을 말한다.
              금액은 상수에서 넣는다 — 문장에 박으면 보상을 고칠 때 6개국어 12줄이 조용히 거짓말을 한다. */}
          <p className="hub-modal-help">{t('hub.invite.help', { n: REFERRAL_COIN })}</p>
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
                    /* ⚠️ 옛날엔 선물 모달의 라벨 키(hub.gift.code_label)를 빌려 쓰고 있었다. 선물이 닉네임으로
                       바뀌면서 그 키가 사라졌으므로 여기는 **초대 쪽 자기 키**를 쓴다 — 남의 화면 키를
                       빌려 쓰면 그 화면이 바뀔 때 이렇게 조용히 깨진다. */
                    aria-label={t('hub.invite.redeem_head')}
                  />
                  <button className="iv-copy" onClick={redeemReferral} disabled={redeeming || !redeemInput.trim()}>
                    {t(redeeming ? 'hub.invite.checking' : 'hub.invite.register')}
                  </button>
                </div>
                <p className="hub-modal-help iv-redeem-hint">{t('hub.invite.hint', { n: REFERRAL_COIN })}</p>
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

          {/* 보내기 — 되돌릴 수 없으니 닉네임 → 상대 카드 확인 → 금액 → 확인 순서를 강제한다. */}
          <div className="gf-send">
            <div className="gf-send-head">{t('hub.gift.send_head')}</div>
            <label className="gf-lab" htmlFor="gf-nick">{t('hub.gift.nick_label')}</label>
            <input
              id="gf-nick"
              className="gf-in"
              value={giftNick}
              /* 닉네임이 바뀌면 앞서 띄운 카드는 그 자리에서 무효다 — 여기서 지운다(이펙트가 아니라).
                 남겨두면 고치는 도중에도 옛 카드가 붙어 있어 엉뚱한 사람을 보고 보내게 된다. */
              onChange={(e) => { setGiftNick(e.target.value); setGiftTo(null); setGiftConfirm(false); setGiftMsg(null) }}
              placeholder={t('hub.gift.nick_ph')}
              maxLength={NICK_MAX}
              disabled={giftSending}
              autoComplete="off"
            />
            {/* ⛔ **이름만 보여주면 안 된다.** 사용자가 방금 친 값이 그대로 되돌아오는 것이라 확인 기능이 0이다.
                아바타·ARENA 레벨·국기·지역은 사용자가 안 친 정보라, 이 카드가 오타 방어선을 대신한다.
                (옛 친구코드 방식에서는 '내가 모르는 닉네임이 뜬다' 자체가 확인이었다.) */}
            {giftTo?.ok && (
              <div className="gf-card">
                <Avatar avatarUrl={giftTo.card.avatar} seed={giftTo.card.name} size={46} />
                <div className="gf-card-txt">
                  <b className="gf-card-nm">{giftTo.card.name}</b>
                  <span className="gf-card-sub">
                    ARENA Lv.{arenaLevelForScore(giftTo.card.seasonTotal)}
                    {giftTo.card.countryCode && (
                      <>
                        {' · '}
                        {flagUrl(giftTo.card.countryCode) && <img className="gf-card-flag" src={flagUrl(giftTo.card.countryCode)} alt="" />}
                        {countryName(giftTo.card.countryCode, lang)}
                      </>
                    )}
                    {regionName(giftTo.card.regionCode) && ` · ${regionName(giftTo.card.regionCode)}`}
                  </span>
                </div>
              </div>
            )}
            {giftTo && !giftTo.ok && <p className="gf-to">{t(giftTo.errKey)}</p>}

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
                  {t('hub.gift.confirm_q', { name: giftTo?.ok ? giftTo.card.name : '', n: Number(giftAmount).toLocaleString() })}
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

      {/* ── 스킨 입어보기 띠 ────────────────────────────────────────────────────
          화면에는 이미 그 스킨이 얹혀 있고(위 `skin` 파생), 이 띠는 **임시라는 사실**만 말한다.
          ⚠️ 없으면 안 된다 — 띠가 없으면 사용자는 자기가 이미 산·적용한 줄 알고 나간다.
          ⚠️ 화면 맨 위 고정. 아래에 두면 떠 있는 FAB(왼쪽 아래)·맨위로 버튼(오른쪽 아래)이 덮는다. */}
      {previewSkin && (() => {
        const item = catalog.find((c) => c.partKey === previewSkin)
        const has = owned.has(previewSkin) || previewSkin === DEFAULT_SKIN_PART
        return (
          <div className="tryon" role="status">
            <span className="tryon-lab">
              {/* '미리보기 중' 은 이 띠의 전부다 — 회색 잔글씨로 두면 사람이 산 줄 알고 나간다.
                  그래서 눈 아이콘 + 노란 배지로 띄우고, 옆에 무엇을 보고 있는지(스킨 이름)를 붙인다. */}
              <span className="tryon-tag">
                <span className="material-symbols-outlined">visibility</span>
                {t('hub.closet.tryon_on')}
              </span>
              <b className="tryon-name">{partName(previewSkin, t)}</b>
            </span>
            <div className="tryon-act">
              {/* 되돌리기가 먼저다 — 되돌릴 수 있다는 걸 먼저 보여줘야 마음 놓고 눌러본다. */}
              <button className="tryon-btn tryon-btn-ghost" onClick={() => endTryOn()}>
                {t('hub.closet.tryon_back')}
              </button>
              {!has && item ? (
                <button className="tryon-btn" onClick={() => doBuy(item.partKey, item.price)}>
                  {item.price > 0 ? t('hub.closet.tryon_buy', { n: item.price.toLocaleString() }) : t('hub.shop.buy')}
                </button>
              ) : (
                <button className="tryon-btn" onClick={() => equip('skin', previewSkin)}>
                  {t('hub.closet.wear')}
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── 미리보기 — 상점·보관함 어디서 눌렀든 같은 창 ───────────────────────
          ⚠️ 스킨은 **배경만 보여주면 안 된다.** 스킨이 바꾸는 건 배경뿐 아니라 판·게이지·도장·아이콘
             전부라, 배경 사진만 크게 띄우면 정작 화면이 어떻게 달라지는지를 못 본다.
             그래서 그 스킨의 레일 아이콘을 배경 위에 얹어 같이 보여준다(경로는 SkinDef.iconDir 가 안다). */}
      {preview && (() => {
        const item = catalog.find((c) => c.partKey === preview)
        const isChar = isCharKey(preview)
        const has = owned.has(preview) || (isSkinKey(preview) && preview === DEFAULT_SKIN_PART)
        const wearing = isChar ? charKey === preview : skinPart === preview
        return (
          <Modal title={partName(preview, t)} onClose={() => setPreview(null)}>
            {isChar ? (
              // ⚠️ 일곱을 나열하면 한 칸이 썸네일만 해져서 **미리보기가 미리보기 구실을 못 한다**
              //    (고르는 화면은 '비교'가 목적이라 나열이 맞지만, 여기는 '크게 보기'가 목적이다).
              //    그래서 큰 그림 하나 + 아래에서 레벨을 갈아 보는 방식이다.
              <>
                <div className="pv-big"><CharArt charKey={preview} level={pvLevel} className="pv-big-img" /></div>
                <div className="pv-levels" role="tablist">
                  {CHAR_LEVELS.map((lv) => (
                    <button
                      key={lv}
                      role="tab"
                      aria-selected={lv === pvLevel}
                      className={`pv-cell${lv === pvLevel ? ' on' : ''}`}
                      onClick={() => setPvLevel(lv)}
                    >
                      <CharArt charKey={preview} level={lv} className="pv-img" />
                      <em className="pv-lv">Lv.{lv}</em>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              // 스킨은 여기 오지 않는다(입어보기로 빠진다) — 남은 건 가구·기타 아이템이다.
              <div className="pv-plain">{partEmoji(preview)}</div>
            )}

            <div className="pv-act">
              {!has && item ? (
                <>
                  <span className="pv-price">{item.price > 0 ? `🪙 ${item.price}` : t('hub.shop.free')}</span>
                  <button
                    className="pbtn pv-btn"
                    style={btn('#6bbf9a')}
                    onClick={() => { doBuy(item.partKey, item.price); setPreview(null) }}
                  >
                    {t('hub.shop.buy')}
                  </button>
                </>
              ) : (
                <button
                  className="pbtn pv-btn"
                  style={btn(wearing ? '#c3cbe0' : '#6bbf9a')}
                  disabled={wearing || charSaving}
                  onClick={() => { equip(isChar ? 'character' : 'skin', preview); setPreview(null) }}
                >
                  {t(wearing ? 'hub.closet.worn' : 'hub.closet.wear')}
                </button>
              )}
            </div>
          </Modal>
        )
      })()}

      {/* ── 첫 진입 ①: 캐릭터 고르기 ────────────────────────────────────────────
          닫는 길이 없다. 고르지 않으면 허브를 쓸 수 없고, 서버에도 그렇게 기록되어 있어
          창을 껐다 켜도·다른 브라우저로 와도 같은 화면이 뜬다(localStorage 가 아니다).
          ⚠️ 계열 셋을 **한 줄로** 놓는다(요청). 좁은 화면에서도 세로로 쌓지 않는다 —
             셋을 한눈에 비교하는 게 이 화면의 전부라, 스크롤이 생기면 비교가 안 된다. */}
      {needCharPick && (
        <div className="charpick" role="dialog" aria-modal="true" aria-label={t('hub.charpick.title')}>
          <div className="charpick-inner">
            <h2 className="charpick-title">{t('hub.charpick.title')}</h2>
            <p className="charpick-sub">{t('hub.charpick.sub')}</p>

            {/* 계열 하나 = **가로로 긴 줄 한 개**, 그 줄 안에 Lv.1~7 이 늘어선다.
                그런 줄이 위에서부터 3단으로 쌓인다(2026-08-20 요구).
                ⚠️ 줄 안에서 가로 스크롤을 만들지 말 것 — 일곱 단계를 **한눈에** 보여주는 게 이 줄의 전부라,
                   스크롤이 생기면 자라는 모습을 보려고 밀어야 해서 비교가 안 된다. 좁으면 그림이 작아진다. */}
            <div className="cp-list">
              {pickSeries.map(({ series, keys }) => {
                const i = (charLook[series] ?? 0) % keys.length
                const key = keys[i]
                const picked = charPick === key
                // 좌우 버튼은 **이 계열 안에서만** 돈다 — 다른 계열은 각자 보고 있던 모습을 유지한다.
                const cycle = (d: number) =>
                  setCharLook((p) => ({ ...p, [series]: (i + d + keys.length) % keys.length }))
                return (
                  <div key={series} className={`cp-row${picked ? ' on' : ''}`}>
                    <div className="cp-head">
                      <span className="cp-name">{partName(key, t)}</span>
                      {/* 변형이 하나뿐인 계열엔 전환 UI 를 안 그린다 — 눌러도 안 바뀌는 버튼은 고장으로 읽힌다. */}
                      {keys.length > 1 && (
                        <span className="cp-dots">
                          {keys.map((k, ki) => (
                            <button
                              key={k}
                              className={`cp-dot${ki === i ? ' on' : ''}`}
                              aria-label={partName(k, t)}
                              onClick={() => setCharLook((p) => ({ ...p, [series]: ki }))}
                            />
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="cp-body">
                      {keys.length > 1 && (
                        <button className="cp-arrow" aria-label={t('hub.charpick.prev')} onClick={() => cycle(-1)}>‹</button>
                      )}
                      {/* 줄 전체가 고르는 자리다 — 어느 칸을 눌러도 이 캐릭터를 고른 것이다
                          (칸마다 고르게 하면 "Lv.5 를 골랐다" 로 읽혀 시작 레벨을 고르는 화면처럼 보인다). */}
                      <button className="cp-strip" onClick={() => setCharPick(key)} aria-pressed={picked}>
                        {CHAR_LEVELS.map((lv) => (
                          <span className={`cp-cell${lv === CHAR_MIN_LEVEL ? ' is-start' : ''}`} key={lv}>
                            <CharArt charKey={key} level={lv} className="cp-img" />
                            <em className="cp-lv">Lv.{lv}</em>
                          </span>
                        ))}
                      </button>
                      {keys.length > 1 && (
                        <button className="cp-arrow" aria-label={t('hub.charpick.next')} onClick={() => cycle(1)}>›</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <button
              className="charpick-go"
              disabled={!charPick || charSaving}
              onClick={() => charPick && chooseCharacter(charPick)}
            >
              {charSaving ? t('common.loading') : charPick ? t('hub.charpick.go', { name: partName(charPick, t) }) : t('hub.charpick.pick_first')}
            </button>
            {/* 되돌릴 수 있는지 없는지를 미리 말한다 — 안 말하면 고르는 손이 멈춘다. */}
            <p className="charpick-note">{t('hub.charpick.note')}</p>
          </div>
        </div>
      )}

      {/* ── 첫 진입 ②: 튜토리얼 ─────────────────────────────────────────────── */}
      {needTutorial && (
        <TutorialOverlay
          step={tutorialStep}
          onPrev={() => setTutorialStep((v) => Math.max(0, v - 1))}
          onNext={() => setTutorialStep((v) => v + 1)}
          onDone={finishTutorial}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// 튜토리얼 — 검은 화면 + 가리키는 자리에 구멍.
//
// ⚠️ **누르게 시키지 않고 가리키기만 한다(2026-08-20 결정).** "출석을 눌러보세요" 로 진행을 묶으면
//    오늘 이미 출석한 사람은 눌러도 아무 일이 없어 **거기서 갇힌다.** 튜토리얼은 어디에 뭐가 있는지
//    알려주는 게 목적이고, 실제로 누르는 건 끝난 뒤에 하면 된다.
// ⚠️ 그래서 구멍은 **보여주기 전용**이다(pointer-events: none). 뚫린 자리를 실제로 누를 수 있게 하면
//    튜토리얼 도중에 모달이 열려 안내 카드와 겹친다.
// ⚠️ 구멍 좌표는 매번 실측한다 — 화면 폭·스킨에 따라 자리가 달라져서 값을 박아두면 곧 어긋난다.
// ══════════════════════════════════════════════════════════════════════════
/** 단계표. target = `data-tut` 값(없으면 화면 가운데 카드만). 순서가 곧 진행 순서다.
 *  ⚠️ 옛 'daily'(출석 버튼) 단계는 빠졌다(2026-08-24) — 가리킬 버튼이 없어졌고, 자동으로 찍히는 것에
 *     "하루 한 번 눌러요" 라고 가르치면 그 자리에서 거짓말이 된다. 그 내용은 'stamp' 단계가 흡수했다. */
const TUTORIAL_STEPS: { target: string | null; key: string }[] = [
  { target: null, key: 'welcome' },
  { target: 'mission', key: 'mission' },
  { target: 'closet', key: 'closet' },
  { target: 'stamp', key: 'stamp' },
]

function TutorialOverlay({ step, onPrev, onNext, onDone }: {
  step: number
  onPrev: () => void
  onNext: () => void
  onDone: () => void
}) {
  const { t } = useT()
  const cur = TUTORIAL_STEPS[Math.min(step, TUTORIAL_STEPS.length - 1)]
  const last = step >= TUTORIAL_STEPS.length - 1
  const [measured, setMeasured] = useState<DOMRect | null>(null)
  // 가리킬 자리가 없는 단계는 **재는 게 아니라 안 쓰는 것**이다 — 이펙트에서 null 을 다시 써넣지 않고
  // 여기서 걸러낸다(그래야 단계가 넘어갈 때 렌더가 한 번 더 돌지 않는다).
  const rect = cur.target ? measured : null

  // 가리킬 자리를 실측한다. 창 크기가 바뀌거나 단계가 넘어가면 다시 잰다.
  //   ⚠️ 못 찾으면 null 로 둔다 — 그 단계는 구멍 없이 가운데 카드로 뜬다(화면이 깨지지 않는다).
  useEffect(() => {
    if (!cur.target) return
    const measure = () => {
      const el = document.querySelector(`[data-tut="${cur.target}"]`)
      setMeasured(el ? el.getBoundingClientRect() : null)
    }
    // ⚠️ 첫 실측은 **다음 프레임**에 한다. 오버레이가 붙는 순간에는 아래 화면의 배치가 아직 확정되지
    //    않을 수 있어(그림·글꼴이 늦게 오면 자리가 밀린다) 곧바로 재면 구멍이 엉뚱한 데 뚫린다.
    const raf = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure) }
  }, [cur.target])

  // 안내 카드는 구멍을 가리면 안 된다 — 구멍이 화면 위쪽이면 아래에, 아래쪽이면 위에 붙인다.
  const below = rect ? rect.bottom < window.innerHeight * 0.55 : true
  const PAD = 10

  return (
    <div className="tut" role="dialog" aria-modal="true">
      {rect ? (
        // 구멍 = 검은 판을 그리는 게 아니라 **투명 상자에 아주 큰 그림자**를 둘러 바깥을 덮는 방식.
        // SVG 마스크보다 가볍고, 상자 하나만 옮기면 구멍이 따라 움직인다.
        <div
          className="tut-hole"
          style={{
            left: rect.left - PAD, top: rect.top - PAD,
            width: rect.width + PAD * 2, height: rect.height + PAD * 2,
          }}
        />
      ) : (
        <div className="tut-veil" />
      )}

      <div
        className={`tut-card${rect ? '' : ' is-center'}`}
        style={rect ? (below ? { top: rect.bottom + 18 } : { bottom: window.innerHeight - rect.top + 18 }) : undefined}
      >
        <div className="tut-step">{step + 1} / {TUTORIAL_STEPS.length}</div>
        <h3 className="tut-title">{t(`hub.tut.${cur.key}_t`)}</h3>
        <p className="tut-body">{t(`hub.tut.${cur.key}_b`)}</p>
        <div className="tut-act">
          {step > 0 && <button className="tut-btn tut-btn-ghost" onClick={onPrev}>{t('hub.tut.prev')}</button>}
          <button className="tut-btn" onClick={last ? onDone : onNext}>{t(last ? 'hub.tut.done' : 'hub.tut.next')}</button>
        </div>
      </div>

      {/* 건너뛰기 — 강제하되 빠져나갈 문은 남긴다(2026-08-20 결정). 이미 아는 사람을 5단계 붙잡아두면
          그건 안내가 아니라 통행세다. 건너뛰어도 '끝냈다'로 기록되어 다시 뜨지 않는다. */}
      <button className="tut-skip" onClick={onDone}>{t('hub.tut.skip')}</button>
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
