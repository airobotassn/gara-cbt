import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { callFunction } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { useCountUp } from '../hooks/useCountUp'
import { proGradeForScore, gradeLabel, proGradeTag } from '../lib/caris'
import { makeCertNo, tempSeq } from '../lib/certNo'
import type { ExamResultResponse, GradedAnswer, SubmitExamResponse } from '../lib/types'

// 성적 결과 — gara_11 시안 레이아웃(게이지·급수 배지·과목별 성취도) + CARIS Pro 급수 판정을
// GARA Precision 톤으로 자체 디자인. 채점 로직/상태(공개 전·무효·에러) 보존.
// ⚠️ 백엔드 데이터 연동은 추후 — 지금은 있는 응답(정답수·문항수·과목)으로 디자인만.
function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
// 상세 행용 컴팩트 날짜 (모바일에서 라벨을 밀지 않게 짧게) — 예: 2026. 06. 22. 18:12
function fmtDateCompact(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}. ${p(d.getHours())}:${p(d.getMinutes())}`
}
function daysLeft(iso?: string | null) {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}

// 페이지 셸 (Stitch 네비 + 푸터)
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-on-surface mesh-bg min-h-screen flex flex-col">
      {/* 헤더 없음 — FAB이 네비 */}
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto flex items-center justify-center">
        {children}
      </main>

      <SiteFooter />
    </div>
  )
}

// 결과 카드 셸 (안내/에러 상태용 — 좁은 단일 카드)
function Card({ children }: { children: ReactNode }) {
  return (
    <div className="glass-panel rounded-2xl p-8 md:p-14 ambient-shadow max-w-2xl w-full text-center border border-white/40">{children}</div>
  )
}
function Emblem({ icon, tone }: { icon: string; tone: 'primary' | 'secondary' | 'error' }) {
  const map = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    secondary: 'bg-secondary/10 text-secondary border-secondary/20',
    error: 'bg-error/10 text-error border-error/20',
  }
  return (
    <div className={`w-20 h-20 rounded-full ${map[tone]} border flex items-center justify-center mx-auto mb-6`}>
      <span className="material-symbols-outlined text-[40px]" style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
    </div>
  )
}

// 과목별 정답 집계 (answers[].subject 로 그룹)
function subjectStats(answers: GradedAnswer[]) {
  const map = new Map<string, { correct: number; total: number }>()
  for (const a of answers) {
    const s = (a.subject || '').trim() || '기타'
    const cur = map.get(s) ?? { correct: 0, total: 0 }
    cur.total += 1
    if (a.isCorrect) cur.correct += 1
    map.set(s, cur)
  }
  return [...map.entries()].map(([subject, v]) => ({
    subject,
    correct: v.correct,
    total: v.total,
    pct: Math.round((v.correct / Math.max(1, v.total)) * 100),
  }))
}

// 성취도 색 티어 — GARA 팔레트(초록 토큰이 없어 primary/secondary/error 로 강약 표현)
function toneFor(pct: number) {
  if (pct >= 80) return { border: 'border-t-primary', text: 'text-primary', bar: 'bg-primary' }
  if (pct >= 60) return { border: 'border-t-secondary', text: 'text-secondary', bar: 'bg-secondary' }
  return { border: 'border-t-error', text: 'text-error', bar: 'bg-error' }
}

// 상세 카드 한 줄
function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="font-body-md text-body-md text-on-surface-variant shrink-0 whitespace-nowrap">{label}</span>
      <span className={`font-body-md text-body-md text-right break-keep ${tone ?? 'font-medium text-on-surface'}`}>{value}</span>
    </div>
  )
}

type GradedData = Extract<ExamResultResponse, { released: true }>

// 디자인 미리보기 전용 더미 — /exam/result/preview 로만 렌더(FAB 개발 링크. ?demo=fail = 불합격 화면).
// 실제 응시(/exam/result/<attemptId>)는 항상 get-exam-result 실데이터 — 공개 전엔 서버가 점수를 안 내려줌.
const DEMO_SUBJECTS_PASS = [
  { subject: '생성형 AI 및 윤리', total: 20, correct: 19 },
  { subject: '스마트 도구 및 로봇 기술', total: 40, correct: 34 },
  { subject: '피지컬 AI 및 데이터 처리', total: 20, correct: 14 },
]
const DEMO_SUBJECTS_FAIL = [
  { subject: '생성형 AI 및 윤리', total: 20, correct: 9 },
  { subject: '스마트 도구 및 로봇 기술', total: 40, correct: 16 },
  { subject: '피지컬 AI 및 데이터 처리', total: 20, correct: 11 },
]
function demoData(fail = false): GradedData {
  const specs = fail ? DEMO_SUBJECTS_FAIL : DEMO_SUBJECTS_PASS
  const answers: GradedAnswer[] = []
  let n = 1
  for (const s of specs) {
    for (let i = 0; i < s.total; i++) {
      const ok = i < s.correct
      answers.push({ number: n++, subject: s.subject, topic: '', prompt: '', choices: [], selectedIndex: 0, correctIndex: ok ? 0 : 1, isCorrect: ok })
    }
  }
  return {
    released: true,
    submittedAt: '2026-06-22T18:12:00+09:00',
    totalCorrect: answers.filter((a) => a.isCorrect).length,
    totalQuestions: answers.length,
    answers,
  }
}

// 채점 공개 후 성적표 — 자체 훅(카운트업)을 쓰므로 컴포넌트로 분리(훅 순서 안정)
function GradedResult({ data, attemptId, certName }: { data: GradedData; attemptId?: string; certName: string }) {
  const navigate = useNavigate()
  const { t, lang } = useT()

  const total = Math.max(1, data.totalQuestions)
  const scorePct = Math.round((data.totalCorrect / total) * 100)
  const grade = proGradeForScore(scorePct)
  const passed = grade !== null
  const subjects = useMemo(() => subjectStats(data.answers), [data.answers])

  // 점수 카운트업 + 게이지 채움 동기화
  const anim = useCountUp(scorePct, 1100, 0, 250)
  const CIRC = 2 * Math.PI * 45
  const dashoffset = CIRC * (1 - anim / 100)

  // Pro 단발 시험 → 종목 CARIS(CA)·등급 PRO. 일련번호는 서버 시퀀스 연동 전까지 임시(tempSeq).
  const certNo = makeCertNo('pro', new Date().getFullYear(), tempSeq(String(attemptId ?? '')))
  const issueDate = (() => {
    const d = new Date()
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
  })()

  function goCertificate() {
    // 발급 기록(서버) — 마이페이지 발급현황과 공유되는 '발급 완료' 상태. 미리보기는 기록 없음.
    if (attemptId && attemptId !== 'preview') {
      callFunction('my-attempts', { issue: attemptId }).catch(() => {
        /* 기록 실패해도 증서 화면은 열어준다 */
      })
    }
    navigate('/certificate', {
      state: {
        name: certName,
        qualification: grade ? `CARIS Pro ${gradeLabel(grade.grade, lang)}` : t('mypage.exam_fallback'),
        certNo,
        issueDate,
        scoreText: `${scorePct}점 (${data.totalCorrect}/${data.totalQuestions})`,
      },
    })
  }

  // Pro 는 단발 시험(점수로 급수 판정) — 누적/사다리 구조가 아니다.
  // 합격 시 상위 급수를 들이밀면(‘승급까지 N점’·‘재응시로 도전’) 멕이는 느낌 → 금지.
  // 대신 취득한 급수가 인증하는 역량 수준을 그대로 긍정 서술. (1급만 Master 응시 자격 안내)
  const infoLine =
    grade?.grade === '1급'
      ? t('exresult.info_master')
      : passed && grade
        ? t('exresult.info_grade', { tag: proGradeTag(grade.grade, lang) })
        : t('exresult.info_fail')
  const infoIcon = grade?.grade === '1급' ? 'rocket_launch' : passed ? 'verified' : 'target'

  return (
    <div className="w-full max-w-2xl flex flex-col gap-10">
      {/* ── 성적 카드 ── */}
      <div className="glass-panel rounded-3xl p-6 md:p-12 ambient-shadow border border-white/40 relative overflow-hidden text-center">
        {/* 워터마크 아이콘 */}
        <span
          className="material-symbols-outlined absolute -top-6 -right-6 text-[170px] pointer-events-none select-none"
          style={{ fontVariationSettings: "'FILL' 1", color: passed ? 'rgba(0,74,198,0.05)' : 'rgba(186,26,26,0.05)' }}
        >
          {passed ? 'verified' : 'sentiment_dissatisfied'}
        </span>

        {/* 합격/불합격 배지 */}
        <div
          className={`relative inline-flex items-center gap-2 px-4 py-2 rounded-2xl mb-8 border font-label-md text-label-md font-bold break-keep text-center leading-snug max-w-full ${
            passed ? 'bg-primary/10 text-primary border-primary/20' : 'bg-error/10 text-error border-error/20'
          }`}
        >
          <span className="material-symbols-outlined text-[20px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>
            {passed ? 'workspace_premium' : 'info'}
          </span>
          {passed ? t('exresult.pass_badge', { grade: gradeLabel(grade!.grade, lang) }) : t('exresult.fail_badge')}
        </div>

        {/* 점수 원형 게이지 */}
        <div className="relative w-44 h-44 mx-auto mb-8">
          <svg viewBox="0 0 100 100" className={`w-full h-full -rotate-90 ${passed ? 'text-primary' : 'text-error'}`}>
            <circle cx="50" cy="50" r="45" fill="none" strokeWidth="7" style={{ stroke: 'var(--color-surface-container-high)' }} />
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={dashoffset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="flex items-baseline gap-1">
              <span className={`font-display-lg text-display-lg leading-none ${passed ? 'text-primary' : 'text-error'}`}>{anim}</span>
              <span className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface-variant">/ 100</span>
            </div>
            <span className="font-label-md text-label-md text-on-surface-variant mt-1">{t('exresult.score_unit')}</span>
          </div>
        </div>

        {/* 상세 */}
        <div className="bg-surface-container-low/70 rounded-2xl p-5 md:p-6 mb-8 flex flex-col gap-4 text-left border border-outline-variant/20 max-w-md mx-auto">
          <Row label={t('result.submitted_at')} value={fmtDateCompact(data.submittedAt)} />
          <div className="h-px bg-outline-variant/25" />
          <Row
            label={t('exresult.earned_grade')}
            value={passed ? `CARIS Pro ${gradeLabel(grade!.grade, lang)}` : t('result.fail')}
            tone={passed ? 'text-primary font-bold' : 'text-error font-bold'}
          />
          <div className="h-px bg-outline-variant/25" />
          <Row label={t('exresult.correct_count')} value={`${data.totalCorrect} / ${data.totalQuestions}`} />
          <div className="bg-primary/5 rounded-lg p-3 flex items-start gap-2">
            <span className="material-symbols-outlined text-primary text-[20px] shrink-0">{infoIcon}</span>
            <span className="font-label-md text-label-md text-primary break-keep leading-snug">{infoLine}</span>
          </div>
        </div>

        {/* 액션 — 상황별 주요 버튼 + 항상 뒤로 */}
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 justify-center max-w-md mx-auto">
          {passed && (
            <button
              onClick={goCertificate}
              className="flex-1 bg-primary-container text-on-primary font-title-md text-title-md font-bold py-3.5 px-6 rounded-xl ambient-shadow hover:translate-y-[-2px] transition-transform duration-200 inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">workspace_premium</span>
              {t('exresult.issue_cert')}
            </button>
          )}
          {grade?.grade === '1급' && (
            <button
              onClick={() => navigate('/guide')}
              className="flex-1 bg-surface-container-lowest border border-primary/30 text-primary font-title-md text-title-md py-3.5 px-6 rounded-xl hover:bg-primary/5 transition-all inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">school</span>
              {t('exresult.master_guide')}
            </button>
          )}
          <button
            onClick={() => navigate('/mypage')}
            className="bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary font-title-md text-title-md py-3.5 px-6 rounded-xl transition-all"
          >
            {t('exresult.to_attempts')}
          </button>
        </div>
      </div>

      {/* ── 과목별 성취도 ── */}
      {subjects.length > 0 && (
        <div className="w-full flex flex-col gap-5">
          <h3 className="font-title-md text-title-md font-bold text-on-background text-left">{t('exresult.subject_title')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {subjects.map((s, i) => {
              const tone = toneFor(s.pct)
              return (
                <div key={s.subject} className={`glass-card rounded-2xl p-5 flex flex-col gap-3 border-t-4 ${tone.border}`}>
                  <div className="flex justify-between items-center">
                    <span className="font-label-md text-label-md text-on-surface-variant">{t('exresult.subject_n', { n: i + 1 })}</span>
                    <span className={`font-bold ${tone.text}`}>{s.pct}%</span>
                  </div>
                  <div className="font-body-md text-body-md font-semibold text-on-surface leading-snug">{s.subject}</div>
                  <div className="w-full bg-outline-variant/20 h-2 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${tone.bar} transition-[width] duration-700`} style={{ width: `${s.pct}%` }} />
                  </div>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">
                    {s.correct}/{s.total} {t('exresult.correct_suffix')}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ExamResult() {
  const { attemptId } = useParams()
  const location = useLocation()
  const justSubmitted = location.state as SubmitExamResponse | null
  const { user } = useAuth()
  const { t } = useT()

  const [data, setData] = useState<ExamResultResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    // 디자인 미리보기(/exam/result/preview) — 더미 성적. 실 응시는 아래 실데이터 경로.
    if (attemptId === 'preview') {
      const fail = new URLSearchParams(location.search).get('demo') === 'fail'
      setData(demoData(fail))
      setLoading(false)
      return
    }
    let alive = true
    callFunction<ExamResultResponse>('get-exam-result', { attemptId })
      .then((r) => alive && setData(r))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : t('result.load_failed')))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [attemptId, location.search])

  // 무효 제출
  if (justSubmitted?.voided) {
    return (
      <Shell>
        <Card>
          <Emblem icon="block" tone="error" />
          <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-3">{t('result.voided_title')}</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant mb-8">{t('result.voided_sub')}</p>
        </Card>
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell>
        <Card>
          <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto mb-6"></div>
          <p className="font-body-lg text-body-lg text-on-surface-variant">{t('result.loading')}</p>
        </Card>
      </Shell>
    )
  }

  if (err || !data) {
    return (
      <Shell>
        <Card>
          <Emblem icon="warning" tone="error" />
          <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-3">{t('result.load_failed_title')}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mb-8">{err}</p>
        </Card>
      </Shell>
    )
  }

  // 채점 공개 전
  if (!data.released) {
    return (
      <Shell>
        <Card>
          <Emblem icon="schedule" tone="primary" />
          <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-3">{t('result.submitted_title')}</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant mb-8">{t('result.submitted_sub', { n: data.totalQuestions })}</p>
          <div className="bg-surface-container-low rounded-xl p-6 text-left flex flex-col gap-3 mb-8">
            <div className="flex justify-between items-center">
              <span className="font-body-md text-on-surface-variant">{t('result.submitted_at')}</span>
              <b className="font-body-md text-on-surface">{fmtDate(data.submittedAt)}</b>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-body-md text-primary font-semibold">{t('result.release_at')}</span>
              <b className="font-body-md text-primary">{fmtDate(data.resultReleaseAt)}</b>
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant pt-2 border-t border-outline-variant/20">
              {t('result.release_note_pre')}<b className="text-primary">{t('result.release_days', { d: daysLeft(data.resultReleaseAt) })}</b>{t('result.release_note_post')}
            </p>
          </div>
        </Card>
      </Shell>
    )
  }

  // 채점 공개 후 — 성적표
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const certName = (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || t('mypage.default_name')

  return (
    <Shell>
      <GradedResult data={data} attemptId={attemptId} certName={certName} />
    </Shell>
  )
}
