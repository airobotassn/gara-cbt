import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useT, localeOf, type Lang } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { linkify } from '../lib/linkify'
import { Avatar } from './GemAvatar'
import { countryName, flagUrl } from '../lib/regions'
import ShareCardModal from './ShareCardModal'
import type { ShareCardData } from '../lib/shareCard'

// 유사채팅(pseudo-chat) 보드 — 로그인 필요(작성), 조회는 공개. /arena 페이지 안의 섹션으로 렌더된다.
// 초기 페이지 → 폴링(신규분 append) + reconcile(가림/삭제 tombstone) + 위로 스크롤 시 이전 페이지(prepend).
// 본문은 항상 React 텍스트 child 로만 렌더(자동 이스케이프) — URL 만 NoticeDetail.linkify 방식으로 링크화.
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
  user_id: string
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

const MAX_LEN = 500
const POLL_MIN_MS = 3500
const POLL_MAX_MS = 4500

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
  const rowsRef = useRef<Row[]>([])
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tempIdRef = useRef(-1)
  // 폴링 tick 은 [room] 으로 한 번만 묶여서 최신 state 를 못 본다 — 토글 상태를 ref 로 들고 간다.
  const trOnRef = useRef(false)

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
    async (ids: number[]): Promise<boolean> => {
      if (ids.length === 0) return true
      try {
        const res = await callFunction<{ lang: string; items: { id: number; body: string }[] }>(
          'chat-translate',
          { room, ids },
        )
        if (res.items.length > 0) {
          setTr((prev) => {
            const next = new Map(prev)
            for (const it of res.items) next.set(it.id, it.body)
            return next
          })
        }
        return true
      } catch (e) {
        const code = e instanceof Error ? e.message : 'error'
        if (code === 'country_required') {
          navigate('/onboarding')
          return false
        }
        showToast(errMsg(code === 'error' ? 'translate_failed' : code))
        return false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room, navigate],
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
    const ok = await fetchTranslations(ids)
    if (ok) {
      trOnRef.current = true
      setTrOn(true)
    }
    setTrBusy(false)
  }

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

  // 초기 30건
  useEffect(() => {
    let alive = true
    setLoading(true)
    callFunction<{ messages: Row[] }>('chat-list', { room, limit: 30 })
      .then((res) => {
        if (!alive) return
        setRows(res.messages)
        setHasMore(res.messages.length >= 30)
        setLoading(false)
        requestAnimationFrame(() => {
          const el = listRef.current
          if (el) el.scrollTop = el.scrollHeight
        })
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
        if (typeof lastId === 'number') {
          const el = listRef.current
          const atBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true
          const res = await callFunction<{ messages: Row[] }>('chat-list', { room, after: lastId })
          if (res.messages.length) {
            setRows((prev) => {
              const seen = new Set(prev.map((r) => r.id))
              return [...prev, ...res.messages.filter((r) => !seen.has(r.id))]
            })
            requestAnimationFrame(() => {
              if (atBottom && el) el.scrollTop = el.scrollHeight
            })
            // 번역을 켜둔 상태면 새 글도 이어서 번역한다. 워커가 이미 채워놨으면 창고 히트라 즉시 온다.
            if (trOnRef.current) void fetchTranslations(res.messages.map((m) => m.id))
          }
        }
        const visible = rowsRef.current.filter((r) => !r.sending).slice(-200)
        if (visible.length) {
          const ids = visible.map((r) => r.id)
          const since = visible.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), '1970-01-01T00:00:00Z')
          const rec = await callFunction<{ tombstones?: Tomb[] }>('chat-list', { room, ids, since })
          if (rec.tombstones?.length) {
            const byId = new Map(rec.tombstones.map((tm) => [tm.id, tm]))
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
    const oldestId = rows[0].id
    const el = listRef.current
    const prevHeight = el?.scrollHeight ?? 0
    setLoadingOlder(true)
    try {
      const res = await callFunction<{ messages: Row[] }>('chat-list', { room, before: oldestId, limit: 30 })
      if (res.messages.length) {
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id))
          return [...res.messages.filter((r) => !seen.has(r.id)), ...prev]
        })
        setHasMore(res.messages.length >= 30)
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight
        })
        // 위로 불러온 옛 글도 켜져 있으면 같이 번역한다.
        if (trOnRef.current) void fetchTranslations(res.messages.map((m) => m.id))
      } else {
        setHasMore(false)
      }
    } catch {
      /* noop */
    }
    setLoadingOlder(false)
  }, [loadingOlder, loading, hasMore, rows, room, fetchTranslations])

  function onScroll() {
    const el = listRef.current
    if (el && el.scrollTop < 60) loadOlder()
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
    const el = listRef.current
    const atBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true
    setRows((prev) => [...prev, tempRow])
    requestAnimationFrame(() => {
      if (atBottom && el) el.scrollTop = el.scrollHeight
    })
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
  async function openCard(r: Row) {
    if (r.is_anon || r.sending || cardBusy.current) return
    cardBusy.current = true
    try {
      const res = await callFunction<{
        user: { rank: number; name: string; rating: number; color: string | null; image: string | null; percentile: number | null } | null
        total: number
      }>('leaderboard', { scope: 'user', uid: r.user_id })
      if (!res.user) {
        showToast(t('chat.noCard'))
        return
      }
      const u = res.user
      setCard({ handle: r.user_id, data: {
        lang,
        name: u.name,
        // 카드 아바타는 서버가 준 원본 문자열을 다시 조립해 쓴다(채팅 행의 avatar_url 과 같은 형식).
        avatarUrl: u.image ? `img:${u.image}` : u.color ? `gem:${u.color}` : (r.avatar_url ?? null),
        seed: r.user_id,
        percentile: u.percentile,
        rank: u.rank,
        rankTotal: res.total,
        // 남의 카드라 국가·지역 순위, 가입일, 초대코드는 안 그린다(publicOnly).
        countryRank: null, countryTotal: null, regionRank: null, regionTotal: null,
        seasonTotal: u.rating,
        joinedAt: null, country: null, region: null, referralCode: null,
        publicOnly: true,
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
                          <Avatar avatarUrl={r.avatar_url} seed={r.user_id} size={20} />
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

      {!isFullUser ? (
        <div className="chat-login-cta">
          <span>{t('chat.loginToJoin')}</span>
          <Link to="/login" className="chat-login-btn">{t('common.login_google')}</Link>
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
