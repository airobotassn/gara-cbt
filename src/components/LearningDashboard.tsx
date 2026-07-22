import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { levelColor, DEMOTE_STRIKES, computeSkillScore, tierColor } from '../lib/scoring'
import { axesForLevel, axisKeysForLevel } from '../lib/categories'
import type { AxisMap, Tier } from '../lib/scoring'
import { useT } from '../lib/i18n'
import RadarChartBox from '../components/RadarChartBox'
import LineChart from '../components/LineChart'
import TierEmblem from '../components/TierEmblem'
import ContributionGraph from '../components/ContributionGraph'
import type { ListAttemptsResponse, AttemptSummary, LevelSkill } from '../lib/testTypes'

const PAGE_SIZE = 10
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function lpOf(a: AttemptSummary): number {
  if (!a.deltas) return 0
  return Math.round(Object.values(a.deltas).reduce((s, v) => s + v, 0))
}

// 레벨별 6축 평균(더미) — 실제 집계가 들어오기 전 음영 오버레이용.
// 레벨/축마다 결정적이라 재렌더에도 흔들리지 않음(대시보드 레이더 전용).
function dummyLevelAverage(level: number): AxisMap {
  const out: AxisMap = {}
  axisKeysForLevel(level).forEach((k, i) => {
    const seed = level * 7 + i * 13
    out[k] = 40 + ((seed * 17) % 28) // 40~67 사이
  })
  return out
}

// 내 점수 vs 레벨 평균 → 상태(이모지) + 평균대비 차이(diff). 평균 ±6점 밴드로 색 결정.
function cmpStatus(mine: number, avg: number): { state: 'above' | 'avg' | 'below'; emoji: string; diff: number } {
  const diff = Math.round(mine - avg)
  if (diff >= 6) return { state: 'above', emoji: '😄', diff }
  if (diff <= -6) return { state: 'below', emoji: '😥', diff }
  return { state: 'avg', emoji: '😐', diff }
}

