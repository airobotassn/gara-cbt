// /test/record — 레벨테스트 내 기록.
//   옛 마이페이지 '학습 대시보드'(components/LearningDashboard.tsx)를 찢어서 온 것 중
//   **레벨테스트 소관**만 모은 화면이다: 스탯 3장(최고레벨·누적응시·평균정답률) · 영역 밸런스 · 승급 기록.
//   같이 있던 나머지는 각자 제 집으로 갔다 — 활동 기록 달력 → /hub(출석 모달) · 랭킹 추이 → /ranking.
//   '내 순위(상위 N%)' 칸은 버렸다: /ranking 아래 내 순위 바가 이미 순위·상위%·점수를 말한다.
//
// 톤은 /test/select · /test/certificate 와 같은 밤하늘(.lvnight) — 세 화면이 한 동네다.
//   ⚠️ 카드들(.stat·.panel-card·.hrow·.axis-prog-cmp)은 **레거시 토큰**(--bg/--line/--blue …)으로
//      그려지는 공용 클래스라 .lvnight 의 Material 토큰 교체만으로는 안 어두워진다.
//      그래서 levelrecord.css 의 `.lvrec` 가 레거시 토큰까지 같이 갈아끼운다(ranking.css 의 .hof-wrap 선례).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { levelColor } from '../lib/scoring'
import { axesForLevel, axisKeysForLevel } from '../lib/categories'
import type { AxisMap } from '../lib/scoring'
import { useT } from '../lib/i18n'
import RadarChartBox from '../components/RadarChartBox'
import type { ListAttemptsResponse, AttemptSummary, LevelSkill } from '../lib/testTypes'

const PAGE_SIZE = 10
// 영역 밸런스 카드의 고정 행 수 = Lv.2 이상의 축 수(6). Lv.1(3축)에서도 카드가 안 줄어들게 빈 행으로 채운다.
const AXIS_ROWS_FIXED = 6

function lpOf(a: AttemptSummary): number {
  if (!a.deltas) return 0
  return Math.round(Object.values(a.deltas).reduce((s, v) => s + v, 0))
}

// 레벨별 6축 평균(더미) — 실제 집계가 들어오기 전 음영 오버레이용.
// 레벨/축마다 결정적이라 재렌더에도 흔들리지 않는다.
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

