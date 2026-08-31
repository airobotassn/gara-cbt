// 응시 전 안내 게이트 — /test/ready/:level
//
// ⛔ **이 화면은 응시 기록을 만들기 "전" 이다. 순서를 되돌리지 말 것.**
//    예전엔 레벨 선택에서 곧바로 start-test 를 불러 응시를 만들고, 이 안내를 응시 화면(TestRunner)
//    안에서 띄웠다. 그래서 안내만 보고 「취소」를 눌러도 하루 응시 횟수가 이미 1회 깎였다
//    — 문제를 한 개도 못 본 사람이 하루치를 잃었다(2026-08-31 실측: 미제출 249건 전부 0문항).
//
// ⚠️ 문항 뽑기와 횟수 차감은 **한 시점**이어야 한다. 차감만 뒤로 미루고 문항을 먼저 받아두면
//    시작 → 문항 수신 → 취소를 반복해 문제은행을 통째로 긁을 수 있다(start-test 가 하루 제한을
//    두는 이유가 그거다). 그래서 이 화면은 서버를 **안 부르고**, 문항 수·제한시간을 레벨에서
//    직접 계산해 보여준다.
import { useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { enterFullscreen } from '../hooks/useAntiCheatLevel'
import {
  LEVEL_COLORS,
  MAX_VIOLATIONS,
  questionsForLevel,
  durationMinutesForLevel,
} from '../lib/testConfigLevel'
import { MIN_LEVEL, MAX_LEVEL } from '../lib/categories'
import type { StartTestResponse } from '../lib/testTypes'

export default function TestReady() {
  const { level: levelParam } = useParams()
  const navigate = useNavigate()
  const { t, lang } = useT()
  const { ensureAnonymous } = useAuth()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const level = Number(levelParam)
  if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
    navigate('/test/select', { replace: true })
    return null
  }

  const total = questionsForLevel(level)
  const durationMin = durationMinutesForLevel(level)

  // ⚠️ 전체화면을 **맨 먼저** 건다. 브라우저는 클릭 제스처가 살아 있는 동안에만 전체화면을
  //    허락하는데, 서버 응답을 await 하고 나면 그 자격이 풀려 조용히 무시된다.
  async function begin() {
    if (starting) return
    setError(null)
    setStarting(true)
    await enterFullscreen()
    try {
      // 게스트 응시 — 세션이 없으면 익명 세션을 즉석에서 만든다.
      //   결과는 총점만 나가고 누적(등급·6축)에는 안 들어간다(서버 lockedResult 판정).
      await ensureAnonymous()
      const res = await callFunction<StartTestResponse>('start-test', { level, lang })
      // replace = 응시 중 뒤로가기가 이 안내로 되돌아와 두 번째 응시를 만들지 못하게 한다.
      navigate(`/test/${res.attemptId}`, { state: res, replace: true })
    } catch (e) {
      // start-test 는 하루 응시 소진 시 error='daily_limit' 로 429 를 낸다(서버 문구 대신 현지화 문구로).
      const raw = e instanceof Error ? e.message : ''
      setError(raw === 'daily_limit' ? t('lv.daily_limit') : raw || t('lv.start_failed'))
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      setStarting(false)
    }
  }

  return (
    <div className="wrap">
      <div className="card pad intro-gate">
        <div className="intro-ico">⚠️</div>
        <h2 className="sc-title">{t('intro.title')}</h2>
        {/* 응시 레벨 — 흰 숫자 사각 배지는 ⚠️·제목과 무게가 겹쳐 무거웠다. 레벨색은 점과 옅은 배경으로만
            쓰고 글자는 본문색으로 두는 알약 하나(레벨 색 팔레트는 /test/select 와 공유). */}
        <div className="intro-lv" style={{ '--lvc': LEVEL_COLORS[level] } as CSSProperties}>
          <span className="dot" aria-hidden="true" />
          <b>
            Lv.{level} · {t(`lv.${level}.name`)}
          </b>
        </div>
        <div className="intro-anticheat">{t('intro.anticheat')}</div>
        {/* 문항 수·제한시간도 규칙과 같은 행 모양으로 — 예전엔 제목 밑 회색 한 줄이라 잘 안 읽혔다.
            둘은 같은 '시험 규격'이라 한 행에 묶는다(규칙 4줄과 섞이면 무엇이 규칙인지 흐려진다). */}
        <ul className="intro-rules">
          <li>
            <span className="ic">📝</span>
            {t('intro.fact_q', { q: total })} · {t('intro.fact_min', { min: durationMin })}
          </li>
          <li>
            <span className="ic">🖥️</span>
            {t('intro.fullscreen')}
          </li>
          <li>
            <span className="ic">🚪</span>
            {t('intro.rule_exit')}
          </li>
          <li>
            <span className="ic">📋</span>
            {t('intro.rule_block')}
          </li>
          <li>
            <span className="ic">🚫</span>
            {t('intro.rule_void', { m: MAX_VIOLATIONS })}
          </li>
        </ul>
        {error ? (
          <p style={{ color: 'var(--danger-fg)', fontSize: 14, margin: '4px 0 0' }}>{error}</p>
        ) : null}
        <div className="intro-actions">
          <button
            className="btn-ghost"
            disabled={starting}
            onClick={() => navigate('/test/select')}
          >
            {t('intro.cancel')}
          </button>
          <button className="btn-ink" onClick={begin} disabled={starting}>
            {starting ? t('lv.preparing') : t('intro.start')}
          </button>
        </div>
      </div>
    </div>
  )
}
