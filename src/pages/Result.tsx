import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import {
  weakestAxis,
  promoteCut,
  PROMOTE_RATE_LOW,
  PROMOTE_RATE_HIGH,
  type AxisMap,
} from '../lib/scoring'
import { axesForLevel, axisDef, MAX_LEVEL } from '../lib/categories'
import { useT, type TFunc } from '../lib/i18n'
import { useCountUp } from '../hooks/useCountUp'
import RadarChartBox from '../components/RadarChartBox'
import EbookCover from '../components/EbookCover'
import TopBar from '../components/TopBar'
import type { ResultResponse, StartTestResponse } from '../lib/testTypes'
import type { EbookPicksResp, EbookRow } from '../lib/types'

const CLAIM_KEY = 'pendingClaim'
interface PendingClaim {
  attemptId: string
  claimToken: string
}

export default function Result() {
  const { attemptId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()
  const { t, lang } = useT()
  const initial = (location.state as ResultResponse | null) ?? null

  const [data, setData] = useState<ResultResponse | null>(initial)
  const [loading, setLoading] = useState(!initial)
  const [error, setError] = useState<string | null>(null)
  // '다음 레벨 도전' 버튼 상태(승급했을 때만 쓴다)
  const [starting, setStarting] = useState(false)
  const [startErr, setStartErr] = useState<string | null>(null)

  useEffect(() => {
    if (initial?.claimToken && attemptId) {
      localStorage.setItem(
        CLAIM_KEY,
        JSON.stringify({ attemptId, claimToken: initial.claimToken } as PendingClaim),
      )
    }
  }, [initial, attemptId])

  useEffect(() => {
    const needsFetch = !data || (data.locked && isFullUser)
    if (!attemptId || !needsFetch) return
    let token: string | undefined
    const raw = localStorage.getItem(CLAIM_KEY)
    if (raw) {
      try {
        const p = JSON.parse(raw) as PendingClaim
        if (p.attemptId === attemptId) token = p.claimToken
      } catch {
        /* ignore */
      }
    }
    setLoading(true)
    callFunction<ResultResponse>('get-result', { attemptId, claimToken: token })
      .then((res) => {
        setData(res)
        if (!res.locked) localStorage.removeItem(CLAIM_KEY)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('result.load_failed')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, isFullUser])

  function handleLogin() {
    loginWithGoogle(`${window.location.origin}/test/result/${attemptId}`)
  }

  if (loading) {
    return (
      <div className="wrap">
        <div className="card pad" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          {t('result.loading')}
        </div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="wrap">
        <div className="card pad" style={{ textAlign: 'center', color: '#dc2626' }}>
          {error ?? t('result.notfound')}
        </div>
      </div>
    )
  }

  const locked = data.locked || !isFullUser
  // 승급했을 때만 다음 레벨로 이어 붙인다. 새 등급(rankAfter)이 곧 다음에 도전할 레벨이다
  // (승급 조건 = 응시레벨 ≥ 내 등급). 버튼을 누르면 여기서 응시를 만들고 /test/:id 의 응시 전
  // 경고 게이트로 넘어간다 — 레벨 선택 화면을 거치지 않는다.
  const promoted = !locked && data.rankDir === 'up'
  const nextLevel = Math.min(data.rankAfter ?? data.level + 1, MAX_LEVEL)

  async function startNext() {
    setStartErr(null)
    setStarting(true)
    try {
      const res = await callFunction<StartTestResponse>('start-test', { level: nextLevel, lang })
      navigate(`/test/${res.attemptId}`, { state: res })
    } catch (e) {
      // 하루 응시 소진은 서버가 error='daily_limit' 로 429 를 낸다(LevelSelect 와 같은 처리).
      const raw = e instanceof Error ? e.message : ''
      setStartErr(raw === 'daily_limit' ? t('lv.daily_limit') : raw || t('lv.start_failed'))
    } finally {
      setStarting(false)
    }
  }

  const scorePct = Math.round((data.totalCorrect / data.totalQuestions) * 100)
  const lp =
    !locked && data.deltas
      ? Math.round(Object.values(data.deltas).reduce((s, v) => s + v, 0))
      : null

  return (
    <div className="wrap">
      <TopBar />
      <div className="card pad">
        <ScoreHeader
          level={data.level}
          correct={data.totalCorrect}
          total={data.totalQuestions}
          pct={scorePct}
          lp={lp}
          t={t}
        />

        {locked ? (
          <LockedPanel onLogin={handleLogin} blocked={data.cooldownBlocked} level={data.level} t={t} />
        ) : (
          <UnlockedPanel data={data} t={t} />
        )}

        {/* 결과 아래 한 칸 — eBook Store 추천(잠금 여부와 무관하게 노출). */}
        <EbookPicks t={t} lang={lang} level={data.level} promoted={data.rankDir === 'up'} />

        <div className="result-actions">
          {/* 학습 대시보드 = /mypage 기본 탭. 옛 /dashboard 는 라우트가 없어 catch-all 로 메인에 떨어졌다. */}
          {isFullUser ? (
            <Link className="btn-ghost" to="/mypage" style={{ textDecoration: 'none' }}>
              {t('common.dashboard')}
            </Link>
          ) : null}
          {/* 승급했으면 '다음 레벨 도전'이 주 버튼 — 다시 테스트는 보조로 내린다. */}
          <Link className={promoted ? 'btn-ghost' : 'btn-ink'} to="/test/select" style={{ textDecoration: 'none' }}>
            {t('common.retry_test')}
          </Link>
          {promoted ? (
            <button className="btn-ink" onClick={startNext} disabled={starting}>
              {starting ? t('lv.preparing') : t('result.next_level', { n: nextLevel })}
            </button>
          ) : null}
        </div>
        {startErr ? (
          <div style={{ textAlign: 'center', color: '#dc2626', fontSize: 'var(--fs-sm)', marginTop: 10 }}>
            {startErr}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ScoreHeader({
  level,
  correct,
  total,
  pct,
  lp,
  t,
}: {
  level: number
  correct: number
  total: number
  pct: number
  lp: number | null
  t: TFunc
}) {
  const n = useCountUp(correct, 800)
  return (
    <div className="score-wrap">
      <div className="score-label">{t('result.level_result', { n: level })}</div>
      <div className="score">
        {n}
        <small> / {total}</small>
      </div>
      <div className="rating-line">{t('result.accuracy', { p: pct })}</div>
      {lp != null && lp !== 0 ? <ScoreLp lp={lp} /> : null}
    </div>
  )
}

function ScoreLp({ lp }: { lp: number }) {
  const v = useCountUp(lp, 700, 0, 700)
  const up = lp >= 0
  return <div className={`score-lp ${up ? 'up' : 'down'}`}>{up ? `▲ +${v}` : `▼ ${v}`}</div>
}

function LockedPanel({
  onLogin,
  blocked,
  level,
  t,
}: {
  onLogin: () => void
  blocked?: boolean
  level: number
  t: TFunc
}) {
  const { lang } = useT()
  const axes = axesForLevel(level, lang)
  const dummy: AxisMap = {}
  axes.forEach((a, i) => (dummy[a.key] = 45 + ((i * 13) % 35)))
  return (
    <div className="locked">
      <div className="blurred">
        <div style={{ textAlign: 'center', marginBottom: 10 }}>
          <span className="tier-badge" style={{ background: '#3aa79f' }}>
            ████
          </span>
        </div>
        <RadarChartBox axes={axes} rating={dummy} />
      </div>
      <div className="veil">
        {!blocked ? <div className="peek-hint">{t('locked.peek')}</div> : null}
        <div className="lock-ico">🔒</div>
        <h3>{t('locked.title')}</h3>
        <p>{blocked ? t('locked.blocked') : t('locked.desc')}</p>
        {!blocked ? (
          <button className="g-btn" onClick={onLogin}>
            ● {t('locked.cta')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

// 점수 아래 구성(위→아래): 등급변동 배너(고정) → ‹ › 하이라이트 2장(레이더 → 변동) → 처방 → 이북 추천.
//   ⚠️ 티어 엠블렘 슬라이드(Lv.N 크게 띄우던 화면)는 폐기됐다. 그 안에 있던 승급 배너는
//      넘기지 않아도 늘 보이도록 슬라이드 **밖 상단**으로 분리했다(등급변동 규칙상 결과창 필수 노출).
function UnlockedPanel({ data, t }: { data: ResultResponse; t: TFunc }) {
  const [step, setStep] = useState(0)
  const SLIDES = 2
  const go = (s: number) => setStep(Math.max(0, Math.min(SLIDES - 1, s)))

  if (!data.rating) return null

  return (
    <div style={{ marginTop: 24 }}>
      <RankBanner data={data} t={t} />
      <div className="hl">
        <button className="hl-arrow" onClick={() => go(step - 1)} disabled={step === 0}>
          ‹
        </button>
        <div className="hl-stage" key={step}>
          {step === 0 ? <RadarSlide data={data} t={t} /> : <DeltaSlide data={data} t={t} />}
        </div>
        <button className="hl-arrow" onClick={() => go(step + 1)} disabled={step === SLIDES - 1}>
          ›
        </button>
      </div>
      <div className="hl-dots">
        {[0, 1].map((i) => (
          <button
            key={i}
            className={`hl-dot ${step === i ? 'on' : ''}`}
            onClick={() => go(i)}
          />
        ))}
      </div>

      <Prescription data={data} t={t} />

      {/* 오답노트(문항별 정답·해설 리스트)는 제거됐다 — 결과창은 하이라이트/처방/이북 추천까지만.
          같이 사라진 것: 문항 점프 내비(ResultNav)와 문항별 오류 제보(ReportBox, submit-report 진입점). */}
    </div>
  )
}

// 등급 변동 배너 — 슬라이드가 아니라 상단 고정. 승급했을 때만 그린다(강등이 없으므로 하락 배너도 없다).
function RankBanner({ data, t }: { data: ResultResponse; t: TFunc }) {
  const rankAfter = data.rankAfter ?? data.level
  const rankBefore = data.rankBefore ?? rankAfter
  if (data.rankDir !== 'up') return null
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="tier-change up">
        <span className="tc-label">🎉 {t('result.promoted')}</span>
        <span className="tc-flow">
          Lv.{rankBefore} <span className="tc-arrow">→</span> Lv.{rankAfter}
        </span>
      </div>
    </div>
  )
}

// 슬라이드 1: 레이더 — 실선 = 이번 시험 결과(per-test), 음영 = 직전 동레벨 시험(없으면 생략)
function RadarSlide({ data, t }: { data: ResultResponse; t: TFunc }) {
  const { lang } = useT()
  const axes = axesForLevel(data.level, lang)
  // 이번 시험 6축 성적. perf 가 없으면(구버전 응답) 누적 레이팅으로 폴백.
  const me: AxisMap = data.perf ?? data.rating!
  const ghost: AxisMap | null = data.prevPerf ?? null
  return (
    <div className="panel-card" style={{ marginTop: 0 }}>
      <div className="ph">
        <div className="t">{t('result.radar_title')}</div>
        <div className="leg">
          <span style={{ color: 'var(--accent)' }}>● {t('result.legend_thistest')}</span>{' '}
          {ghost ? <span style={{ color: 'var(--dim)' }}>┄ {t('result.legend_prevtest')}</span> : null}
        </div>
      </div>
      <div className="radar-in">
        <RadarChartBox axes={axes} rating={me} ghost={ghost} />
      </div>
    </div>
  )
}

// 슬라이드 2: 축별 변동 (바 차오름 + 변동 팝업)
function DeltaSlide({ data, t }: { data: ResultResponse; t: TFunc }) {
  const { lang } = useT()
  const rating = data.rating!
  const axes = axesForLevel(data.level, lang)
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setGrown(true), 500)
    return () => clearTimeout(id)
  }, [])
  return (
    <div className="panel-card" style={{ marginTop: 0 }}>
      <div className="ph">
        <div className="t">{t('result.delta_title')}</div>
        <div className="leg">{t('result.delta_legend')}</div>
      </div>
      <div className="axis-prog">
        {axes.map((c, i) => {
          const cur = Math.round(rating[c.key] ?? 0)
          const d = Math.round(data.deltas?.[c.key] ?? 0)
          const prev = Math.max(0, Math.min(100, cur - d))
          const base = Math.min(prev, cur)
          const delay = `${i * 70}ms`
          return (
            <div className="ap" key={c.key}>
              <div className="lab">{c.short}</div>
              <div className="track">
                <div className="seg base" style={{ width: `${base}%` }} />
                {d > 0 ? (
                  <div
                    className="seg gain"
                    style={{ left: `${prev}%`, width: grown ? `${d}%` : '0%', transitionDelay: delay }}
                  />
                ) : d < 0 ? (
                  <div
                    className="seg loss"
                    style={{ left: `${cur}%`, width: grown ? '0%' : `${-d}%`, transitionDelay: delay }}
                  />
                ) : null}
              </div>
              <div className="val">
                <b>{cur}</b> <DeltaNumber d={d} delay={i * 70 + 550} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DeltaNumber({ d, delay }: { d: number; delay: number }) {
  const v = useCountUp(d, 700, 0, delay)
  if (d === 0) return <span className="flat">–</span>
  return d > 0 ? <span className="up">▲+{v}</span> : <span className="dn">▼{v}</span>
}

// 진단서 → 처방전
function Prescription({ data, t }: { data: ResultResponse; t: TFunc }) {
  const { lang } = useT()
  const rating = data.rating!
  const axes = axesForLevel(data.level, lang)
  const focusKey = weakestAxis(rating, axes.map((a) => a.key))
  const focus = axisDef(focusKey).short

  // 승급했으면 다음 레벨 도전을 권하고, 승급 못 했으면(유지) 교재 학습으로 유도한다.
  //   승급 컷은 비율이라 '몇 개 모자랐는지'를 실제 출제 수 기준으로 계산해 보여준다.
  const promoted = data.rankDir === 'up'
  const total = data.totalQuestions
  const cutRate = data.level <= 3 ? PROMOTE_RATE_LOW : PROMOTE_RATE_HIGH
  const need = Math.max(1, promoteCut(data.level, total) - data.totalCorrect)

  return (
    <div className="panel-card rx" style={{ marginTop: 18 }}>
      <div className="ph">
        <div className="t">🎯 {t('rx.title')}</div>
      </div>
      <ul className="rx-list">
        <li>
          <span className="rx-ic">🧭</span>
          <span>
            <b>{t('rx.focus', { axis: focus })}</b>
          </span>
        </li>
        {promoted ? (
          <li>
            <span className="rx-ic">🎚️</span>
            <span>{t('rx.next_up', { n: Math.min(data.level + 1, MAX_LEVEL) })}</span>
          </li>
        ) : (
          <>
            <li>
              <span className="rx-ic">📕</span>
              <span>{t('rx.study_weak', { axis: focus })}</span>
            </li>
            <li>
              <span className="rx-ic">🎚️</span>
              <span>
                {t('rx.study_pass', { n: data.level, p: Math.round(cutRate * 100), need })}
                {' '}
                <Link className="rx-cta" to="/ebooks">{t('rx.study_cta')}</Link>
              </span>
            </li>
          </>
        )}
      </ul>
    </div>
  )
}

// 결과 아래 이북 추천 — 응시 레벨에 맞는 책이 위로 온다(ebooks picks 액션). 비로그인도 조회 가능.
//   승급했으면 다음 레벨 교재를, 아니면 지금 레벨 교재를 권한다. 이미 산 책은 서버가 제외.
//   ⚠️ 레벨당 1권 체계라 매칭 기준은 레벨 하나뿐 — 6축 약점 기반으로 가려면 책이 레벨 안에서
//      갈라진 뒤 ebooks 에 축 태그를 붙여야 한다.
// 2권 = 지금 도전할 레벨 + 다음 레벨. 3권이던 시절엔 남는 칸을 이미 통과한 아래 레벨이 채웠다.
//   ⚠️ 개수를 바꾸면 result.css 의 .rb-grid 열 수도 같이 맞출 것(빈 칸이 생긴다).
const EBOOK_PICKS = 2
function EbookPicks({ t, lang, level, promoted }: { t: TFunc; lang: string; level: number; promoted: boolean }) {
  const [books, setBooks] = useState<EbookRow[] | null>(null)

  useEffect(() => {
    let alive = true
    callFunction<EbookPicksResp>('ebooks', { action: 'picks', lang, level, promoted, limit: EBOOK_PICKS })
      .then((r) => { if (alive) setBooks(r.ebooks) })
      .catch(() => { if (alive) setBooks([]) })
    return () => { alive = false }
  }, [lang, level, promoted])

  // 아직 못 불러왔거나 등록된 이북이 없으면 칸 자체를 그리지 않는다(빈 카드 방지).
  if (!books || books.length === 0) return null

  return (
    <div className="panel-card rb" style={{ marginTop: 18 }}>
      <div className="ph">
        <div className="t">📚 {t('result.books_title')}</div>
        <Link className="rb-more" to="/ebooks">
          {t('result.books_more')} ›
        </Link>
      </div>
      <p className="rb-sub">{t('result.books_sub')}</p>
      <div className="rb-grid">
        {books.map((b) => (
          <Link key={b.id} className="rb-item" to="/ebooks">
            <EbookCover title={b.title} coverUrl={b.coverUrl} className="rb-cover" />
            <b className="rb-title">{b.title}</b>
            {b.author ? <i className="rb-author">{b.author}</i> : null}
            <span className="rb-price">
              {b.price > 0 ? `₩${b.price.toLocaleString('ko-KR')}` : t('ebook.free')}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

