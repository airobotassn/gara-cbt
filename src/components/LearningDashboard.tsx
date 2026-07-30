import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { levelColor, computeSkillScore, tierColor, TIER_ORDER } from '../lib/scoring'
import { axesForLevel, axisKeysForLevel } from '../lib/categories'
import type { AxisMap, Tier } from '../lib/scoring'
import { useT } from '../lib/i18n'
import RadarChartBox from '../components/RadarChartBox'
import LineChart from '../components/LineChart'
import TierBadge from '../components/TierBadge'
import ContributionGraph from '../components/ContributionGraph'
import type { ListAttemptsResponse, AttemptSummary, LevelSkill } from '../lib/testTypes'

const PAGE_SIZE = 10
// 영역 밸런스 카드의 고정 행 수 = Lv.2 이상의 축 수(6). Lv.1(3축)에서도 카드가 안 줄어들게 빈 행으로 채운다.
const AXIS_ROWS_FIXED = 6
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 랭킹 추이 기간. 시즌 = 6개월(별도 시즌 시작일 개념이 백엔드에 없어 최근 180일로 본다).
type TrendRange = '1w' | '3m' | 'season'
const TREND_DAYS: Record<TrendRange, number> = { '1w': 7, '3m': 90, season: 180 }
const TREND_TABS: { key: TrendRange; label: string }[] = [
  { key: '1w', label: 'db.trend_1w' },
  { key: '3m', label: 'db.trend_3m' },
  { key: 'season', label: 'db.trend_season' },
]

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
  const [, setPoints] = useState(0)
  const [levelSkills, setLevelSkills] = useState<LevelSkill[]>([])
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [radarIdx, setRadarIdx] = useState(0)
  const [trendRange, setTrendRange] = useState<TrendRange>('season') // 기본 = 시즌(6개월) 전체 흐름
  // 기간 자르기 기준 시각은 화면 진입 때 한 번만 고정한다(렌더마다 Date.now() 를 읽으면 순수하지 않다).
  const [nowTs] = useState(() => Date.now())
  // 티어 히어로(시즌 총점/실력·활동 분해/다음 순위 게이지) — get-hub 응답 중 이 화면이 쓰는 것만.
  const [tier, setTier] = useState<Tier | null>(null)
  const [percentile, setPercentile] = useState<number | null>(null)
  const [, setSeasonTotal] = useState<number | null>(null)
  const [, setSkillScore] = useState<number | null>(null)
  const [, setActivityScore] = useState<number | null>(null)
  const [pointsToPass, setPointsToPass] = useState<number | null>(null)
  const [attendanceDays, setAttendanceDays] = useState<string[]>([]) // 활동 기록 달력(출석만)

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
      attendanceDays?: string[] | null
    }>('get-hub', {})
      .then((h) => {
        setTier((h.tier as Tier | null) ?? null)
        setPercentile(h.percentile ?? null)
        setSeasonTotal(h.seasonTotal ?? null)
        setSkillScore(h.skillScore ?? null)
        setActivityScore(h.activityScore ?? null)
        setPointsToPass(h.pointsToPass ?? null)
        setAttendanceDays(h.attendanceDays ?? [])
      })
      .catch(() => {})
  }, [isFullUser, loading, navigate, t])

  const list = useMemo(() => attempts ?? [], [attempts]) // 추이 memo 의 의존성이라 참조를 고정
  const radar = levelSkills[Math.min(radarIdx, Math.max(0, levelSkills.length - 1))] ?? null
  const radarAvg = radar ? dummyLevelAverage(radar.level) : null // 레벨 평균(음영+상태 공용)

  const monthTick = (m: number) =>
    lang === 'en' ? EN_MONTHS[m - 1] : lang === 'ja' ? `${m}月` : `${m}월`

  // 실력점수(레벨가중, 0~10000) 추이: 응시마다 그 시점 등급 + 그 등급 최신 맞힌수로 환산
  // (computeSkillScore — scoring.ts 단일 출처, computePoints 아님). 시즌 총점 자체의 이력은 없어
  // 히어로에 현재 seasonTotal 단일 값으로 별도 표시한다.
  //
  // 점수 계산은 **항상 전체 이력**으로 돌린다(기간을 좁혔다고 과거 점수가 달라지면 안 되므로),
  // 그 다음 고른 기간만 잘라낸다. x 위치는 개수가 아니라 **응시 시각**이라(주식 차트와 같은 시간축)
  // 3개월을 고르면 3개월치 축 위 실제 날짜 자리에 점이 찍히고, 응시가 없던 구간은 비어 보인다.
  const trendFrom = nowTs - TREND_DAYS[trendRange] * 86400000
  const trend = useMemo(() => {
    const latestCorrect: Record<number, number> = {}
    return [...list]
      .reverse()
      .map((a) => {
        const dt = new Date(a.submittedAt)
        latestCorrect[a.level] = a.totalCorrect
        const rank = a.rankAfter ?? a.level
        return {
          v: computeSkillScore(rank, latestCorrect[rank] ?? a.totalCorrect),
          t: dt.getTime(),
          date: dt.toLocaleDateString(),
        }
      })
      .filter((p) => p.t >= trendFrom)
  }, [list, trendFrom])

  // x축 눈금 — 1주일은 하루 간격(M/D), 3개월·시즌은 월 시작(월 이름).
  const trendTicks = useMemo(() => {
    const out: { t: number; label: string }[] = []
    if (trendRange === '1w') {
      const d = new Date(trendFrom)
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() + 1)
      for (; d.getTime() <= nowTs; d.setDate(d.getDate() + 1)) {
        out.push({ t: d.getTime(), label: `${d.getMonth() + 1}/${d.getDate()}` })
      }
    } else {
      const d = new Date(trendFrom)
      d.setHours(0, 0, 0, 0)
      d.setDate(1)
      d.setMonth(d.getMonth() + 1) // 구간 안에 온전히 들어오는 달의 1일부터
      for (; d.getTime() <= nowTs; d.setMonth(d.getMonth() + 1)) {
        out.push({ t: d.getTime(), label: monthTick(d.getMonth() + 1) })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendRange, trendFrom, nowTs, lang])


  if (loading || (!attempts && !error)) {
    return (
      <div className="wrap db-wrap">
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

  // 활동 기록 달력 = **출석만**(2026-07-29 결정). 응시·학습·미니게임은 찍지 않는다.
  //   출처 = get-hub 의 attendanceDays(daily_activity.did_attendance, 최근 1년).
  const days = new Set(attendanceDays)

  // 승급 기록 — 옛 '응시 기록'을 대체한다. 응시 목록(list, 최신순) 중 **승급한 순간만** 남긴다.
  // 별도 백엔드 없이 list-attempts 의 rankDir/rankAfter 로 만든다(레벨 인증서 목록과 같은 출처).
  const promos = list.filter((a) => a.rankDir === 'up')
  const pageCount = Math.max(1, Math.ceil(promos.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = promos.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    // db-wrap = 대시보드 전용 스케일(폭 1024px + 글씨/여백 한 단계 위). dashboard.css 참고.
    <div className="wrap db-wrap">
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
            <TierBadge tier={tier ?? 'bronze'} size={64} alt={t(`rank.tier_${tier ?? 'bronze'}`)} />
            <div>
              <div className="nm" style={{ color: tierColor(tier ?? 'bronze') }}>
                {t(`rank.tier_${tier ?? 'bronze'}`)}
              </div>
              <div className="sub">{t('db.cur_rank', { n: list.length })}</div>
              <div className="sub">
                {t('rank.top', { p: Math.max(1, Math.round((percentile ?? 1) * 100)) })}
                {pointsToPass != null && pointsToPass > 0 ? ` · ${t('rank.next_gap', { n: pointsToPass })}` : ''}
              </div>
            </div>

            {/* 티어 사다리 — 브론즈→다이아 순, 내 티어만 원색+테두리, 나머지는 흑백 */}
            <div className="tierlad">
              {TIER_ORDER.map((k) => {
                const on = (tier ?? 'bronze') === k
                return (
                  <div
                    key={k}
                    className={on ? 'it on' : 'it'}
                    style={on ? { ['--tc' as string]: tierColor(k) } : undefined}
                    aria-current={on ? 'true' : undefined}
                  >
                    <TierBadge tier={k} size={40} dim={!on} />
                    <span className="nm">{t(`rank.tier_${k}`)}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* (강등 경고 배너는 강등 제거로 삭제됐다 — 등급은 오르거나 유지만 된다) */}

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

          {/* 점수 추이 — 1주일 / 3개월 / 시즌(6개월) */}
          <div className="panel-card">
            <div className="ph">
              <div className="t">{t('db.trend_title')}</div>
              <div className="trend-seg" role="tablist" aria-label={t('db.trend_title')}>
                {TREND_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={trendRange === tab.key}
                    className={trendRange === tab.key ? 'on' : ''}
                    title={tab.key === 'season' ? t('db.trend_season_hint') : undefined}
                    onClick={() => setTrendRange(tab.key)}
                  >
                    {t(tab.label)}
                  </button>
                ))}
              </div>
            </div>
            <div className="ph" style={{ marginTop: -6 }}>
              <div className="leg">{t('db.recent_n', { n: trend.length })}</div>
              {trendRange === 'season' ? <div className="leg">{t('db.trend_season_hint')}</div> : null}
            </div>
            <LineChart data={trend} from={trendFrom} to={nowTs} ticks={trendTicks} emptyText={t('db.trend_empty')} height={250} />
          </div>

          {/* 활동 잔디 + 레벨별 레이더 — 둘 다 카드 폭을 다 쓰지 않아 넓은 화면에선 나란히 둔다.
              (좁아지면 db-duo 의 auto-fit 이 알아서 한 줄씩으로 내린다) */}
          <div className="db-duo">
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
                maxWidth={440}
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
                      <div className="lab" title={c.short}>{c.short}</div>
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
                {/* Lv.1 은 3축이라 카드가 짧아진다 → Lv.2 이상(6축)과 같은 높이가 되도록 빈 행으로 채운다.
                    (min-height 를 px 로 박으면 글씨 크기·언어에 따라 어긋나므로 실제 행으로 자리를 잡는다) */}
                {Array.from({ length: Math.max(0, AXIS_ROWS_FIXED - axesForLevel(radar.level, lang).length) }).map((_, i) => (
                  <div className="ap ap-ghost" key={`ghost${i}`} aria-hidden="true">
                    <div className="lab">-</div>
                    <div className="track" />
                    {/* 실제 행과 같은 구조여야 높이가 정확히 같아진다(상태 배지 포함) */}
                    <div className="val">
                      <b>0</b>
                      <span className="ap-status avg">
                        <span className="ap-emoji">😐</span>
                        <span className="ap-vs">-</span>
                        <span className="ap-diff">0</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            ) : null}
          </div>

          {/* 승급 기록 (페이징) — 승급한 응시만. 유지된 응시는 목록에 없다. */}
          <div className="panel-card">
            <div className="ph">
              <div className="t">{t('db.promo_title')}</div>
              <div className="leg">{t('db.promo_total_n', { n: promos.length })}</div>
            </div>
            {promos.length === 0 ? (
              <p className="promo-empty">{t('db.promo_empty')}</p>
            ) : (
              <div className="hist">
                {pageItems.map((a) => {
                  const lp = lpOf(a)
                  const to = a.rankAfter ?? a.level
                  const from = Math.max(1, to - 1) // 승급은 항상 한 단계(computeRankChange)
                  const col = levelColor(to)
                  return (
                    <Link key={a.attemptId} to={`/test/result/${a.attemptId}`} className="hrow">
                      <div className="lv" style={{ color: col }}>
                        {to}
                      </div>
                      <div className="meta">
                        <div className="dt">
                          Lv.{from} → Lv.{to}
                          <span className="promo-chip">▲ {t('result.promoted')}</span>
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
            )}
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