export default function LevelRecord() {
  const { isFullUser, loading } = useAuth()
  const { t, lang } = useT()
  const [attempts, setAttempts] = useState<AttemptSummary[] | null>(null)
  const [levelSkills, setLevelSkills] = useState<LevelSkill[]>([])
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [radarIdx, setRadarIdx] = useState(0)

  useEffect(() => {
    if (loading) return
    // ⚠️ 비로그인은 **쫓아내지 않는다.** 여기로 오는 길은 /test/select 의 공개 칩이라, 옛 대시보드처럼
    //    메인으로 튕기면 게스트는 버튼을 눌렀는데 이유 없이 랜딩에 떨어진다.
    //    옆자리 인증서(/test/certificate)도 같은 이유로 빈 화면 안내를 보여준다 — 둘을 맞춘다.
    if (!isFullUser) {
      setAttempts([])
      setLevelSkills([])
      return
    }
    callFunction<ListAttemptsResponse>('list-attempts', {})
      .then((r) => {
        setAttempts(r.attempts)
        setLevelSkills(r.levelSkills)
        // 기본 선택 = 현재 등급 레벨(있으면), 없으면 마지막
        const i = r.levelSkills.findIndex((s) => s.level === r.currentRank)
        setRadarIdx(i >= 0 ? i : Math.max(0, r.levelSkills.length - 1))
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('result.load_failed')))
  }, [isFullUser, loading, t])

  const list = useMemo(() => attempts ?? [], [attempts])
  const radar = levelSkills[Math.min(radarIdx, Math.max(0, levelSkills.length - 1))] ?? null
  const radarAvg = radar ? dummyLevelAverage(radar.level) : null // 레벨 평균(음영+상태 공용)

  const avgAcc =
    list.length > 0
      ? Math.round(
          (list.reduce((s, a) => s + a.totalCorrect / a.totalQuestions, 0) / list.length) * 100,
        )
      : 0

  // 승급 기록 — 응시 목록(최신순) 중 **승급한 순간만** 남긴다.
  // 별도 백엔드 없이 list-attempts 의 rankDir/rankAfter 로 만든다(레벨 인증서 목록과 같은 출처).
  const promos = list.filter((a) => a.rankDir === 'up')
  const pageCount = Math.max(1, Math.ceil(promos.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = promos.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="lvnight lvrec text-on-surface min-h-screen relative overflow-x-hidden flex flex-col">
      {/* 하늘 — /test/select 과 같은 레이어(밤하늘 사진 + 비네트). absolute 라 스크롤해도 별이 계속 있다. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[-1]">
        <div className="lvn-sky" />
        <div className="lvn-vig" />
      </div>

      <main className="flex-grow flex flex-col pt-6 pb-4 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full">
        {/* 여기로 들어오는 길이 /test/select 의 '내 기록' 칩 하나뿐이라 뒤로도 거기로 */}
        <Link
          to="/test/select"
          className="lvn-chip self-start inline-flex items-center gap-1.5 mb-4 pl-3 pr-4 py-2 rounded-full font-label-md text-[12.5px] font-bold tracking-[0.06em] transition-colors"
        >
          <span className="text-[15px] leading-none">‹</span>
          {t('lv.title')}
        </Link>

        <div className="flex items-center gap-3 min-w-0 mb-1">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-primary/10 text-primary shrink-0">
            <span className="material-symbols-outlined text-[24px]">timeline</span>
          </span>
          {/* .lvn-display = 크기·굵기만(서체는 화면 공통 Pretendard). /test/select 제목과 한 벌. */}
          <h1 className="lvn-display text-[34px] md:text-[46px] text-on-surface tracking-tight break-keep">
            {t('db.title')}
          </h1>
        </div>

        <div className="wrap db-wrap">
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

          {loading || (!attempts && !error) ? (
            <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
              {t('common.loading')}
            </div>
          ) : list.length === 0 ? (
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
              {/* 통계 3장. 좁은 화면에서는 2열 + 마지막 칸이 한 줄을 다 쓴다(levelrecord.css) —
                  3열을 유지하면 390px 에서 칸이 120px 이 되어 '평균 정답률'이 세 줄로 접힌다. */}
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
              </div>

              {/* 영역 밸런스 — 레벨별 누적 레이더 (‹ › 로 레벨 전환) */}
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
                  {/* 넓은 화면에선 육각형 왼쪽 · 축 막대 오른쪽(levelrecord.css 의 .lvrec-radar).
                      옛 대시보드에선 반 칸짜리 카드라 위아래로 쌓았는데, 여기선 카드가 폭을 다 써서
                      그대로 쌓으면 그림 양옆이 통째로 빈다. */}
                  <div className="lvrec-radar">
                    <div className="lvrec-radar-art">
                      <RadarChartBox
                        axes={axesForLevel(radar.level, lang)}
                        rating={radar.ratings}
                        ghost={radarAvg}
                        maxWidth={440}
                      />
                      {/* 음영 = 이 레벨 응시자 평균(현재는 더미) / 실선 = 내 점수 */}
                      <div className="radar-leg">
                        <span>
                          <i className="rl-me" /> {t('db.radar_me')}
                        </span>
                        <span>
                          <i className="rl-avg" /> {t('db.radar_avg')}
                        </span>
                      </div>
                    </div>
                    <div className="axis-prog axis-prog-cmp">
                      {axesForLevel(radar.level, lang).map((c) => {
                        const v = Math.round(radar.ratings[c.key] ?? 0)
                        const avgVal = radarAvg ? Math.round(radarAvg[c.key] ?? 0) : null
                        const s = avgVal != null ? cmpStatus(v, avgVal) : null
                        return (
                          <div className="ap" key={c.key}>
                            <div className="lab" title={c.short}>
                              {c.short}
                            </div>
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
                      {/* Lv.1 은 3축이라 짧아진다 → Lv.2 이상(6축)과 같은 높이가 되도록 빈 행으로 채운다.
                          (min-height 를 px 로 박으면 글씨 크기·언어에 따라 어긋나므로 실제 행으로 자리를 잡는다) */}
                      {Array.from({
                        length: Math.max(0, AXIS_ROWS_FIXED - axesForLevel(radar.level, lang).length),
                      }).map((_, i) => (
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
                </div>
              ) : null}

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
                          <div className={`chg ${lp >= 0 ? 'up' : 'dn'}`}>{lp >= 0 ? `+${lp}` : lp}</div>
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
      </main>
    </div>
  )
}
