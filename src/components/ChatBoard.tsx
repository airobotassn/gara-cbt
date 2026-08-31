import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useT, localeOf, type Lang } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { linkify } from '../lib/linkify'
import { Avatar } from './GemAvatar'
import { countryName, flagUrl } from '../lib/regions'
import ShareCardModal from './ShareCardModal'
import { scopedForCard, type CardScoped, type ShareCardData } from '../lib/shareCard'
import { arenaLevelForScore } from '../lib/scoring'

// 유사채팅(pseudo-chat) 보드 — 로그인 필요(작성), 조회는 공개. /arena 페이지 안의 섹션으로 렌더된다.
// 초기 페이지 → 폴링(신규분 append) + reconcile(가림/삭제 tombstone) + 위로 스크롤 시 이전 페이지(prepend).
// 본문은 항상 React 텍스트 child 로만 렌더(자동 이스케이프) — URL 만 NoticeDetail.linkify 방식으로 링크화.
// 표시 상한: 한 방당 최신 100개(MAX_ROWS) — 그 위로는 스크롤해도 안 불러온다.
//
// 방(room): 전세계('global') 하나 + 나라별 하나(ISO2). 어느 방인지는 부모가 정해서 내려준다.
//  ⚠️ 방이 바뀌면 부모가 key={room} 으로 **다시 마운트**시킨다 — 목록·커서·폴링 타이머가 한 방을 가리키는
//     상태 뭉치라, 방만 갈아끼우면 전 방으로 날아간 요청이 새 방 목록에 섞여 들어온다.
//
// 번역(2026-08-13): 원문이 기본이고, 토글을 켠 사람에게만 번역본을 보여준다.
//  ⚠️ 토글 상태를 이 컴포넌트 안에 두는 게 설계의 일부다. 방이 바뀌면 재마운트되면서 **꺼진 채로 시작**한다
//     — 켠 채로 유지하면 방에 들어가기만 해도 그 방이 수요로 등록되어 과거 글까지 전부 번역된다
//     (방을 100개 돌면 100개 방이 통째로 번역되는 그 함정). 안 누르면 아무 비용도 안 난다.
//  ⚠️ 번역 대상 언어는 서버가 국가(profiles.country_code)에서 정한다. 프론트가 언어를 보내지 않는다.
//  ⚠️ 수정·삭제는 없다(2026-08-13 제거) — 원문이 안 변하므로 번역본을 무효화할 일도 없다.

interface Row {
  id: number
  /** ⚠️ 익명 글은 null 이다 — 서버가 익명성 보호로 uuid 를 안 내려준다(chat-list 의 shapeRow). */
  user_id: string | null
  /** 작성자의 **지금** 닉네임 — 서버가 profiles 에서 덮어 내려준다(글에 박힌 옛 이름이 아니다). */
  display_name: string
  is_anon: boolean
  body: string | null
  mod_status: 'ok' | 'pending' | 'hidden'
  edited_at: string | null
  created_at: string
  updated_at: string
  /** 작성자 프로필 — chat-list 가 붙여준다. 익명 글·국가 미등록이면 null(렌더 생략). */
  avatar_url?: string | null
  country_code?: string | null
  sending?: boolean
  deleted_at?: string | null
}

/** 신고 사유 — 코드는 서버(chat_reports.reason)에 그대로 저장되므로 언어와 무관한 값으로 보낸다. */
const REPORT_REASONS = [
  { code: 'spam', key: 'chat.reportSpam' },
  { code: 'abuse', key: 'chat.reportAbuse' },
  { code: 'sexual', key: 'chat.reportSexual' },
  { code: 'flood', key: 'chat.reportFlood' },
  { code: 'privacy', key: 'chat.reportPrivacy' },
  { code: 'other', key: 'chat.reportOther' },
] as const

interface Tomb {
  id: number
  deleted_at: string | null
  edited_at: string | null
  mod_status: 'ok' | 'pending' | 'hidden'
  updated_at: string
  body: string | null
}

// 번역이 아직 없을 때 다시 물어보는 간격. 워커가 1초마다 도니 두 번이면 대부분 잡힌다.
//  ⚠️ 무한히 묻지 않는다 — 워커가 꺼져 있으면 영영 안 오므로 여기서 끊고 원문을 남긴다.
const RETRY_MS = [1500, 3000]
// 폴링(4초)에서 한 글을 최대 몇 번까지 다시 물어보나. 5번 ≈ 20초.
//  ⚠️ 무제한이면 워커가 못 하는 글을 영원히 다시 묻는다.
const TR_MAX_TRIES = 5

