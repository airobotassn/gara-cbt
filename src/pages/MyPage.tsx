import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction, supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import SiteFooter from '../components/SiteFooter'
import type { EbookListResp, EbookRow, MyAttempt, MyAttemptsResponse } from '../lib/types'
import LearningDashboard from '../components/LearningDashboard'
import EbookCover from '../components/EbookCover'
import InquiryBoard from '../components/InquiryBoard'
import { certNoPending, gradeOfTitle, gradeDisplay, certExpiryDate } from '../lib/certNo'
import { countryName } from '../lib/regions'
import { NICK_MAX, NICK_MIN, nicknameError } from '../lib/nickname'
import { usd } from '../lib/money'
import {
  examDateText,
  ticketReasonText,
  ticketSourceKey,
  ticketStatusKey,
  tierDisplay,
  type ExamTicketView,
} from '../lib/tickets'
import type { Lang, TFunc } from '../lib/i18n'

// gara_5 (마이페이지) 목업 디자인 그대로 + 실제 응시 데이터·탭·발급·로그인 게이트 로직 보존.
// 원본: stitch_design_critique_assistant/gara_5/code.html
// primary 는 전역 토큰 사용(라이트 #004ac6 / 다크 #7aa9ff) — 페이지별 오버라이드 제거.

// 탭 순서 = 화면에 보이는 순서. 첫 탭(학습 대시보드)이 /mypage 기본 화면이다.
//   ⚠️ '시험 응시 현황'은 예전 기본 탭이라 /mypage 였는데, 기본이 대시보드로 바뀌며 /mypage/attempts 로 이동했다.
const TABS = [
  { key: 'learning', labelKey: 'mypage.tab_learning', to: '/mypage' },
  { key: 'ebooks', labelKey: 'mypage.tab_ebooks', to: '/mypage/ebooks' },
  { key: 'attempts', labelKey: 'mypage.tab_attempts', to: '/mypage/attempts' },
  { key: 'earned', labelKey: 'mypage.tab_earned', to: '/mypage/earned' },
  { key: 'issuance', labelKey: 'mypage.tab_issuance', to: '/mypage/issuance' },
  { key: 'inquiry', labelKey: 'mypage.tab_inquiry', to: '/mypage/inquiry' },
]

function fmtDT(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
}
function daysLeft(iso?: string | null) {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}
/**
 * 아직 발급하지 않은 응시의 자격번호 표기 — 일련번호 자리를 가린 형태(`CA-PRO-2026-••••••`).
 * 진짜 번호는 발급 순간 서버가 채번하므로(certNo.ts 주석 참고) 그 전에는 만들어 보여주지 않는다.
 * 발급된 건은 호출부가 `a.certNo`(서버 확정값)를 먼저 쓴다.
 */
function certNoOf(a: MyAttempt) {
  const year = (a.submittedAt ? new Date(a.submittedAt).getFullYear() : 0) || new Date().getFullYear()
  return certNoPending(gradeOfTitle(a.examTitle), year)
}

// 상태 → 카드 비주얼
function statusInfo(a: MyAttempt) {
  if (a.status === 'expired' || a.status === 'voided') {
    return { icon: 'event_busy', wrap: 'bg-outline/10 border-outline/20', color: 'text-outline', badge: a.status === 'voided' ? 'Voided' : 'Expired', badgeClass: 'bg-error/10 text-error border-error/20', greyed: true }
  }
  if (a.status === 'submitted' && a.released) {
    return { icon: 'task', wrap: 'bg-secondary/10 border-secondary/20', color: 'text-secondary', badge: 'Completed', badgeClass: 'bg-secondary/10 text-secondary border-secondary/20', greyed: false }
  }
  return { icon: 'description', wrap: 'bg-primary/10 border-primary/20', color: 'text-primary', badge: a.status === 'in_progress' ? 'In progress' : 'Scoring', badgeClass: 'bg-primary/10 text-primary border-primary/20', greyed: false }
}

