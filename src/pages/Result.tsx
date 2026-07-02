import { useEffect, useState } from 'react'
import { useLocation, useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import {
  weakestAxis,
  emblemKeyForLevel,
  levelColor,
  DEMOTE_STRIKES,
  type AxisMap,
} from '../lib/scoring'
import { axesForLevel, axisDef } from '../lib/categories'
import { useT, type TFunc } from '../lib/i18n'
import { useCountUp } from '../hooks/useCountUp'
import RadarChartBox from '../components/RadarChartBox'
import TierEmblem from '../components/TierEmblem'
import TopBar from '../components/TopBar'
import type { GradedAnswer, ResultResponse } from '../lib/testTypes'

const CLAIM_KEY = 'pendingClaim'
interface PendingClaim {
  attemptId: string
  claimToken: string
}

function scrollToQ(i: number) {
  document.getElementById(`q-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

export default function Result() {
  const { attemptId } = useParams()
  const location = useLocation()
  const { isFullUser, loginWithGoogle } = useAuth()
  const { t } = useT()
  const initial = (location.state as ResultResponse | null) ?? null

  const [data, setData] = useState<ResultResponse | null>(initial)
  const [loading, setLoading] = useState(!initial)
  const [error, setError] = useState<string | null>(null)

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
  const scorePct = Math.round((data.totalCorrect / data.totalQuestions) * 100)
  const lp =
    !locked && data.deltas
      ? Math.round(Object.values(data.deltas).reduce((s, v) => s + v, 0))
      : null

  return (
    <div className="wrap">
      <TopBar />
      {!locked && data.answers.length > 0 ? <ResultNav answers={data.answers} t={t} /> : null}
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
          <UnlockedPanel data={data} pct={scorePct} t={t} />
        )}

        <div className="result-actions">
          {isFullUser ? (
            <Link className="btn-ghost" to="/dashboard" style={{ textDecoration: 'none' }}>
              {t('common.dashboard')}
            </Link>
          ) : null}
          <Link className="btn-ink" to="/test/select" style={{ textDecoration: 'none' }}>
            {t('common.retry_test')}
          </Link>
        </div>
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

// 점수 아래: ‹ › 로 넘기는 하이라이트 카드(등급 → 레이더 → 변동). 넘길 때마다 애니 재생.
function UnlockedPanel({ data, pct, t }: { data: ResultResponse; pct: number; t: TFunc }) {
  const { lang } = useT()
  const [step, setStep] = useState(0)
  const SLIDES = 3
  const go = (s: number) => setStep(Math.max(0, Math.min(SLIDES - 1, s)))

  if (!data.rating) return null

  return (
    <div style={{ marginTop: 24 }}>
      <div className="hl">
        <button className="hl-arrow" onClick={() => go(step - 1)} disabled={step === 0}>
          ‹
        </button>
        <div className="hl-stage" key={step}>
          {step === 0 ? (
            <RankSlide data={data} pct={pct} t={t} />
          ) : step === 1 ? (
            <RadarSlide data={data} t={t} />
          ) : (
            <DeltaSlide data={data} t={t} />
          )}
        </div>
        <button className="hl-arrow" onClick={() => go(step + 1)} disabled={step === SLIDES - 1}>
          ›
        </button>
      </div>
      <div className="hl-dots">
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            className={`hl-dot ${step === i ? 'on' : ''}`}
            onClick={() => go(i)}
          />
        ))}
      </div>

      {/* 오답노트(전체, 스크롤) */}
      <div className="panel-card">
        <div className="ph">
          <div className="t">{t('result.answers_title')}</div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          {data.answers.map((a, i) => (
            <div key={a.questionId} id={`q-${i}`} className={`qa ${a.isCorrect ? '' : 'wrong'}`}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                  {i + 1}. {a.prompt}
                </p>
                <span className={`tag ${a.isCorrect ? 'ok' : 'no'}`}>
                  {a.isCorrect ? t('result.correct') : t('result.wrong')}
                </span>
              </div>
              <p style={{ fontSize: 11, color: 'var(--dim)', margin: '4px 0 0' }}>
                {axisDef(a.category, lang).label}
              </p>
              <div style={{ display: 'grid', gap: 4, marginTop: 10 }}>
                {a.options.map((opt, oi) => {
                  const isCorrect = oi === a.correctIndex
                  const isPicked = oi === a.selectedIndex
                  return (
                    <div
                      key={oi}
                      className={`qa-opt ${isCorrect ? 'correct' : isPicked ? 'picked' : ''}`}
                    >
                      {opt}
                      {isCorrect ? ' ✓' : isPicked ? ` ${t('result.mychoice')}` : ''}
                    </div>
                  )
                })}
              </div>
              {a.explanation ? (
                <p
                  style={{
                    marginTop: 10,
                    background: 'var(--soft)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    fontSize: 13,
                    color: 'var(--muted)',
                  }}
                >
                  💡 {a.explanation}
                </p>
              ) : null}
              <ReportBox attemptId={data.attemptId} questionId={a.questionId} t={t} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// 슬라이드 1: 등급(레벨) 엠블렘 + 승급/강등 연출 + 처방
function RankSlide({ data, pct, t }: { data: ResultResponse; pct: number; t: TFunc }) {
  const rankAfter = data.rankAfter ?? data.level
  const rankBefore = data.rankBefore ?? rankAfter
  const dir = data.rankDir ?? 'stay'
  const warnStrikes = data.warnStrikes ?? 0
  const color = levelColor(rankAfter)
  return (
    <div>
      <div style={{ textAlign: 'center' }}>
        {dir !== 'stay' ? (
          <div className={`tier-change ${dir}`}>
            <span className="tc-label">
              {dir === 'up' ? `🎉 ${t('result.promoted')}` : `⬇ ${t('result.demoted')}`}
            </span>
            <span className="tc-flow">
              Lv.{rankBefore} <span className="tc-arrow">→</span> Lv.{rankAfter}
            </span>
          </div>
        ) : warnStrikes > 0 ? (
          <div className="tier-change down">
            <span className="tc-label">⚠️ {t('result.demote_warn', { n: warnStrikes, max: DEMOTE_STRIKES })}</span>
            <span className="tc-flow">{t('result.demote_warn_sub')}</span>
          </div>
        ) : null}
        <div className={`emblem-pop ${dir === 'up' ? 'promote' : ''}`}>
          <TierEmblem tierKey={emblemKeyForLevel(rankAfter)} size={108} />
        </div>
        <div className="tier-name" style={{ color }}>
          Lv.{rankAfter}
        </div>
        <div className="rating-line">{t('rank.cur_level', { n: rankAfter })}</div>
      </div>
      <Prescription data={data} pct={pct} t={t} />
    </div>
  )
}

// 슬라이드 2: 레이더 — 실선 = 이번 시험 결과(per-test), 음영 = 직전 동레벨 시험(없으면 생략)
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

// 슬라이드 3: 축별 변동 (바 차오름 + 변동 팝업)
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
function Prescription({ data, pct, t }: { data: ResultResponse; pct: number; t: TFunc }) {
  const { lang } = useT()
  const rating = data.rating!
  const axes = axesForLevel(data.level, lang)
  const focusKey = weakestAxis(rating, axes.map((a) => a.key))
  const focus = axisDef(focusKey).short

  let nextLevel: string
  if (pct >= 80) nextLevel = t('rx.next_up', { n: Math.min(data.level + 1, 7) })
  else if (pct < 50) nextLevel = t('rx.next_down', { n: Math.max(data.level - 1, 1) })
  else nextLevel = t('rx.next_same', { n: data.level })

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
        <li>
          <span className="rx-ic">🎚️</span>
          <span>{nextLevel}</span>
        </li>
      </ul>
    </div>
  )
}

// 문항별 오류 제보(인라인). 본인 응시 문항에 한해 submit-report 호출.
function ReportBox({ attemptId, questionId, t }: { attemptId: string; questionId: string; t: TFunc }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  if (state === 'done') {
    return <p style={{ marginTop: 8, fontSize: 12, color: '#16a34a', fontWeight: 600 }}>{t('report.sent')}</p>
  }
  if (!open) {
    return (
      <button
        className="report-link"
        onClick={() => setOpen(true)}
        style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--dim)', fontSize: 12, cursor: 'pointer', padding: 0 }}
      >
        {t('report.btn')}
      </button>
    )
  }
  async function send() {
    if (!msg.trim()) return
    setState('sending')
    try {
      await callFunction('submit-report', { attemptId, questionId, message: msg.trim() })
      setState('done')
    } catch {
      setState('error')
    }
  }
  return (
    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
      <textarea
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        placeholder={t('report.placeholder')}
        rows={2}
        maxLength={1000}
        style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn-ink" onClick={send} disabled={state === 'sending' || !msg.trim()} style={{ padding: '6px 14px', fontSize: 13 }}>
          {t('report.send')}
        </button>
        <button onClick={() => { setOpen(false); setMsg('') }} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 13, cursor: 'pointer' }}>
          {t('report.cancel')}
        </button>
        {state === 'error' ? <span style={{ fontSize: 12, color: '#dc2626' }}>{t('report.fail')}</span> : null}
      </div>
    </div>
  )
}

function ResultNav({ answers, t }: { answers: GradedAnswer[]; t: TFunc }) {
  return (
    <div className="resnav">
      <button className="rn-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        {t('resnav.top')}
      </button>
      <div className="rn-label">{t('resnav.label')}</div>
      <div className="rn-grid">
        {answers.map((a, i) => (
          <button
            key={a.questionId}
            className={`rn-num ${a.isCorrect ? 'ok' : 'no'}`}
            onClick={() => scrollToQ(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}