const MAX_LEN = 500
const POLL_MIN_MS = 3500
const POLL_MAX_MS = 4500
// 한 방에서 볼 수 있는 글 수 상한 — 위로 스크롤해도 **최신 100개까지만** 불러온다(2026-08-19).
//  ⚠️ 상한은 '불러오기'에 건다. 폴링으로 들어온 새 글까지 항상 자르려면 위에서 옛 글을 걷어내야 하는데,
//     위로 올라가 읽는 중이면 그 순간 화면이 통째로 밀린다. 그래서 **맨 아래를 보고 있을 때만** 창을 접는다
//     (그 직후 스크롤을 바닥에 다시 붙이므로 튀지 않는다).
const PAGE = 30
const MAX_ROWS = 100
// 바닥에서 이 안쪽이면 '맨 아래를 보고 있다'로 친다(줄 하나 높이보다 넉넉히).
const BOTTOM_GAP = 80

// 본문 렌더(URL 링크화 + 자동 이스케이프)는 ../lib/linkify 로 분리(단위 테스트 가능).

// 시각은 **항상 KST**(아레나 채팅은 한국 시간 기준 하나로 읽힌다)지만 **표기 언어는 화면 언어**다.
//   ⚠️ 로케일에 'ko-KR' 을 박아두면 언어를 바꿔도 '8월 10일' 처럼 날짜만 한국어로 남는다(2026-08-07 수정).
//   포매터는 만드는 비용이 있어 언어별로 캐시한다(메시지마다 새로 만들면 폴링 때 낭비가 크다).
const FMT_CACHE = new Map<string, { time: Intl.DateTimeFormat; day: Intl.DateTimeFormat }>()
function kstFmt(lang: Lang) {
  const key = localeOf(lang)
  let f = FMT_CACHE.get(key)
  if (!f) {
    f = {
      time: new Intl.DateTimeFormat(key, { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }),
      day: new Intl.DateTimeFormat(key, { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }),
    }
    FMT_CACHE.set(key, f)
  }
  return f
}

// chat-post/chat-translate 에러 코드 → i18n 키 매핑(없으면 e.message 그대로 노출)
const ERR_KEYS: Record<string, string> = {
  empty: 'chat.empty',
  too_long: 'chat.blockedLocal',
  blocked_local: 'chat.blockedLocal',
  blocked_link: 'chat.blockedLink',
  blocked_mod: 'chat.blockedMod',
  mod_unavailable: 'chat.modUnavailable',
  too_fast: 'chat.tooFast',
  rate_limited: 'chat.rateLimited',
  ip_floor: 'chat.rateLimited',
  duplicate: 'chat.duplicate',
  translate_failed: 'chat.trFailed',
}

interface Props {
  /** 방 키 — 'global'(전세계) 또는 ISO2 국가코드 */
  room?: string
}

