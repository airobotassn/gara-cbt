import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction, supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import SiteFooter from '../components/SiteFooter'
import type { EbookListResp, EbookRow, MyAttempt, MyAttemptsResponse } from '../lib/types'
import type { AttemptSummary, ListAttemptsResponse } from '../lib/testTypes'
import { LEVEL_COLORS } from '../lib/testConfigLevel'
import LearningDashboard from '../components/LearningDashboard'
import EbookCover from '../components/EbookCover'
import { makeCertNo, gradeOfTitle, gradeDisplay, certExpiryDate, tempSeq } from '../lib/certNo'
import { countryName } from '../lib/regions'

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
function certNoOf(a: MyAttempt) {
  // 시험명(급수)에서 등급 추정 → 종목·등급코드. 일련번호는 서버 연동 전까지 임시(tempSeq).
  const year = (a.submittedAt ? new Date(a.submittedAt).getFullYear() : 0) || new Date().getFullYear()
  return makeCertNo(gradeOfTitle(a.examTitle), year, tempSeq(a.attemptId))
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
  const [profile, setProfile] = useState<{ country_code: string | null; region_code: string | null } | null>(null)

  // 프로필(국가/지역) 로딩
  useEffect(() => {
    if (!user) return
    let alive = true
    supabase
      .from('profiles')
      .select('country_code,region_code')
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

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 ambient-shadow mb-8 md:mb-10">
      <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-5">{t('mypage.profile_title')}</h2>

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

// WORLD ARENA 레벨 인증서 — 레벨테스트에서 **승급한 순간**마다 한 장.
//   데이터는 list-attempts 가 이미 다 준다(rankDir==='up' 인 응시 = 승급 이벤트, rankAfter = 달성 레벨).
//   그래서 백엔드 추가 없이 화면만 붙였다. 같은 레벨 승급 기록이 여럿이면(옛 강등 이력) **처음 달성한 날**로 묶는다.
//   ⚠️ 인증서 원본(배경/서식)이 아직 없어서 발급 버튼은 '준비 중'으로 잠가 뒀다.
//      원본이 오면 이 버튼의 onClick 만 증서 화면으로 연결하면 된다(아래 TODO).
function LevelCerts() {
  const { t } = useT()
  const navigate = useNavigate()
  const [data, setData] = useState<ListAttemptsResponse | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    callFunction<ListAttemptsResponse>('list-attempts', {})
      .then((r) => alive && setData(r))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : 'error'))
    return () => { alive = false }
  }, [])

  // 승급 이벤트 → 레벨별 1장(처음 달성한 응시 기준)
  const certs = (() => {
    const byLevel = new Map<number, AttemptSummary>()
    for (const a of data?.attempts ?? []) {
      if (a.rankDir !== 'up' || a.rankAfter == null) continue
      const cur = byLevel.get(a.rankAfter)
      if (!cur || new Date(a.submittedAt) < new Date(cur.submittedAt)) byLevel.set(a.rankAfter, a)
    }
    return [...byLevel.entries()].sort((x, y) => y[0] - x[0]) // 높은 레벨부터
  })()

  return (
    <section className="mb-10">
      <div className="mb-5">
        <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface">{t('mypage.lvcert_title')}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1 break-keep">{t('mypage.lvcert_sub')}</p>
      </div>

      {err ? (
        <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 text-center text-on-surface-variant">{err}</div>
      ) : !data ? (
        <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>
      ) : certs.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center">
          <p className="font-body-md text-on-surface-variant mb-5 break-keep">{t('mypage.lvcert_empty')}</p>
          <button onClick={() => navigate('/test/select')} className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow">
            {t('mypage.lvcert_go')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {certs.map(([level, a]) => (
            <article key={level} className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-5">
              <div className="flex items-start gap-5">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: LEVEL_COLORS[level] }}>
                  <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>military_tech</span>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
                    <h3 className="font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold text-on-surface break-keep">
                      Lv.{level} {t(`lv.${level}.name`)}
                    </h3>
                    <span className="px-3 py-1 bg-secondary/10 text-secondary font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border border-secondary/20 shrink-0">
                      {t('mypage.lvcert_achieved')}
                    </span>
                  </div>
                  <p className="font-body-md text-body-md text-on-surface-variant">
                    {fmtDate(a.submittedAt)} | {a.totalCorrect} / {a.totalQuestions}
                  </p>
                </div>
              </div>
              {/* TODO(인증서): 원본 서식이 준비되면 여기서 증서 화면으로 이동시킨다. */}
              <button
                disabled
                title={t('mypage.lvcert_soon')}
                className="shrink-0 px-6 py-2.5 rounded-xl border border-outline-variant/60 bg-surface-container-low text-outline font-label-md text-[15px] font-bold flex items-center gap-2 cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">workspace_premium</span>
                {t('mypage.lvcert_get')}
                <span className="px-2 py-0.5 rounded-full bg-outline/10 text-[11px] font-bold">{t('mypage.lvcert_soon')}</span>
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
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
  const tab = section && TABS.some((t) => t.key === section) ? section : 'learning'
  const { isFullUser, user, loading: authLoading } = useAuth()
  const { t } = useT()
  const [list, setList] = useState<MyAttempt[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!isFullUser) return
    callFunction<{ attempts: MyAttempt[] }>('my-attempts', {})
      .then((r) => setList(r.attempts))
      .catch((e) => setErr(e instanceof Error ? e.message : t('my.load_failed')))
  }, [isFullUser])

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const name = (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || t('mypage.default_name')

  // 발급 = 서버 기록(cert_issued_at) — 마이페이지/성적표 어디서 발급해도 '발급 완료'로 남고, 재발급도 가능.
  // 발급 응답에서 진위확인 토큰·확정 자격번호를 받아 자격증(QR)에 실어 보낸다.
  async function goCert(a: MyAttempt) {
    let verifyToken = a.verifyToken ?? undefined
    let certNo = a.certNo ?? certNoOf(a)
    // 아직 발급(유료) 전이면 워터마크 견본부터 — 발급은 미리보기 화면의 CTA 에서 한다.
    if (!a.certIssuedAt) {
      navigate('/certificate', {
        state: {
          preview: true,
          attemptId: a.attemptId,
          name,
          qualification: a.examTitle ?? t('mypage.exam_fallback'),
          grade: gradeDisplay(a.examTitle),
          certNo,
          issueDate: fmtDate(a.submittedAt),
          expiryDate: certExpiryDate(a.examTitle, a.submittedAt ? new Date(a.submittedAt) : new Date()),
          scoreText: `${a.totalCorrect} / ${a.totalQuestions}`,
        },
      })
      return
    }
    try {
      const r = await callFunction<MyAttemptsResponse>('my-attempts', { issue: a.attemptId })
      if (r.issued) {
        verifyToken = r.issued.verifyToken
        certNo = r.issued.certNo
      }
      setList((prev) => prev?.map((x) => (x.attemptId === a.attemptId ? { ...x, certIssuedAt: new Date().toISOString(), certNo: r.issued?.certNo ?? x.certNo, verifyToken: r.issued?.verifyToken ?? x.verifyToken } : x)) ?? prev)
    } catch {
      /* 발급 기록 실패 — 증서 화면은 열어준다(다음 방문 때 상태 재동기화) */
    }
    navigate('/certificate', {
      state: {
        name,
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

          {/* CARIS 자격검정 응시 진입 — FAB에서 이관한 상단 CTA 배너 */}
          {/* TODO(응시권): 결제/응시권 백엔드 생기면 '결제된 시험 있으면 /exam, 없으면 /guide' 분기.
              단, 실제 게이팅은 여기(버튼)가 아니라 ExamGate(/exam) 의 onStart 훅에서 일괄 처리 예정 → 지금은 /exam 유지. */}
          <button
            onClick={() => navigate('/exam')}
            className="group w-full mb-8 md:mb-10 flex items-center justify-between gap-4 rounded-2xl bg-primary-container text-on-primary px-6 py-5 md:px-8 md:py-6 ambient-shadow hover:translate-y-[-2px] transition-transform duration-200 text-left"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[26px]" style={{ fontVariationSettings: "'FILL' 1" }}>edit_document</span>
              </div>
              <div>
                <div className="font-title-md text-lg md:text-[22px] font-bold">{t('mypage.go_exam')}</div>
                <div className="font-body-md text-body-md opacity-90">{t('mypage.cta_sub')}</div>
              </div>
            </div>
            <span className="material-symbols-outlined text-[28px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
          </button>

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

          {/* 이북 서재 — 구매한 이북 */}
          {tab === 'ebooks' && <EbookLibrary />}

          {/* 시험 응시 현황 */}
          {!loading && !err && tab === 'attempts' && (
            attempts.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center">
                <p className="font-body-md text-on-surface-variant mb-5">{t('mypage.empty_attempts')}</p>
                <button onClick={() => navigate('/exam')} className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow">{t('mypage.go_exam')}</button>
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

          {/* 자격 취득 현황 — ① WORLD ARENA 레벨 인증서(레벨테스트 승급) ② CARIS 자격검정 합격 */}
          {tab === 'earned' && <LevelCerts />}
          {tab === 'earned' && (
            <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-5">{t('mypage.tab_earned')} · CARIS</h2>
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

          {/* 자격증 발급 현황 */}
          {!loading && !err && tab === 'issuance' && (
            earned.length === 0 ? (
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
            )
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