// 내 정보 — 국가/지역(읽기전용, 락).
//   ⚠️ 학교(school_id) 입력 UI 는 제거됨(2026-07-28). DB 컬럼·schools 테이블·school_leaderboard RPC 는 남아있고,
//      랭킹의 학교 탭도 숨김 상태(Ranking.tsx) — 되살리려면 이 섹션에 자동완성 입력을 다시 붙이면 된다.
function ProfileSection() {
  const { user } = useAuth()
  const { t, lang } = useT()
  const [profile, setProfile] = useState<{
    country_code: string | null
    region_code: string | null
    display_name: string | null
    nickname_changed_at: string | null
  } | null>(null)
  // 닉네임 변경 — 평생 1회. 서버(set-nickname)가 최종 판정하고 여기선 UI 상태만 잡는다.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [nickErr, setNickErr] = useState('')

  // 프로필(국가/지역/닉네임) 로딩
  useEffect(() => {
    if (!user) return
    let alive = true
    supabase
      .from('profiles')
      .select('country_code,region_code,display_name,nickname_changed_at')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setProfile(data ?? null)
      })
    return () => {
      alive = false
    }
  }, [user?.id])

  const countryLabel = profile?.country_code ? countryName(profile.country_code, lang) : '-'
  const regionLabel = profile?.region_code ? t(`region.${profile.region_code}`) : '-'
  const nickUsed = !!profile?.nickname_changed_at // 변경권 소진

  async function saveNick() {
    const v = draft.trim()
    if (saving || nicknameError(v)) return
    setSaving(true)
    setNickErr('')
    try {
      await callFunction('set-nickname', { nickname: v })
      setProfile((p) => (p ? { ...p, display_name: v, nickname_changed_at: new Date().toISOString() } : p))
      setEditing(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const code = /taken/.test(msg) ? 'taken' : /reserved/.test(msg) ? 'reserved' : /locked/.test(msg) ? 'locked' : 'failed'
      setNickErr(t(`nick.err_${code}`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 ambient-shadow mb-8 md:mb-10">
      <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-5">{t('mypage.profile_title')}</h2>

      {/* 닉네임 — 유일한 변경 진입점(FAB 편집은 제거됨). 변경권 1회를 다 쓰면 잠긴다. */}
      <div className="mb-4">
        <label className="block font-label-md text-[13px] font-semibold text-outline mb-1.5">{t('nick.label')}</label>
        {editing ? (
          <>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl bg-surface border border-outline-variant px-4 py-3 font-body-md text-on-surface"
                value={draft}
                autoFocus
                maxLength={NICK_MAX}
                disabled={saving}
                onChange={(e) => { setDraft(e.target.value); setNickErr('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') saveNick(); if (e.key === 'Escape') setEditing(false) }}
              />
              <button
                onClick={saveNick}
                disabled={saving || !!nicknameError(draft)}
                className="px-5 py-3 rounded-xl bg-primary-container text-on-primary font-label-md text-[15px] font-bold disabled:opacity-40"
              >
                {saving ? t('nick.saving') : t('nick.confirm')}
              </button>
              <button
                onClick={() => { setEditing(false); setNickErr('') }}
                className="px-4 py-3 rounded-xl border border-outline-variant text-on-surface-variant font-label-md text-[15px] font-bold"
              >
                {t('intro.cancel')}
              </button>
            </div>
            <p className="mt-2 font-body-sm text-[13px] text-outline break-keep">{t('nick.rule', { min: NICK_MIN, max: NICK_MAX })}</p>
            <p className="mt-1 font-body-sm text-[13px] text-error font-bold break-keep">{t('nick.last_chance')}</p>
            {(nickErr || (draft && nicknameError(draft))) && (
              <p className="mt-1 font-body-sm text-[13px] text-error break-keep">
                {nickErr || t(`nick.err_${nicknameError(draft)}`)}
              </p>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[160px] rounded-xl bg-surface-container-low border border-outline-variant/40 px-4 py-3 font-body-md text-on-surface">
              {profile?.display_name || '-'}
            </div>
            {nickUsed ? (
              <span className="font-body-sm text-[13px] text-outline flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">lock</span>
                {t('nick.used_up')}
              </span>
            ) : (
              <button
                onClick={() => { setDraft(profile?.display_name ?? ''); setEditing(true) }}
                className="px-5 py-3 rounded-xl border border-outline-variant text-on-surface font-label-md text-[15px] font-bold hover:border-primary hover:text-primary transition-colors"
              >
                {t('nick.change_once')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2">
        {/* 국가 (읽기전용) */}
        <div>
          <label className="block font-label-md text-[13px] font-semibold text-outline mb-1.5">{t('onboarding.country')}</label>
          <div className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-4 py-3 font-body-md text-on-surface-variant select-none cursor-not-allowed">{countryLabel}</div>
        </div>
        {/* 지역 (읽기전용) */}
        <div>
          <label className="block font-label-md text-[13px] font-semibold text-outline mb-1.5">{t('onboarding.region')}</label>
          <div className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-4 py-3 font-body-md text-on-surface-variant select-none cursor-not-allowed">{regionLabel}</div>
        </div>
      </div>
      <p className="font-body-sm text-[13px] text-outline flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[16px]">lock</span>
        {t('mypage.region_locked')}
      </p>
    </section>
  )
}

// 보유 응시권 한 장.
//   ⚠️ 응시 카드(아래 attempts)와 **같은 급의 크기**로 만든다. "장수가 늘어날 테니 작게" 는 금지 —
//      개수는 스크롤이 푸는 문제다(2026-08-06 반려 사유 두 건이 정확히 이거다). 11~13px 잔글씨도 금지.
//   ⚠️ 쓸 수 있는지(usable)와 그 이유는 **서버 판정을 그대로 표시만** 한다. 시험일을 브라우저에서 다시
//      비교하면 KST 기준 판정과 최대 9시간 어긋난다(lib/tickets.ts 머리 주석 참고).
function TicketCard({ tk, t, lang, onGo, onCheck }: {
  tk: ExamTicketView; t: TFunc; lang: Lang; onGo: () => void; onCheck: () => void
}) {
  const dead = tk.status === 'void' || tk.status === 'expired'
  const statusKey = ticketStatusKey(tk.status)
  const sourceKey = ticketSourceKey(tk.source)
  const reason = ticketReasonText(tk, t, lang)
  // 진행 중인 응시도 버튼을 남긴다 — 돌아갈 길이 화면에 없으면 사용자가 갇힌다(서버는 새 응시를 막을 뿐이다).
  const canGo = tk.usable || tk.usableReason === 'in_progress'

  return (
    <article
      className={`bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 ${dead ? 'opacity-75' : ''}`}
    >
      <div className="flex items-start gap-5 flex-1">
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 border ${dead ? 'bg-outline/10 border-outline/20' : 'bg-primary/10 border-primary/20'}`}>
          <span className={`material-symbols-outlined text-[28px] ${dead ? 'text-outline' : 'text-primary'}`} style={{ fontVariationSettings: "'FILL' 1" }}>confirmation_number</span>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
            <h3 className={`font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold break-keep ${dead ? 'text-on-surface-variant' : 'text-on-surface'}`}>
              {tierDisplay(tk.tier, lang)}
            </h3>
            {/* 상태 배지만 11px 이다 — 바로 아래 응시 카드의 배지와 **같은 값**이어야 한 화면으로 읽힌다.
                본문·보조 문구는 전부 body-md(15~16px)로 유지(잔글씨 반려 이력, CLAUDE.md 2026-08-06). */}
            <span className={`px-3 py-1 font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border shrink-0 ${dead ? 'bg-outline/10 text-outline border-outline/20' : 'bg-primary/10 text-primary border-primary/20'}`}>
              {statusKey ? t(statusKey) : tk.status}
            </span>
            {sourceKey && (
              <span className="px-3 py-1 bg-tertiary/10 text-tertiary border border-tertiary/20 font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full shrink-0">
                {t(sourceKey)}
              </span>
            )}
          </div>
          {/* 회차명은 그 자체가 '무슨 회차'라 라벨(ticket.round)을 앞에 또 붙이지 않는다.
              시험일 라벨은 일정 화면과 같은 말이어야 해서 기존 sched.exam_date 를 그대로 쓴다. */}
          <p className="font-body-md text-body-md text-on-surface-variant mb-1">
            {tk.roundTitle} | {t('sched.exam_date')} {examDateText(tk.examDate, lang)}
          </p>
          <p className="font-body-md text-body-md text-on-surface-variant mb-3">
            {t('ticket.issued_at')} {fmtDate(tk.issuedAt)}
            {/* 관리자·무료 발급분은 0원이라 금액 자리를 통째로 비운다 — `$0` 은 '무료로 팔았다'로 읽힌다.
                ⚠️ pricePaid 는 원화 스냅샷이다. 표시만 달러로 환산한다(실제 청구액 고지는 결제 화면 소관). */}
            {tk.pricePaid > 0 ? ` | ${t('ticket.price_paid')} ${usd(tk.pricePaid, lang)}` : ''}
          </p>
          {reason && (
            tk.usable ? (
              <p className="font-label-md text-[15px] leading-[22px] text-primary font-semibold flex items-center gap-1.5 bg-primary/5 px-3 py-1.5 rounded-lg w-fit">
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                {reason}
              </p>
            ) : (
              <p className="font-body-md text-body-md text-outline break-keep">{reason}</p>
            )
          )}
        </div>
      </div>
      {canGo && (
        <div className="shrink-0 flex flex-col items-stretch gap-2">
          {/* ⛔ 시험환경 점검을 마치기 전에는 응시 버튼을 열지 않는다.
              잠금 브라우저가 안 켜지는 PC 라는 걸 시험 당일에 알면 손쓸 방법이 없다. */}
          <button
            onClick={onCheck}
            className={`px-6 py-2.5 font-label-md text-[15px] font-bold rounded-xl transition-colors flex items-center justify-center gap-2 border ${
              tk.envChecked
                ? 'border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'
                : 'bg-primary-container text-on-primary border-transparent ambient-shadow hover:bg-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{tk.envChecked ? 'check_circle' : 'monitor_heart'}</span>
            {t(tk.envChecked ? 'ticket.env_done' : 'ticket.env_do')}
          </button>
          <button
            onClick={onGo}
            disabled={!tk.envChecked}
            className={`px-6 py-2.5 font-label-md text-[15px] font-bold rounded-xl transition-colors flex items-center justify-center gap-2 ${
              tk.envChecked
                ? 'bg-primary-container text-on-primary hover:bg-primary ambient-shadow'
                : 'bg-outline/15 text-outline cursor-not-allowed'
            }`}
          >
            {t('ticket.go_exam')}
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
          {!tk.envChecked && (
            <p className="font-body-md text-[13px] text-outline text-center max-w-[220px] break-keep">{t('ticket.env_required')}</p>
          )}
        </div>
      )}
    </article>
  )
}

// 이북 서재 — 구매한 이북만 보인다(구매는 /ebooks 스토어에서). 읽기는 뷰어(/ebooks/read/:id).
function EbookLibrary() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const [rows, setRows] = useState<EbookRow[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    // 화면 언어의 번역본이 있으면 그 제목·표지로 보여준다(없으면 서버가 한국어로 폴백).
    callFunction<EbookListResp>('ebooks', { action: 'library', lang })
      .then((r) => setRows(r.ebooks))
      .catch((e) => setErr(e instanceof Error ? e.message : '이북을 불러올 수 없습니다.'))
  }, [lang])

  if (err) return <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 text-center text-on-surface-variant">{err}</div>
  if (rows === null) return <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>

  if (rows.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center">
        <p className="font-body-md text-on-surface-variant mb-5">{t('mypage.empty_ebooks')}</p>
        <button onClick={() => navigate('/ebooks')} className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow">{t('ebook.go_store')}</button>
      </div>
    )
  }

  return (
    <>
      {/* 표지 글자가 읽히도록 타일을 키운다(4열 → 3열, 모바일 2열 유지). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 md:gap-6">
        {rows.map((b) => (
          <button
            key={b.id}
            onClick={() => navigate(`/ebooks/read/${b.id}`)}
            className="group text-left flex flex-col gap-2.5"
            aria-label={b.title}
          >
            <EbookCover title={b.title} coverUrl={b.coverUrl} width={320} className="w-full transition-transform duration-300 group-hover:-translate-y-1 ambient-shadow" />
            <div>
              <h3 className="font-title-md text-[15px] leading-snug font-bold text-on-surface break-keep line-clamp-2">{b.title}</h3>
              {b.author && <p className="font-body-sm text-[12.5px] text-outline mt-0.5">{b.author}</p>}
            </div>
            <span className="font-label-md text-[13px] font-bold text-primary flex items-center gap-1">
              {t('ebook.read')}
              <span className="material-symbols-outlined text-[16px] group-hover:translate-x-0.5 transition-transform">arrow_forward</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-8 text-center">
        <button onClick={() => navigate('/ebooks')} className="px-6 py-2.5 bg-surface-container-lowest border border-outline-variant text-on-surface font-label-md text-[15px] font-bold rounded-xl hover:border-primary/30 hover:text-primary transition-all duration-200">{t('ebook.go_store')}</button>
      </div>
    </>
  )
}

export default function MyPage() {
  const navigate = useNavigate()
  const { section } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = section && TABS.some((t) => t.key === section) ? section : 'learning'
  const { isFullUser, user, loading: authLoading } = useAuth()
  const { t, lang } = useT()
  const [list, setList] = useState<MyAttempt[] | null>(null)
  const [tickets, setTickets] = useState<ExamTicketView[]>([])
  const [err, setErr] = useState('')
  // 지금 응시할 수 있는 응시권 — 다른 탭에 있어도 이게 있으면 알려준다.
  const openTickets = tickets.filter((tk) => tk.usable)

  // 응시 + 보유 응시권을 한 번에 받는다(같은 함수라 왕복이 안 늘어난다).
  //   lang 을 보내는 이유 = 회차 제목이 다국어 JSONB 라 서버가 그 언어로 투영해 내려준다.
  useEffect(() => {
    if (!isFullUser) return
    callFunction<MyAttemptsResponse>('my-attempts', { lang })
      .then((r) => {
        setList(r.attempts)
        setTickets(r.tickets ?? []) // 옛 함수가 떠 있으면 없다 — 그때는 응시권 블록이 통째로 안 뜬다
      })
      .catch((e) => setErr(e instanceof Error ? e.message : t('my.load_failed')))
  }, [isFullUser, lang])

  // 발급비 결제를 마치고 돌아온 길 — /pay/success 가 `?cert=<attemptId>` 를 달아 보낸다.
  // 그 응시의 발급 화면을 대신 열어준다(거기서 결제 전에 입력한 이름으로 자동 발급된다).
  // ⚠️ 목록이 도착한 뒤에만 움직인다 — attemptId 만으로는 증서에 넣을 급수·취득일을 만들 수 없다.
  //    없는 id 면 아무 일도 안 한다(남의 응시 id 를 넣어봐야 내 목록에 없으니 열리지 않는다).
  const certResumeRef = useRef(false)
  useEffect(() => {
    const id = searchParams.get('cert')
    if (!id || !list || certResumeRef.current) return
    const a = list.find((x) => x.attemptId === id)
    if (!a) return
    certResumeRef.current = true
    // 파라미터를 지우고(주소만 교체) 발급 화면으로 넘긴다 — 안 지우면 발급 화면에서 뒤로가기 했을 때
    // 이 화면이 다시 마운트되며 또 발급 화면으로 튕겨(ref 는 마운트마다 초기화) 뒤로가기가 막힌다.
    setSearchParams({}, { replace: true })
    void goCert(a)
    // goCert 는 매 렌더 새로 만들어지는 함수라 의존성에서 뺀다(넣으면 목록이 바뀔 때마다 재실행).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, list])

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const name = (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || t('mypage.default_name')

  // 발급 = 서버 기록(cert_issued_at) — 마이페이지/성적표 어디서 발급해도 '발급 완료'로 남고, 재발급도 가능.
  // 발급 응답에서 진위확인 토큰·확정 자격번호를 받아 인증서(QR)에 실어 보낸다.
  // 결제 유도 화면(/certificate 의 cert-gate)에 넘길 state — 견본 화면의 CTA 도 이걸 그대로 재사용한다.
  function gateState(a: MyAttempt) {
    return {
      preview: true,
      attemptId: a.attemptId,
      name,
      qualification: a.examTitle ?? t('mypage.exam_fallback'),
      grade: gradeDisplay(a.examTitle),
      certNo: a.certNo ?? certNoOf(a),
      issueDate: fmtDate(a.submittedAt),
      expiryDate: certExpiryDate(a.examTitle, a.submittedAt ? new Date(a.submittedAt) : new Date()),
      scoreText: `${a.totalCorrect} / ${a.totalQuestions}`,
    }
  }

  // 디자인 견본 — 더미 인물(홍길동) + 진한 워터마크. 내 이름·자격번호는 싣지 않는다.
  function goSample(a: MyAttempt) {
    navigate('/certificate/sample', {
      state: { sample: true, qualification: a.examTitle ?? '', grade: gradeDisplay(a.examTitle), name: '', certNo: '', issueDate: '', gate: gateState(a) },
    })
  }

  async function goCert(a: MyAttempt) {
    let verifyToken = a.verifyToken ?? undefined
    let certNo = a.certNo ?? certNoOf(a)
    // 아직 발급(유료) 전이면 인증서 대신 결제 유도 화면으로 — 발급은 그 화면의 결제 CTA 에서 한다.
    if (!a.certIssuedAt) {
      navigate('/certificate', { state: gateState(a) })
      return
    }
    let nameRoman = a.certNameRoman ?? undefined
    try {
      const r = await callFunction<MyAttemptsResponse>('my-attempts', { issue: a.attemptId })
      if (r.issued) {
        verifyToken = r.issued.verifyToken
        certNo = r.issued.certNo
        nameRoman = r.issued.nameRoman ?? nameRoman
      }
      setList((prev) => prev?.map((x) => (x.attemptId === a.attemptId ? { ...x, certIssuedAt: new Date().toISOString(), certNo: r.issued?.certNo ?? x.certNo, verifyToken: r.issued?.verifyToken ?? x.verifyToken } : x)) ?? prev)
    } catch {
      /* 발급 기록 실패 — 증서 화면은 열어준다(다음 방문 때 상태 재동기화) */
    }
    navigate('/certificate', {
      state: {
        name,
        // 인증서에 각인된 영문 성명 — 발급 때 저장한 스냅샷을 그대로 다시 쓴다(재발급도 같은 이름).
        nameRoman,
        qualification: a.examTitle ?? t('mypage.exam_fallback'),
        grade: gradeDisplay(a.examTitle),
        certNo,
        issueDate: fmtDate(a.submittedAt),
        expiryDate: certExpiryDate(a.examTitle, a.submittedAt ? new Date(a.submittedAt) : new Date()),
        verifyToken,
        scoreText: `${a.totalCorrect} / ${a.totalQuestions}`,
      },
    })
  }

  // 로그인 안 된 상태 → 로그인 페이지로 이동 (자체 로그인 게이트 제거)
  // ⚠️ 세션 복원(비동기)이 끝나기 전에는 판정하지 않는다. 예전엔 첫 프레임에서 isFullUser 가 false 라
  //    /mypage/earned → /login → (로그인 상태라) /mypage 로 튕겨서 **탭이 학습 대시보드로 초기화**됐다.
  if (authLoading) {
    return (
      <div className="wrap">
        <div className="card pad" style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('common.loading')}</div>
      </div>
    )
  }
  if (!isFullUser) return <Navigate to="/login" replace />

  const attempts = list ?? []
  const earned = attempts.filter((a) => a.passed === true)
  const loading = !err && list === null
  const selfLoaded = tab === 'learning' || tab === 'ebooks' // 자체 로딩 탭

  return (
    <div className="bg-background text-on-background min-h-screen relative overflow-x-hidden">
      {/* 헤더 없음 — FAB이 네비 */}
      <main className="min-h-screen px-margin-mobile md:px-margin-desktop pb-24 pt-12 relative">
        <div
          className="fixed inset-0 mesh-gradient-bg -z-10 pointer-events-none"
          style={{ maskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', WebkitMaskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', opacity: 0.15 }}
        ></div>

        <div className="max-w-5xl mx-auto w-full relative z-10">
          {/* Page Header */}
          <header className="mb-8 md:mb-12">
            <h1 className="font-display-lg text-4xl md:text-display-lg font-bold text-on-surface mb-3 tracking-tight break-keep">{t('mypage.title')}</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant">
              {t('mypage.greeting_hello')}<strong className="text-primary font-bold">{t('mypage.greeting_name', { name })}</strong>{t('mypage.greeting_tail')}
            </p>
          </header>

          {/* ⛔ 옛 `CARIS 응시하기` 배너는 없앴다(2026-08-11).
              그 배너는 **어느 응시권으로 가는지 모른 채** /exam 으로 보냈고, 응시권이 2장 이상이면
              서버가 "어느 걸 쓸지 골라라"로 튕기는데 고를 화면이 없어 그대로 막혔다.
              이제 입구는 아래 **보유 응시권 카드** 하나뿐이고, 카드가 곧 선택 화면이다.
              대신 응시 기간이 열린 응시권이 있으면 아래 줄로 알린다 — 안 그러면
              결제하고도 어디서 응시하는지 못 찾는다(기본 탭이 학습 대시보드라 카드가 안 보인다). */}
          {openTickets.length > 0 && tab !== 'attempts' && (
            <button
              onClick={() => navigate('/mypage/attempts')}
              className="group w-full mb-8 md:mb-10 flex items-center justify-between gap-4 rounded-2xl bg-primary-container text-on-primary px-6 py-5 md:px-8 md:py-6 ambient-shadow hover:translate-y-[-2px] transition-transform duration-200 text-left"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[26px]" style={{ fontVariationSettings: "'FILL' 1" }}>confirmation_number</span>
                </div>
                <div>
                  <div className="font-title-md text-lg md:text-[22px] font-bold">{t('ticket.open_now', { n: openTickets.length })}</div>
                  <div className="font-body-md text-body-md opacity-90">{t('ticket.open_now_sub')}</div>
                </div>
              </div>
              <span className="material-symbols-outlined text-[28px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </button>
          )}

          {/* 내 정보 — 국가/지역(락) */}
          <ProfileSection />

          {/* Tabs */}
          <div className="flex gap-5 sm:gap-8 border-b border-outline-variant/40 mb-8 md:mb-10 overflow-x-auto scrollbar-hide">
            {TABS.map((tb) => (
              <Link
                key={tb.key}
                to={tb.to}
                className={
                  tab === tb.key
                    ? 'pb-4 border-b-[3px] border-primary text-primary font-title-md text-base sm:text-[18px] leading-[24px] font-bold px-1 sm:px-2 whitespace-nowrap'
                    : 'pb-4 border-b-[3px] border-transparent text-outline hover:text-on-surface font-title-md text-base sm:text-[18px] leading-[24px] font-semibold px-1 sm:px-2 transition-colors whitespace-nowrap'
                }
              >
                {t(tb.labelKey)}
              </Link>
            ))}
          </div>

          {/* 학습 대시보드·이북 서재는 각자 데이터를 불러오므로 응시내역(my-attempts) 로딩/에러 배너 대상이 아니다. */}
          {err && !selfLoaded && <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 text-center text-on-surface-variant">{err}</div>}
          {loading && !selfLoaded && <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>}

          {/* 학습 대시보드 (CARIS ARENA) — 자체적으로 list-attempts 로딩 */}
          {tab === 'learning' && <LearningDashboard />}

          {/* 1:1 문의 — 쓴 사람과 운영자만 본다. */}
          {tab === 'inquiry' && <InquiryBoard />}

          {/* 이북 서재 — 구매한 이북 */}
          {tab === 'ebooks' && <EbookLibrary />}

          {/* 보유 응시권 — 결제했지만 아직 안 쓴 것. 탭을 6개로 늘리지 않은 이유: 탭 줄이 overflow-x-auto 라
              모바일에서 잘리고, 응시권↔응시기록은 같은 물건의 앞뒤 상태(결제 → 응시 → 결과)다. */}
          {!loading && !err && tab === 'attempts' && tickets.length > 0 && (
            <section className="mb-8 md:mb-10">
              <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-2">{t('ticket.section_title')}</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mb-5 break-keep">{t('ticket.section_sub')}</p>
              <div className="flex flex-col gap-6">
                {tickets.map((tk) => (
                  // ⚠️ 어느 응시권으로 가는지 반드시 넘긴다. 같은 회차에서 여러 급수를 살 수 있어서
                  //    지정 없이 들어가면 start-exam 이 409 pick_ticket 으로 튕기고 고를 화면이 없다.
                  <TicketCard
                    key={tk.ticketId}
                    tk={tk}
                    t={t}
                    lang={lang}
                    // 커버 화면(/exam)을 거쳐 간다 — 바로 준비창으로 떨어지면 시험 진입이 너무 급하다.
                    onGo={() => navigate(`/exam?ticket=${encodeURIComponent(tk.ticketId)}`)}
                    onCheck={() => navigate(`/exam/check?ticket=${encodeURIComponent(tk.ticketId)}`)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 시험 응시 현황.
              응시권 블록이 위에 섰을 때만 제목을 단다 — 없으면 탭 이름이 이미 이 목록을 가리키고 있어
              제목을 상시로 넣으면 기존 화면에 없던 줄이 하나 생긴다. */}
          {!loading && !err && tab === 'attempts' && tickets.length > 0 && attempts.length > 0 && (
            <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-5">{t('mypage.tab_attempts')}</h2>
          )}
          {!loading && !err && tab === 'attempts' && (
            attempts.length === 0 ? (
              // 응시권이 있으면 다음 할 일은 '응시', 없으면 '접수'다 — 빈 화면에서 길이 갈린다.
              <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center">
                <p className="font-body-md text-on-surface-variant mb-5">{tickets.length > 0 ? t('mypage.empty_attempts') : t('ticket.empty')}</p>
                <button onClick={() => navigate(tickets.length > 0 ? '/exam' : '/plan')} className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow">{tickets.length > 0 ? t('mypage.go_exam') : t('ticket.empty_cta')}</button>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {attempts.map((a) => {
                  const s = statusInfo(a)
                  return (
                    <article key={a.attemptId} className={`bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 ${s.greyed ? 'opacity-75' : ''}`}>
                      <div className="flex items-start gap-5 flex-1">
                        <div className={`w-14 h-14 rounded-xl ${s.wrap} flex items-center justify-center shrink-0 border`}>
                          <span className={`material-symbols-outlined ${s.color} text-[28px]`} style={{ fontVariationSettings: "'FILL' 1" }}>{s.icon}</span>
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
                            <h3 className={`font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold break-keep ${s.greyed ? 'text-on-surface-variant' : 'text-on-surface'}`}>{a.examTitle ?? t('mypage.exam_fallback')}</h3>
                            <span className={`px-3 py-1 ${s.badgeClass} font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border shrink-0`}>{s.badge}</span>
                          </div>
                          <p className="font-body-md text-body-md text-on-surface-variant mb-3">{fmtDT(a.submittedAt)} | {t('mypage.online')}</p>
                          {a.status === 'submitted' && !a.released && (
                            <p className="font-label-md text-[15px] leading-[22px] text-primary font-semibold flex items-center gap-1.5 bg-primary/5 px-3 py-1.5 rounded-lg w-fit">
                              <span className="material-symbols-outlined text-[18px]">schedule</span>
                              {t('mypage.grading', { days: daysLeft(a.resultReleaseAt) })}
                            </p>
                          )}
                          {(a.status === 'expired' || a.status === 'voided') && (
                            <p className="font-body-md text-body-md text-outline">{t('mypage.expired')}</p>
                          )}
                        </div>
                      </div>
                      {a.status === 'submitted' && a.released && (
                        <div className="shrink-0">
                          <button onClick={() => navigate(`/exam/result/${a.attemptId}`)} className="px-6 py-2.5 bg-surface-container-lowest border border-outline-variant text-on-surface font-label-md text-[15px] font-bold rounded-xl hover:bg-surface-container-low hover:border-primary/30 hover:text-primary transition-all duration-200 flex items-center gap-2 shadow-sm">
                            {t('mypage.view_score')}
                            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                          </button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )
          )}

          {/* 자격 취득 현황 = CARIS 자격검정 합격만.
              WORLD ARENA 레벨 인증서 섹션은 뺐다(2026-08-03) — 레벨 인증서는 레벨테스트 결과 화면에서만 발급한다. */}
          {tab === 'earned' && (
            <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-5">{t('mypage.tab_earned')}</h2>
          )}
          {!loading && !err && tab === 'earned' && (
            earned.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('mypage.empty_earned')}</div>
            ) : (
              <div className="flex flex-col gap-6">
                {earned.map((a) => (
                  <article key={a.attemptId} className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex items-start gap-5">
                    <div className="w-14 h-14 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-secondary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
                        <h3 className="font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold text-on-surface break-keep">{a.examTitle ?? t('mypage.exam_fallback')}</h3>
                        <span className="px-3 py-1 bg-secondary/10 text-secondary font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border border-secondary/20 shrink-0">{t('mypage.passed')}</span>
                      </div>
                      <p className="font-body-md text-body-md text-on-surface-variant">{fmtDate(a.submittedAt)} | {t('mypage.cert_no')} {a.certNo ?? certNoOf(a)} | {a.totalCorrect ?? 0} / {a.totalQuestions ?? 0}</p>
                    </div>
                  </article>
                ))}
              </div>
            )
          )}

          {/* 인증서 발급 현황 */}
          {!loading && !err && tab === 'issuance' && (
            <div className="flex flex-col gap-6">
              {/* 인증서 견본 — 취득 여부와 무관하게 이 탭에 항상 있는 고정 진입점(목록 위).
                  합격 건이 있으면 그 급수 견본으로, 없으면 기본 급수 견본으로 연다. */}
              <section className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow flex flex-col md:flex-row md:items-center justify-between gap-5">
                <div className="flex items-start gap-5">
                  <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-primary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                  </div>
                  <div>
                    <h3 className="font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold text-on-surface mb-2 break-keep">{t('mypage.sample_title')}</h3>
                    <p className="font-body-md text-body-md text-on-surface-variant break-keep">{t('mypage.sample_desc')}</p>
                  </div>
                </div>
                <button
                  onClick={() => (earned[0] ? goSample(earned[0]) : navigate('/certificate/sample'))}
                  className="shrink-0 px-6 py-2.5 bg-surface-container-lowest border border-outline-variant text-on-surface font-label-md text-[15px] font-bold rounded-xl hover:border-primary/30 hover:text-primary transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {t('mypage.view_sample')}
                  <span className="material-symbols-outlined text-[18px]">visibility</span>
                </button>
              </section>

              {earned.length === 0 ? (
                <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('mypage.empty_issuance')}</div>
              ) : (
                <div className="flex flex-col gap-6">
                {earned.map((a) => {
                  const certNo = a.certNo ?? certNoOf(a)
                  const issued = !!a.certIssuedAt
                  return (
                    <article key={a.attemptId} className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                      <div className="flex items-start gap-5 flex-1">
                        <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-primary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                        </div>
                        <div>
                          <h3 className="font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold text-on-surface mb-2 break-keep">{a.examTitle ?? t('mypage.exam_fallback')}</h3>
                          <p className="font-body-md text-body-md text-on-surface-variant">{t('mypage.cert_no')} {certNo}</p>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-wrap items-center gap-3">
                        <span className={`px-3 py-1 font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border ${issued ? 'bg-secondary/10 text-secondary border-secondary/20' : 'bg-outline/10 text-outline border-outline/20'}`}>{issued ? 'Issued' : 'Ready'}</span>
                        <button onClick={() => goCert(a)} className="px-6 py-2.5 bg-primary-container text-on-primary font-label-md text-[15px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow flex items-center gap-2">
                          {issued ? t('mypage.reissue') : t('mypage.issue')}
                          <span className="material-symbols-outlined text-[18px]">download</span>
                        </button>
                      </div>
                    </article>
                  )
                })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