export default function ChatBoard({ room = 'global' }: Props) {
  const { t, lang } = useT()
  const navigate = useNavigate()
  // ⚠️ 쓰기 가능 판정은 user 가 아니라 isFullUser 다.
  //    익명 세션도 user 는 truthy 라 !user 로 검사하면 입력창이 열리고, 서버(chat-post 의
  //    CHAT_REQUIRE_LOGIN)가 login_required 로 되돌려서 다 치고 나서야 실패한다.
  const { user, isFullUser } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // 번역: 토글 상태 + (글번호 → 번역문). 방이 바뀌면 재마운트되며 둘 다 초기화된다.
  const [trOn, setTrOn] = useState(false)
  const [tr, setTr] = useState<Map<number, string>>(new Map())
  const [trBusy, setTrBusy] = useState(false)
  const [reportedIds, setReportedIds] = useState<Set<number>>(new Set())
  // 신고 팝업: 대상 메시지 id · 선택한 사유 코드 · 자유 서술
  const [reportFor, setReportFor] = useState<number | null>(null)
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0].code)
  const [reportDetail, setReportDetail] = useState('')
  const [reporting, setReporting] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // 아바타를 누르면 뜨는 그 사람 카드(/ranking TOP10 클릭과 같은 카드·같은 모달).
  // 카드와 **방 손잡이는 한 상태**로 들고 다닌다 — 따로 두면 카드를 닫을 때 한쪽만 남아
  // 다음에 연 사람의 카드에 전 사람 방 링크가 붙는다.
  const [card, setCard] = useState<{ data: ShareCardData; handle: string } | null>(null)
  const cardBusy = useRef(false)

  const listRef = useRef<HTMLDivElement>(null)
  // 스크롤은 기본이 '맨 아래에 붙어 있는 것'이고, 위로 올려 옛 글을 읽는 동안만 놓아준다.
  //  ⚠️ 이 값을 폴링 tick 안에서 미리 재두면 안 된다 — 네트워크 왕복(수백 ms) 뒤에 쓰는 값이라
  //     그 사이 사용자가 움직이면 틀린 판정이 되고, 화면이 붙었다 떨어졌다 한다(2026-08-26 수정 전 증상).
  const pinnedRef = useRef(true)
  // 옛 글을 위에 붙이는 동안만 값이 있다 = '바닥에서 이만큼 떨어진 자리를 지켜라'.
  //  ⚠️ 위쪽 높이(예전의 scrollHeight 차이)로 복원하면 안 된다 — 같은 자리에 '불러오는 중' 안내 줄이
  //     떴다 사라져서, 붙일 때 한 번 지울 때 한 번 화면이 튄다. 바닥 기준은 위에서 뭘 하든 안 흔들린다.
  const keepBottomRef = useRef<number | null>(null)
  const rowsRef = useRef<Row[]>([])
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tempIdRef = useRef(-1)
  // 폴링 tick 은 [room] 으로 한 번만 묶여서 최신 state 를 못 본다 — 토글 상태를 ref 로 들고 간다.
  const trOnRef = useRef(false)
  // 재시도가 언마운트 뒤에도 계속 도는 걸 막는다(방을 옮기면 이 컴포넌트가 통째로 새로 뜬다).
  const aliveRef = useRef(true)
  // 폴링 tick 이 "아직 번역 안 온 글"을 추려내려면 지금까지 받은 번역 Map 을 봐야 한다.
  const trRef = useRef<Map<number, string>>(new Map())
  // 글마다 몇 번이나 물어봤나 — 워커가 못 하는 글(감지 실패 등)을 영원히 다시 묻지 않기 위해서다.
  const trTriesRef = useRef<Map<number, number>>(new Map())

  rowsRef.current = rows

  function showToast(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3000)
  }

  function errMsg(code: string): string {
    const key = ERR_KEYS[code]
    if (!key) return code
    const s = t(key)
    return s === key ? code : s
  }

  /**
   * 주어진 글들의 번역본을 받아 Map 에 합친다.
   *  · 대상 언어는 보내지 않는다 — 서버가 국가에서 정한다.
   *  · 서버는 창고에 있는 것부터 채우고 없는 것만 번역하므로, 두 번째 사람부터는 호출이 즉시 끝난다.
   *  · 번역이 안 온 글(엔진 실패·번역 불필요)은 Map 에 안 들어가고 화면에 원문 그대로 남는다.
   *  ⚠️ 국가 미설정이면 서버가 country_required 를 준다 → 온보딩으로 보낸다. 여기서 언어를
   *     임의로 정해주면 온보딩을 건너뛴 사람이 엉뚱한 언어로 고정된다.
   */
  const fetchTranslations = useCallback(
    async (ids: number[]): Promise<number[] | null> => {
      if (ids.length === 0) return []
      try {
        const res = await callFunction<{ lang: string; items: { id: number; body: string }[] }>(
          'chat-translate',
          { room, ids },
        )
        if (res.items.length > 0) {
          setTr((prev) => {
            const next = new Map(prev)
            for (const it of res.items) next.set(it.id, it.body)
            trRef.current = next
            return next
          })
        }
        // 안 온 id 를 돌려준다 — 재시도가 그것만 다시 묻는다.
        const got = new Set(res.items.map((it) => it.id))
        return ids.filter((id) => !got.has(id))
      } catch (e) {
        const code = e instanceof Error ? e.message : 'error'
        if (code === 'country_required') {
          navigate('/onboarding')
          return null
        }
        showToast(errMsg(code === 'error' ? 'translate_failed' : code))
        return null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room, navigate],
  )

  /**
   * 안 온 것만 몇 번 더 물어본다.
   *
   *  ⚠️ 왜 다시 묻나 — **서버가 브라우저에게 먼저 말을 걸 수 없어서**다. 어떤 (방 × 언어) 조합을
   *     처음 켜면 창고가 비어 있고, 그 요청 자체가 워커에게 "이거 채워라"는 수요 등록이 된다.
   *     워커는 우리 기계에서 1초마다 돌지만 그 결과를 브라우저로 밀어줄 길이 없다.
   *  ⚠️ 이 지연을 겪는 사람은 **(방 × 언어) 조합당 한 명**뿐이다. 그 뒤 모두는 창고 히트라 즉시다.
   *  ⚠️ Supabase Realtime 을 쓰면 밀어줄 수 있지만 **그쪽에 묶인 부품이 하나 생긴다**(Spring 이관 예정).
   *     다시 묻는 방식은 HTTP 요청일 뿐이라 백엔드를 갈아도 주소만 바뀐다.
   */
  const fetchWithRetry = useCallback(
    async (ids: number[]): Promise<number[] | null> => {
      let missing = await fetchTranslations(ids)
      for (const wait of RETRY_MS) {
        if (missing == null || missing.length === 0) break
        await new Promise((r) => window.setTimeout(r, wait))
        // 방을 옮겼거나 번역을 껐으면 그만둔다 — 전 방 결과가 새 화면에 섞이면 안 된다.
        if (!aliveRef.current || !trOnRef.current) break
        missing = await fetchTranslations(missing)
      }
      return missing
    },
    [fetchTranslations],
  )
  // ⚠️ trOnRef 는 여기서만 바꾼다(trOn 을 바꾸는 유일한 곳이라 렌더 중 대입이 필요 없다).
  //    폴링 tick 은 [room] 으로 한 번만 묶여 최신 state 를 못 보므로 ref 로 건네야 한다.
  async function toggleTranslate() {
    if (trBusy) return
    if (trOn) {
      trOnRef.current = false
      setTrOn(false)
      return
    }
    setTrBusy(true)
    // 목록은 그대로 둔 채 기다린다 — 비우면 읽던 글이 사라진다.
    const ids = rowsRef.current.filter((r) => !r.sending && r.body != null).map((r) => r.id)
    // ⚠️ 첫 조회 결과를 보기 전에 켠 것으로 표시한다 — fetchWithRetry 안의 재시도가 trOnRef 를 보고
    //    이어갈지 정하기 때문이다. 여기서 안 켜면 재시도가 첫 대기에서 바로 멈춘다.
    trOnRef.current = true
    const missing = await fetchWithRetry(ids)
    if (missing == null) {
      // 로그인·국가 문제 등 재시도해도 소용없는 실패 — 토글을 켜지 않는다.
      trOnRef.current = false
    } else {
      setTrOn(true)
    }
    setTrBusy(false)
  }

  // 언마운트되면 재시도 루프를 멈춘다.
  useEffect(() => () => { aliveRef.current = false }, [])

  // ── 스크롤 위치는 여기 한 곳이 정한다 ─────────────────────────────────────────
  // 목록 높이를 바꾸는 것 전부(새 글·보낸 글·번역문 도착·번역 토글·옛 글 붙이기·안내 줄)가
  // 이 이펙트를 지난다. 맨 아래를 보고 있었으면 다시 바닥에 붙이고, 위로 올라가 읽는 중이면 안 건드린다.
  //  ⚠️ requestAnimationFrame 으로 붙이면 안 된다 — setState 뒤 rAF 는 React 가 DOM 을 고치기 **전에**
  //     돌 수 있어서, 옛 높이 기준으로 바닥에 붙인 뒤 새 글이 그 아래에 그려진다(= 한 줄씩 어긋나 보인다).
  //     useLayoutEffect 는 DOM 이 바뀐 뒤·화면에 그려지기 전이라 어긋날 틈이 없다.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (keepBottomRef.current != null) {
      el.scrollTop = el.scrollHeight - keepBottomRef.current
      // 붙이기가 끝난 커밋(안내 줄까지 사라진 뒤)에서만 놓아준다.
      if (!loadingOlder) keepBottomRef.current = null
      return
    }
    if (pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [rows, tr, trOn, loading, loadingOlder])

  // 목록 상자 자체가 커지거나 작아질 때도 다시 붙인다(창 크기 변경 · 모바일 주소창 숨김으로 60vh 가 변할 때).
  useEffect(() => {
    const el = listRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 상대 시간이 흐르도록 30초마다 갱신(방금 전 → N분 전).
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // 시간 표시: 1분 미만=방금 전, 1시간 미만=N분 전, 당일=오후 3:12, 그 외=날짜+시각.
  function formatTime(iso: string): string {
    const diff = now - new Date(iso).getTime()
    if (diff < 60_000) return t('chat.justNow')
    if (diff < 3_600_000) return t('chat.minutesAgo', { n: String(Math.floor(diff / 60_000)) })
    const d = new Date(iso)
    const { time: kstTime, day: kstDay } = kstFmt(lang)
    return kstDay.format(d) === kstDay.format(new Date(now)) ? kstTime.format(d) : `${kstDay.format(d)} ${kstTime.format(d)}`
  }

  // 초기 PAGE 건
  useEffect(() => {
    let alive = true
    setLoading(true)
    callFunction<{ messages: Row[] }>('chat-list', { room, limit: PAGE })
      .then((res) => {
        if (!alive) return
        // 첫 화면은 바닥에서 시작한다 — 붙이는 건 위의 레이아웃 이펙트가 한다(pinned 기본값 true).
        setRows(res.messages)
        setHasMore(res.messages.length >= PAGE)
        setLoading(false)
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [room])

  // 폴링: 신규분(after) + reconcile(ids+since). 탭 비활성 시 중단, 지터 3.5~4.5s.
  useEffect(() => {
    function schedule() {
      const jitter = POLL_MIN_MS + Math.random() * (POLL_MAX_MS - POLL_MIN_MS)
      pollRef.current = setTimeout(tick, jitter)
    }
    async function tick() {
      if (document.visibilityState === 'hidden') {
        schedule()
        return
      }
      try {
        const current = rowsRef.current.filter((r) => !r.sending)
        const lastId = current.length ? current[current.length - 1].id : undefined
        // 신규분(after)과 가림·삭제 반영(ids+since)을 **한 번에** 묻는다.
        //  ⚠️ 예전엔 함수를 두 번 따로 불렀고, 그것도 첫 답을 받고서야 두 번째를 물었다 —
        //     4초 폴링이라 접속자 1명당 분당 30왕복이었다. 서버가 한 응답에 둘 다 담아준다.
        //  ⚠️ 반영 대상 id 는 **묻기 전에** 고른다. 지금 막 도착한 글은 방금 받은 최신 상태라
        //     반영할 것이 없으므로 빠져도 맞다(옛 코드도 결과적으로 그랬다).
        const visible = current.slice(-200)
        const req: Record<string, unknown> = { room }
        if (typeof lastId === 'number') req.after = lastId
        if (visible.length) {
          req.ids = visible.map((r) => r.id)
          req.since = visible.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), '1970-01-01T00:00:00Z')
        }
        // 아직 아무것도 안 띄운 상태(첫 로드 전)면 물어볼 것이 없다.
        if (req.after === undefined && req.ids === undefined) {
          schedule()
          return
        }
        const res = await callFunction<{ messages?: Row[]; tombstones?: Tomb[] }>('chat-list', req)
        const incoming = res.messages ?? []
        if (incoming.length) {
          setRows((prev) => {
            const seen = new Set(prev.map((r) => r.id))
            const next = [...prev, ...incoming.filter((r) => !seen.has(r.id))]
            // 창 접기는 **맨 아래를 보고 있을 때만** — 위로 올라가 읽는 중이면 그 순간 화면이 통째로 밀린다.
            //  ⚠️ 판정은 응답을 받은 지금 다시 본다(요청 전에 재둔 값은 이미 낡았다).
            return pinnedRef.current && next.length > MAX_ROWS ? next.slice(-MAX_ROWS) : next
          })
          // 스크롤은 레이아웃 이펙트가 붙인다(여기서 따로 안 만진다).
        }
        // 번역을 켜둔 동안은 **아직 못 받은 글을 계속 채운다**(새 글 + 워커가 늦게 채운 옛 글).
        //  ⚠️ 이게 없으면 첫 재시도(1.5·3초) 안에 워커가 못 끝낸 글이 영영 원문으로 남는다 —
        //     사용자가 토글을 껐다 켜야 나오던 버그(2026-08-13). 30건이면 워커가 몇 초 더 걸린다.
        //  ⚠️ 시도 횟수를 세서 끊는다. 워커가 못 하는 글(원문 언어 판정 실패 등)은 영영 안 오는데
        //     안 끊으면 4초마다 그 목록을 계속 다시 묻는다.
        if (trOnRef.current) {
          const want = rowsRef.current
            .filter((r) => !r.sending && r.body != null && !trRef.current.has(r.id))
            .filter((r) => (trTriesRef.current.get(r.id) ?? 0) < TR_MAX_TRIES)
            .map((r) => r.id)
          if (want.length) {
            for (const id of want) trTriesRef.current.set(id, (trTriesRef.current.get(id) ?? 0) + 1)
            void fetchTranslations(want)
          }
        }
        // 가림·삭제 반영 — 위 한 번의 응답에 같이 실려 온 것이다(따로 묻지 않는다).
        if (res.tombstones?.length) {
          const byId = new Map(res.tombstones.map((tm) => [tm.id, tm]))
          setRows((prev) =>
            prev.map((r) => {
              const tm = byId.get(r.id)
              if (!tm) return r
              if (tm.deleted_at != null) {
                return { ...r, body: null, deleted_at: tm.deleted_at, edited_at: tm.edited_at, mod_status: tm.mod_status, updated_at: tm.updated_at }
              }
              return { ...r, body: tm.body, edited_at: tm.edited_at, mod_status: tm.mod_status, updated_at: tm.updated_at }
            }),
          )
        }
      } catch {
        /* noop — 다음 tick 에 재시도 */
      }
      schedule()
    }
    schedule()
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [room, fetchTranslations])

  // 위로 스크롤 시 이전 페이지 prepend(스크롤 위치 보존)
  const loadOlder = useCallback(async () => {
    if (loadingOlder || loading || !hasMore || rows.length === 0) return
    // 최신 MAX_ROWS 개가 이 방에서 볼 수 있는 전부다 — 그 위로는 더 안 불러온다.
    if (rows.length >= MAX_ROWS) {
      setHasMore(false)
      return
    }
    const take = Math.min(PAGE, MAX_ROWS - rows.length)
    const oldestId = rows[0].id
    const el = listRef.current
    // 보고 있던 자리를 '바닥에서의 거리'로 적어둔다 — 위에 안내 줄이 떴다 사라지고 옛 글이 붙어도
    // 이 값은 안 흔들린다. 실제 복원은 레이아웃 이펙트가 한다.
    if (el) keepBottomRef.current = el.scrollHeight - el.scrollTop
    setLoadingOlder(true)
    try {
      const res = await callFunction<{ messages: Row[] }>('chat-list', { room, before: oldestId, limit: take })
      if (res.messages.length) {
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id))
          return [...res.messages.filter((r) => !seen.has(r.id)), ...prev]
        })
        setHasMore(res.messages.length >= take && rows.length + res.messages.length < MAX_ROWS)
        // 위로 불러온 옛 글도 켜져 있으면 같이 번역한다.
        // 위로 불러온 옛 글은 따로 안 부른다 — 위 폴링이 "못 받은 것 전부"를 채우므로 곧 따라온다.
      } else {
        setHasMore(false)
      }
    } catch {
      /* noop */
    }
    setLoadingOlder(false)
  }, [loadingOlder, loading, hasMore, rows, room])

  // 스크롤할 때마다 '지금 맨 아래를 보고 있나'를 다시 잰다 — 새 글을 따라갈지 말지의 유일한 기준이다.
  //  ⚠️ 우리가 코드로 바닥에 붙일 때도 이 핸들러가 돌아 pinned 가 true 로 유지된다(그게 맞다).
  function onScroll() {
    const el = listRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_GAP
    if (el.scrollTop < 60) loadOlder()
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending || !user || !isFullUser) return
    if (text.length > MAX_LEN) {
      showToast(errMsg('too_long'))
      return
    }
    setSending(true)
    setInput('')
    const tempId = tempIdRef.current--
    const tempRow: Row = {
      id: tempId,
      user_id: user.id,
      display_name: t('chat.sending'),
      is_anon: !!user.is_anonymous,
      body: text,
      mod_status: 'ok',
      edited_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sending: true,
    }
    // 내가 보낸 글은 위로 올라가 읽던 중이었어도 바닥으로 데려간다 — 방금 쓴 글이 안 보이면 실패로 읽힌다.
    pinnedRef.current = true
    keepBottomRef.current = null
    setRows((prev) => [...prev, tempRow])
    try {
      const res = await callFunction<{ id: number; created_at: string; updated_at: string; display_name: string; is_anon: boolean; mod_status: 'ok' | 'pending' }>('chat-post', { room, body: text })
      setRows((prev) => {
        const withoutTemp = prev.filter((r) => r.id !== tempId)
        if (withoutTemp.some((r) => r.id === res.id)) return withoutTemp
        return [
          ...withoutTemp,
          {
            id: res.id,
            user_id: user.id,
            display_name: res.display_name,
            is_anon: res.is_anon,
            body: text,
            mod_status: res.mod_status,
            edited_at: null,
            created_at: res.created_at,
            updated_at: res.updated_at,
          },
        ]
      })
    } catch (e) {
      setRows((prev) => prev.filter((r) => r.id !== tempId))
      setInput(text)
      showToast(errMsg(e instanceof Error ? e.message : 'error'))
    }
    setSending(false)
  }

  // 아바타 탭 → 그 사람 카드. 카드에 필요한 값(순위·백분위·시즌점수)이 채팅 행엔 없어서 한 번 조회한다.
  //   ⚠️ 누르는 건 **아바타뿐**이다. 말풍선 전체를 누르게 하면 관성 스크롤을 멈추려고 톡 친 손가락에
  //      모달이 열린다(작은 원이라 거기 정확히 떨어질 일이 드물다).
  //   ⚠️ 익명 글은 아예 대상이 아니다 — 익명으로 쓴 글에서 실명 카드가 나오면 익명성이 깨진다.
  //      (서버도 같은 판단: scoped_top 이 익명 계정을 제외해서 user:null 로 되돌린다. 이중 방어)
  //      익명 글엔 user_id 자체가 안 내려오므로 그것도 같이 막는다(삼중).
  async function openCard(r: Row) {
    if (r.is_anon || !r.user_id || r.sending || cardBusy.current) return
    const uid = r.user_id
    cardBusy.current = true
    try {
      const res = await callFunction<{
        user: {
          rank: number; name: string; rating: number; color: string | null; image: string | null; percentile: number | null
          // 장착한 캐릭터·스킨(2026-08-20) — 카드 좌 패널이 그 사람의 배경 + 캐릭터가 된다.
          character: string | null; skin: string | null
        } | null
        total: number
      }>('leaderboard', { scope: 'user', uid })
      if (!res.user) {
        showToast(t('chat.noCard'))
        return
      }
      const u = res.user
      // 국가·지역 순위·이름 — 랭킹 화면과 **같은 헬퍼**를 쓴다(각자 조립하면 두 화면의 카드가 갈린다).
      //   못 받으면 그 칸만 '—' 로 나간다. 카드 자체는 뜬다.
      let scoped: CardScoped | null = null
      try { scoped = await scopedForCard(uid, lang) } catch { scoped = null }
      setCard({ handle: uid, data: {
        lang,
        name: u.name,
        // 카드 아바타는 서버가 준 원본 문자열을 다시 조립해 쓴다(채팅 행의 avatar_url 과 같은 형식).
        avatarUrl: u.image ? `img:${u.image}` : u.color ? `gem:${u.color}` : (r.avatar_url ?? null),
        seed: uid,
        percentile: u.percentile,
        rank: u.rank,
        rankTotal: res.total,
        // 국가·지역 순위·이름은 남의 카드에도 그린다(2026-08-21). 가입일·초대코드는 계속 안 그린다(publicOnly).
        countryRank: scoped?.countryRank ?? null, countryTotal: scoped?.countryTotal ?? null,
        regionRank: scoped?.regionRank ?? null, regionTotal: scoped?.regionTotal ?? null,
        country: scoped?.country ?? null, region: scoped?.region ?? null,
        seasonTotal: u.rating,
        joinedAt: null, referralCode: null,
        publicOnly: true,
        character: u.character, skin: u.skin,
        // 레벨은 시즌 총점에서 파생한다(허브·랭킹과 같은 함수) — 서버가 따로 내려주지 않는다.
        charLevel: arenaLevelForScore(u.rating),
      } })
    } catch {
      showToast(t('chat.noCard'))
    } finally {
      cardBusy.current = false
    }
  }

  // 신고 버튼 = 팝업 열기. 실제 전송은 사유를 고른 뒤 submitReport 에서.
  function openReport(id: number) {
    if (reportedIds.has(id)) return
    setReportFor(id)
    setReportReason(REPORT_REASONS[0].code)
    setReportDetail('')
  }

  async function submitReport() {
    const id = reportFor
    if (id == null || reporting) return
    setReporting(true)
    // 사유 코드 + 자유 서술을 한 문자열로(서버가 500자까지 저장). 코드가 앞에 와야 관리자가 훑기 쉽다.
    const detail = reportDetail.trim()
    const reason = detail ? `${reportReason}: ${detail}` : reportReason
    try {
      await callFunction('chat-report', { message_id: id, reason })
      setReportedIds((prev) => new Set(prev).add(id))
      showToast(t('chat.reported'))
      setReportFor(null)
    } catch (e) {
      if (e instanceof Error && e.message === 'duplicate') {
        setReportedIds((prev) => new Set(prev).add(id))
        showToast(t('chat.reported'))
        setReportFor(null)
      } else {
        showToast(errMsg(e instanceof Error ? e.message : 'error'))
      }
    }
    setReporting(false)
  }

  // ⚠️ 수정·삭제는 없다(2026-08-13 제거). 수정이 있으면 욕설을 쓰고 신고당한 뒤 10분 안에
  //    본문을 고쳐 증거를 지울 수 있었다(chat-edit 이 body 를 덮어썼다). 삭제는 소프트라
  //    본문이 남아 안전했지만, 수정을 없애는 김에 같이 걷어냈다.

  return (
    <div className="chat-panel">
      {/* 번역 토글 — 로그인한 사람에게만. 방을 옮기면 재마운트되어 꺼진 채로 다시 시작한다. */}
      {isFullUser && (
        <div className="chat-trbar">
          <button
            type="button"
            className={`chat-tr-btn${trOn ? ' on' : ''}`}
            onClick={toggleTranslate}
            disabled={trBusy}
            aria-pressed={trOn}
          >
            {trBusy ? t('chat.trLoading') : trOn ? t('chat.trOn') : t('chat.trOff')}
          </button>
        </div>
      )}
      <div ref={listRef} onScroll={onScroll} className="chat-list">
        {loading && <div className="chat-hint">{t('common.loading')}</div>}
        {!loading && loadingOlder && <div className="chat-hint">{t('common.loading')}</div>}
        {!loading && rows.length === 0 && <div className="chat-hint">{t('chat.empty')}</div>}
        {!loading &&
          rows.map((r) => {
            const own = !!user && isFullUser && r.user_id === user.id
            const deleted = r.body === null
            // 번역이 없는 글(내 언어로 쓴 글·엔진 실패·너무 짧은 글)은 원문 그대로 둔다.
            const shown = trOn ? tr.get(r.id) : undefined
            return (
              <div key={r.id} className={`chat-bubble-row ${own ? 'own' : 'other'}`}>
                <div className="chat-bubble">
                  {!own && (
                    <div className="chat-meta">
                      {/* 익명 글은 고정 시드 — user_id 를 시드로 쓰면 같은 사람의 익명 글이
                          늘 같은 색으로 나와 서로 이어붙일 수 있다(익명성 훼손).
                          같은 이유로 익명 글의 아바타는 누를 수 없다(카드 = 실명 정보). */}
                      {r.is_anon ? (
                        <span className="chat-avatar">
                          <Avatar avatarUrl={r.avatar_url} seed="anon" size={20} />
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="chat-avatar chat-avatar-btn"
                          onClick={() => openCard(r)}
                          aria-label={t('chat.cardOf', { name: r.display_name })}
                        >
                          <Avatar avatarUrl={r.avatar_url} seed={r.user_id ?? undefined} size={20} />
                        </button>
                      )}
                      <span className="chat-name">{r.display_name}</span>
                      {flagUrl(r.country_code) && (
                        <img
                          className="chat-flag"
                          src={flagUrl(r.country_code)}
                          alt={countryName(r.country_code as string, lang)}
                          title={countryName(r.country_code as string, lang)}
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                      {r.is_anon && <span className="chat-anon-badge">{t('chat.anonBadge')}</span>}
                    </div>
                  )}
                  <div className="chat-body">
                    {deleted ? t('chat.deleted') : linkify(shown ?? r.body ?? '')}
                    {r.sending && <span className="chat-sending-tag"> · {t('chat.sending')}</span>}
                  </div>
                  <div className="chat-footer">
                    <span className="chat-time">{formatTime(r.created_at)}</span>
                    {shown && !deleted && <span className="chat-tr-mark">· {t('chat.trMark')}</span>}
                    {!r.sending && !deleted && !own && (
                      <button type="button" className="chat-action" disabled={reportedIds.has(r.id)} onClick={() => openReport(r.id)}>
                        {reportedIds.has(r.id) ? t('chat.reported') : t('chat.report')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
      </div>

      {toast && <div className="chat-toast">{toast}</div>}

      {/* 남의 카드라 보기 전용(저장·공유 버튼 없음) — /ranking TOP10 클릭과 같은 취급. */}
      {card && (
        <ShareCardModal
          data={card.data}
          title={t('chat.cardOf', { name: card.data.name })}
          readOnly
          roomHandle={card.handle}
          onClose={() => setCard(null)}
        />
      )}

      {/* 사기 경고 — 입력창 바로 위 고정. 목록 안에 두면 대화가 쌓이는 순간 위로 밀려
          사라지는데, 이 문구가 필요한 시점이 정확히 "누가 뭘 요구해서 답을 치려는 때"다. */}
      <p className="chat-scam-note">{t('chat.scamNotice')}</p>

      {!isFullUser ? (
        <div className="chat-login-cta">
          <span>{t('chat.loginToJoin')}</span>
          {/* /login 은 구글·카카오 둘 다 있는 화면이라 '구글로 로그인' 이 아니라 '로그인' 이다. */}
          <Link to="/login" className="chat-login-btn">{t('common.login')}</Link>
        </div>
      ) : (
        <form className="chat-composer" onSubmit={onSend}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('chat.placeholder')}
            maxLength={MAX_LEN}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !input.trim()}>
            {sending ? t('chat.sending') : t('chat.send')}
          </button>
        </form>
      )}

      {reportFor != null && (
        // 배경 클릭으로 닫기. 모달 안쪽 클릭은 stopPropagation 으로 새어나가지 않게 한다.
        <div className="chat-report-overlay" onClick={() => !reporting && setReportFor(null)}>
          <div className="chat-report-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{t('chat.reportTitle')}</h3>
            <div className="chat-report-reasons">
              {REPORT_REASONS.map((r) => (
                <label key={r.code}>
                  <input
                    type="radio"
                    name="chat-report-reason"
                    value={r.code}
                    checked={reportReason === r.code}
                    onChange={() => setReportReason(r.code)}
                  />
                  {t(r.key)}
                </label>
              ))}
            </div>
            <textarea
              value={reportDetail}
              onChange={(e) => setReportDetail(e.target.value)}
              placeholder={t('chat.reportDetail')}
              maxLength={400}
              rows={2}
            />
            <div className="chat-report-actions">
              <button type="button" onClick={() => setReportFor(null)} disabled={reporting}>
                {t('common.cancel')}
              </button>
              <button type="button" className="primary" onClick={submitReport} disabled={reporting}>
                {t('chat.reportSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