export default function LearningDashboard() {
  const { isFullUser, loading } = useAuth()
  const { t, lang } = useT()
  const navigate = useNavigate()
  const [attempts, setAttempts] = useState<AttemptSummary[] | null>(null)
  const [, setCurrentRank] = useState<number | null>(null)
  const [points, setPoints] = useState(0)
  const [strikes, setStrikes] = useState(0)
  const [levelSkills, setLevelSkills] = useState<LevelSkill[]>([])
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [radarIdx, setRadarIdx] = useState(0)
  // 티어 히어로(시즌 총점/실력·활동 분해/다음 순위 게이지) — get-hub 응답 중 이 화면이 쓰는 것만.
  const [tier, setTier] = useState<Tier | null>(null)
  const [percentile, setPercentile] = useState<number | null>(null)
  const [seasonTotal, setSeasonTotal] = useState<number | null>(null)
  const [skillScore, setSkillScore] = useState<number | null>(null)
  const [activityScore, setActivityScore] = useState<number | null>(null)
  const [pointsToPass, setPointsToPass] = useState<number | null>(null)

  useEffect(() => {
    if (loading) return
    if (!isFullUser) {
      navigate('/', { replace: true })
      return
    }
    callFunction<ListAttemptsResponse>('list-attempts', {})
      .then((r) => {
        setAttempts(r.attempts)
        setCurrentRank(r.currentRank)
        setPoints(r.currentPoints ?? 0)
        setStrikes(r.demotionStrikes ?? 0)
        setLevelSkills(r.levelSkills)
        // 기본 선택 = 현재 등급 레벨(있으면), 없으면 마지막
        const i = r.levelSkills.findIndex((s) => s.level === r.currentRank)
        setRadarIdx(i >= 0 ? i : Math.max(0, r.levelSkills.length - 1))
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('result.load_failed')))
    // 티어/시즌 총점/실력·활동 분해/다음 순위 게이지 — get-hub 가 단일 출처(Hub 와 동일 호출).
    // 실패해도 무시(back-compat: 히어로가 레벨 기반 표시로 폴백).
    callFunction<{
      tier?: string | null
      percentile?: number | null
      seasonTotal?: number | null
      skillScore?: number | null
      activityScore?: number | null
      pointsToPass?: number | null
    }>('get-hub', {})
      .then((h) => {
        setTier((h.tier as Tier | null) ?? null)
        setPercentile(h.percentile ?? null)
        setSeasonTotal(h.seasonTotal ?? null)
        setSkillScore(h.skillScore ?? null)
        setActivityScore(h.activityScore ?? null)
        setPointsToPass(h.pointsToPass ?? null)
      })
      .catch(() => {})
  }, [isFullUser, loading, navigate, t])

  const list = attempts ?? []
  const radar = levelSkills[Math.min(radarIdx, Math.max(0, levelSkills.length - 1))] ?? null
  const radarAvg = radar ? dummyLevelAverage(radar.level) : null // 레벨 평균(음영+상태 공용)

  const monthTick = (m: number) =>
    lang === 'en' ? EN_MONTHS[m - 1] : lang === 'ja' ? `${m}月` : `${m}월`

  // 실력점수(레벨가중, 0~10000) 추이: 응시마다 그 시점 등급 + 그 등급 최신 맞힌수로 환산
  // (computeSkillScore — scoring.ts 단일 출처, computePoints 아님). 시즌 총점 자체의 이력은 없어
  // 히어로에 현재 seasonTotal 단일 값으로 별도 표시한다.
  const trend = useMemo(() => {
    let last = -1
    const latestCorrect: Record<number, number> = {}
    return [...list].reverse().map((a) => {
      const dt = new Date(a.submittedAt)
      const m = dt.getMonth() + 1
      const tick = m !== last ? monthTick(m) : undefined
      last = m
      latestCorrect[a.level] = a.totalCorrect
      const rank = a.rankAfter ?? a.level
      const pts = computeSkillScore(rank, latestCorrect[rank] ?? a.totalCorrect)
      return { v: pts, date: dt.toLocaleDateString(), tick }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, lang])


  if (loading || (!attempts && !error)) {
    return (
      <div className="wrap">
        <div className="card pad" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          {t('common.loading')}
        </div>
      </div>
    )
  }

  const avgAcc =
    list.length > 0
      ? Math.round(
          (list.reduce((s, a) => s + a.totalCorrect / a.totalQuestions, 0) / list.length) * 100,
        )
      : 0

  // TODO(#5 미구현): 잔디는 현재 레벨테스트 응시(list)만으로 채워 leveltest(금색) 활동만 표시한다.
  //   attendance/learn/minigame 은 get-hub 가 activity_ledger+daily_activity 기반 일별 breakdown 을
  //   반환해야 여기서 dominant 색이 정확해진다(현재 get-hub 응답에 그 필드가 없음 — 생산자 미배선).
  const days = new Map<string, number>()
  for (const a of list) {
    const d = new Date(a.submittedAt)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    days.set(k, Math.max(days.get(k) ?? 0, a.level))
  }

  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = list.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="wrap">
      <div className="db-head">
        <div className="h">{t('db.title')}</div>
      </div>

      {error ? (
        <div
          style={{
            marginTop: 14,
            borderRadius: 12,
            background: 'var(--danger-bg)',
            color: 'var(--danger-fg)',
            fontSize: 13,
            padding: '10px 14px',
          }}
        >
          {error}
        </div>
      ) : null}

      {list.length === 0 ? (
        <div className="panel-card" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('db.empty')}</p>
          <Link
            to="/test/select"
            className="btn-ink"
            style={{ display: 'inline-block', marginTop: 14, textDecoration: 'none' }}
          >
            {t('db.start')}
          </Link>
        </div>
      ) : (
        <>
          {/* 티어 히어로: 현재 티어 + 시즌 총점(실력/활동 분해) + 다음 순위 게이지(요약) */}
          <div className="tierhero">
            <TierEmblem tierKey={tier ?? 'bronze'} size={64} />
            <div>
              <div className="nm" style={{ color: tierColor(tier ?? 'bronze') }}>
                {t(`rank.tier_${tier ?? 'bronze'}`)}
              </div>
              <div className="sub">{t('db.cur_rank', { n: list.length })}</div>
              <div className="sub" style={{ fontWeight: 700, color: 'var(--ink)' }}>
                {t('db.points', { p: (seasonTotal ?? points).toLocaleString() })}
              </div>
              {skillScore != null || activityScore != null ? (
                <div className="sub" style={{ display: 'flex', gap: 10 }}>
                  <span>{t('db.skill_score')} {(skillScore ?? 0).toLocaleString()}</span>
                  <span>{t('db.activity_score')} {(activityScore ?? 0).toLocaleString()}</span>
                </div>
              ) : null}
              <div className="sub">
                {t('rank.top', { p: Math.max(1, Math.round((percentile ?? 1) * 100)) })}
                {pointsToPass != null && pointsToPass > 0 ? ` · ${t('rank.next_gap', { n: pointsToPass })}` : ''}
              </div>
            </div>

          </div>

          {/* 강등 경고 */}
          {strikes > 0 ? (
            <div
              style={{
                marginTop: 12,
                borderRadius: 12,
                background: 'var(--danger-bg)',
                color: 'var(--danger-fg)',
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 14px',
              }}
            >
              ⚠️ {t('result.demote_warn', { n: strikes, max: DEMOTE_STRIKES })} — {t('db.warn_hint')}
            </div>
          ) : null}

          {/* 통계 */}
          <div className="stats">
            <div className="stat">
              <div className="k">{t('db.stat_maxlevel')}</div>
              <div className="v">Lv.{Math.max(...list.map((a) => a.level))}</div>
              <div className="d" style={{ color: 'var(--muted)' }}>
                {t('db.stat_maxlevel_d')}
              </div>
            </div>
            <div className="stat">
              <div className="k">{t('db.stat_attempts')}</div>
              <div className="v">
                {list.length}
                <span style={{ fontSize: 14, color: 'var(--dim)' }}>{t('db.unit_times')}</span>
              </div>
              <div className="d" style={{ color: 'var(--muted)' }}>
                {t('db.recent', { d: new Date(list[0].submittedAt).toLocaleDateString() })}
              </div>
            </div>
            <div className="stat">
              <div className="k">{t('db.stat_avgacc')}</div>
              <div className="v">{avgAcc}%</div>
              <div className="d" style={{ color: 'var(--muted)' }}>
                {t('db.recent_n', { n: list.length })}
              </div>
            </div>
            <div className="stat">
              <div className="k">{t('rank.my_tier')}</div>
              <div className="v" style={{ color: tierColor(tier ?? 'bronze') }}>
                {t(`rank.tier_${tier ?? 'bronze'}`)}
              </div>
              <div className="d" style={{ color: 'var(--muted)' }}>
                {t('rank.top', { p: Math.max(1, Math.round((percentile ?? 1) * 100)) })}
              </div>
            </div>
          </div>

          {/* 점수 추이 */}
          <div className="panel-card">
            <div className="ph">
              <div className="t">{t('db.trend_title')}</div>
              <div className="leg">{t('db.recent_n', { n: trend.length })}</div>
            </div>
            <LineChart data={trend} />
          </div>

          {/* 활동 잔디 */}
          <div className="panel-card">
            <div className="ph">
              <div className="t">{t('db.activity_title')}</div>
            </div>
            <ContributionGraph days={days} />
          </div>

          {/* 레벨별 누적 레이더 (화살표 전환) */}
          {radar ? (
            <div className="panel-card">
              <div className="ph">
                <div className="t">{t('db.radar_title')} · Lv.{radar.level}</div>
                <div className="leg" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    className="hl-arrow"
                    style={{ width: 28, height: 28 }}
                    onClick={() => setRadarIdx((i) => Math.max(0, i - 1))}
                    disabled={radarIdx <= 0}
                  >
                    ‹
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {Math.min(radarIdx, levelSkills.length - 1) + 1}/{levelSkills.length}
                  </span>
                  <button
                    className="hl-arrow"
                    style={{ width: 28, height: 28 }}
                    onClick={() => setRadarIdx((i) => Math.min(levelSkills.length - 1, i + 1))}
                    disabled={radarIdx >= levelSkills.length - 1}
                  >
                    ›
                  </button>
                </div>
              </div>
              <RadarChartBox
                axes={axesForLevel(radar.level, lang)}
                rating={radar.ratings}
                ghost={radarAvg}
              />
              {/* 음영 = 이 레벨 응시자 평균(현재는 더미) / 실선 = 내 점수 */}
              <div className="radar-leg">
                <span><i className="rl-me" /> {t('db.radar_me')}</span>
                <span><i className="rl-avg" /> {t('db.radar_avg')}</span>
              </div>
              <div className="axis-prog axis-prog-cmp" style={{ marginTop: 8 }}>
                {axesForLevel(radar.level, lang).map((c) => {
                  const v = Math.round(radar.ratings[c.key] ?? 0)
                  const avgVal = radarAvg ? Math.round(radarAvg[c.key] ?? 0) : null
                  const s = avgVal != null ? cmpStatus(v, avgVal) : null
                  return (
                    <div className="ap" key={c.key}>
                      <div className="lab">{c.short}</div>
                      <div className="track">
                        <div className="fill" style={{ width: `${v}%` }} />
                        {avgVal != null ? (
                          <div
                            className="avgfill"
                            style={{ width: `${Math.max(0, Math.min(100, avgVal))}%` }}
                            title={`${t('db.radar_avg')} ${avgVal}`}
                          />
                        ) : null}
                      </div>
                      <div className="val">
                        <b>{v}</b>
                        {s ? (
                          <span className={`ap-status ${s.state}`}>
                            <span className="ap-emoji">{s.emoji}</span>
                            <span className="ap-vs">{t('db.vs_avg')}</span>
                            <span className="ap-diff">{s.diff >= 0 ? `+${s.diff}` : s.diff}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {/* 응시 기록 (페이징) */}
          <div className="panel-card">
            <div className="ph">
              <div className="t">{t('db.history_title')}</div>
              <div className="leg">{t('db.total_n', { n: list.length })}</div>
            </div>
            <div className="hist">
              {pageItems.map((a) => {
                const lp = lpOf(a)
                const col = levelColor(a.level)
                return (
                  <Link key={a.attemptId} to={`/test/result/${a.attemptId}`} className="hrow">
                    <div className="lv" style={{ color: col }}>
                      {a.level}
                    </div>
                    <div className="meta">
                      <div className="dt">
                        Lv.{a.level}
                        {a.rankDir === 'up'
                          ? ` · ▲${t('result.promoted')}`
                          : a.rankDir === 'down'
                            ? ` · ▼${t('result.demoted')}`
                            : ''}
                      </div>
                      <div className="sb">
                        {new Date(a.submittedAt).toLocaleDateString()} ·{' '}
                        {t('db.hist_correct', { a: a.totalCorrect, t: a.totalQuestions })}
                      </div>
                    </div>
                    <div className="sc2">
                      {a.totalCorrect}/{a.totalQuestions}
                    </div>
                    <div className={`chg ${lp >= 0 ? 'up' : 'dn'}`}>
                      {lp >= 0 ? `+${lp}` : lp}
                    </div>
                  </Link>
                )
              })}
            </div>
            {pageCount > 1 ? (
              <div className="pager">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>
                  ‹
                </button>
                <span className="pinfo">
                  {safePage + 1} / {pageCount}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage >= pageCount - 1}
                >
                  ›
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
