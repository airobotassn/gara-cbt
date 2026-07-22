import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { MAX_LEVEL, QUESTIONS_PER_TEST, COMING_SOON_LEVELS } from '../lib/testConfigLevel'
import { promoteCut, DEMOTE_MAX, DEMOTE_STRIKES } from '../lib/scoring'
import { useT } from '../lib/i18n'
import TopBar from '../components/TopBar'
import type { StartTestResponse, ListAttemptsResponse } from '../lib/testTypes'

const LEVEL_COLORS: Record<number, string> = {
  1: '#86efac',
  2: '#5fd98a',
  3: '#d6c534',
  4: '#e0a526',
  5: '#f08a3f',
  6: '#ef6b5f',
  7: '#e0443a',
}

export default function LevelSelect() {
  const navigate = useNavigate()
  const location = useLocation()
  const { ensureAnonymous, isFullUser } = useAuth()
  const { t, lang } = useT()
  const [loading, setLoading] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 해금된 최고 레벨 = 현재 등급(rank). 게스트/첫 유저 = 1. 승급 시 한 단계씩 해제.
  const [unlocked, setUnlocked] = useState(1)

  // 메인(랜딩)에서 검색 추천을 받고 넘어온 경우. 해금 범위 안일 때만 강조.
  const navState = location.state as
    | { recommendedLevel?: number; alt?: number | null }
    | null
  const searchRec =
    navState?.recommendedLevel != null
      ? { level: navState.recommendedLevel, alt: navState.alt ?? null }
      : null

  useEffect(() => {
    if (!isFullUser) {
      setUnlocked(1)
      return
    }
    // 관리자는 문항 확인용으로 전 레벨 해금(서버 start-test 도 면제).
    callFunction<{ isAdmin: boolean }>('admin', { action: 'me' })
      .then(() => setUnlocked(MAX_LEVEL))
      .catch(() => {
        callFunction<ListAttemptsResponse>('list-attempts', {})
          .then(({ currentRank }) => setUnlocked(currentRank ?? 1))
          .catch(() => {})
      })
  }, [isFullUser])

  // 추천 태그. 검색 추천이 해금 범위 안이면 우선, 아니면 현재 해금 최고 레벨(=승급 도전 레벨)을 추천.
  const recMap = new Map<number, string>()
  let bannerText: string | null = null
  if (searchRec && searchRec.level <= unlocked) {
    recMap.set(searchRec.level, t('lv.tag_rec'))
    if (searchRec.alt && searchRec.alt <= unlocked) recMap.set(searchRec.alt, t('lv.tag_challenge'))
    bannerText =
      t('reco.result', {
        n: searchRec.level,
        name: t(`lv.${searchRec.level}.name`),
      }) + (searchRec.alt ? t('reco.result_alt', { n: searchRec.alt }) : '')
  }
  if (recMap.size === 0) recMap.set(unlocked, t('lv.tag_rec'))

  // 승급/강등 규칙 안내(숫자는 scoring 임계값에서 읽어 자동 동기화)

  async function start(level: number) {
    setError(null)
    setLoading(level)
    try {
      await ensureAnonymous()
      const res = await callFunction<StartTestResponse>('start-test', { level, lang })
      navigate(`/test/${res.attemptId}`, { state: res })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lv.start_failed'))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="wrap">
      {/* 레벨테스트는 아레나에서 들어오는 화면 — 뒤로가기도 아레나로 */}
      <TopBar to="/arena" label={t('common.leveltest')} />
      <div className="card pad">
        {/* 랭킹 진입점은 /hub 도크 CTA 로 옮겼다(레벨선택 화면에서는 제거). */}
        <div className="lv-head">
          <h2 className="sc-title">{t('lv.title')}</h2>
        </div>

        <div className="lv-rule">
          <div className="lv-rule-head">
            <span>ⓘ {t('lv.rule_btn')}</span>
            <span className="lv-rule-q">{t('lv.rule_head', { q: QUESTIONS_PER_TEST })}</span>
          </div>
          <ul>
            <li className="up">▲ {t('lv.rule_up', { p1: promoteCut(1), p2: promoteCut(4), q: QUESTIONS_PER_TEST })}</li>
            <li className="down">▼ {t('lv.rule_down', { d: DEMOTE_MAX, n: DEMOTE_STRIKES })}</li>
          </ul>
          <p className="lv-rule-note">{t('lv.rule_note', { max: MAX_LEVEL })}</p>
          {!isFullUser ? (
            <p className="lv-rule-login">🔒 {t('lv.login_to_save')}</p>
          ) : null}
        </div>

        {bannerText ? <div className="reco-banner">✨ {bannerText}</div> : null}

        {error ? (
          <div
            style={{
              marginBottom: 18,
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

        <div className="ladder">
          {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((n) => {
            const c = LEVEL_COLORS[n]
            const soon = COMING_SOON_LEVELS.includes(n) // 문제은행 준비 중 → 응시 차단
            const locked = n > unlocked
            const tag = locked || soon ? undefined : recMap.get(n)
            return (
              <button
                key={n}
                className={`step ${tag ? 'rec' : ''} ${locked || soon ? 'locked' : ''}`}
                disabled={loading !== null || locked || soon}
                onClick={() => start(n)}
                title={locked ? t('lv.locked_hint') : undefined}
              >
                <span className="num" style={locked || soon ? undefined : { background: c }}>
                  {locked ? '🔒' : soon ? '⏳' : n}
                </span>
                <span className="body">
                  <span className="name">
                    Lv.{n} {t(`lv.${n}.name`)}
                    {tag ? <span className="rec-tag">{tag}</span> : null}
                    <span className="diffword">{t(`lv.${n}.desc`)}</span>
                  </span>
                  <span className="meter">
                    {Array.from({ length: 7 }, (_, i) => (
                      <i key={i} style={i < n && !locked ? { background: c } : undefined} />
                    ))}
                  </span>
                </span>
                <span className="go">
                  {locked
                    ? t('lv.locked')
                    : soon
                      ? t('lv.coming_soon')
                      : loading === n
                        ? t('lv.preparing')
                        : t('lv.select')}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
