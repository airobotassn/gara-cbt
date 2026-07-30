// /test/select — 레벨 선택(D안: 결정 중심).
//   화면 구성: 헤더 → '지금 도전' 응시 카드 1장 → 7단 사다리 스트립(위치만) → 지난 레벨 접이식 → SiteFooter.
//   왜 목록이 아닌가: 내 등급보다 높은 레벨은 서버(start-test)가 403 으로 막고, 낮은 레벨은 잘 봐도
//   승급이 안 된다(승급 조건 = 응시레벨 ≥ 내 등급). 즉 실질 선택지가 사실상 1개라 7장을 늘어놓을 이유가 없다.
//   디자인 토큰은 최신 페이지(/notice·/ebooks)와 동일(Material). 레벨 색만 이 화면 전용 팔레트.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import {
  MAX_LEVEL,
  COMING_SOON_LEVELS,
  DAILY_ATTEMPTS_BASE,
  LEVEL_COLORS,
  questionsForLevel,
  durationMinutesForLevel,
} from '../lib/testConfigLevel'
import { PROMOTE_RATE_LOW, PROMOTE_RATE_HIGH, promoteCut } from '../lib/scoring'
import { useT } from '../lib/i18n'
import SiteFooter from '../components/SiteFooter'
import type { StartTestResponse, ListAttemptsResponse } from '../lib/testTypes'

// 레벨 색(LEVEL_COLORS)은 응시 전 경고 화면과 공유 → lib/testConfigLevel.ts 가 단일 출처.

export default function LevelSelect() {
  const navigate = useNavigate()
  const location = useLocation()
  const { ensureAnonymous, isFullUser } = useAuth()
  const { t, lang } = useT()
  const [loading, setLoading] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ruleOpen, setRuleOpen] = useState(false) // 등급 규칙 접기(기본 접힘)
  // 해금된 최고 레벨 = 현재 등급(rank). 게스트/첫 유저 = 1. 승급 시 한 단계씩 해제.
  const [unlocked, setUnlocked] = useState(1)
  // 사다리에서 직접 고른 레벨(null = 기본값인 '내 등급'을 따름)
  const [picked, setPicked] = useState<number | null>(null)
  // 오늘 남은 응시 횟수(서버 계산). 게스트/미지원이면 null → 표시 생략.
  const [dailyLeft, setDailyLeft] = useState<number | null>(null)

  // 메인(랜딩)에서 검색 추천을 받고 넘어온 경우. 해금 범위 안일 때만 반영.
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
      setDailyLeft(null)
      return
    }
    // 관리자는 문항 확인용으로 전 레벨 해금(서버 start-test 도 면제).
    callFunction<{ isAdmin: boolean }>('admin', { action: 'me' })
      .then(() => setUnlocked(MAX_LEVEL))
      .catch(() => {
        callFunction<ListAttemptsResponse>('list-attempts', {})
          .then((r) => {
            setUnlocked(r.currentRank ?? 1)
            setDailyLeft(r.dailyLeft ?? null)
          })
          .catch(() => {})
      })
  }, [isFullUser])

  // 카드에 띄울 레벨 = 사다리에서 고른 것 > 검색 추천(해금 범위 안) > 내 등급(승급 도전 레벨).
  //   잠긴 레벨도 고를 수 있다 — 내용(이름·설명·문항수·시간·승급컷)은 열어 두고 응시만 막는다.
  const recommended = searchRec && searchRec.level <= unlocked ? searchRec.level : unlocked
  const focus = picked ?? recommended
  const bannerText =
    searchRec && searchRec.level <= unlocked
      ? t('reco.result', { n: searchRec.level, name: t(`lv.${searchRec.level}.name`) }) +
        (searchRec.alt ? t('reco.result_alt', { n: searchRec.alt }) : '')
      : null

  async function start(level: number) {
    setError(null)
    setLoading(level)
    try {
      await ensureAnonymous()
      const res = await callFunction<StartTestResponse>('start-test', { level, lang })
      navigate(`/test/${res.attemptId}`, { state: res })
    } catch (e) {
      // start-test 는 하루 응시 소진 시 error='daily_limit' 로 429 를 낸다(서버 문구 대신 현지화 문구로).
      const raw = e instanceof Error ? e.message : ''
      setError(raw === 'daily_limit' ? t('lv.daily_limit') : raw || t('lv.start_failed'))
    } finally {
      setLoading(null)
    }
  }

  // 규칙 3줄(승급/유지/일일횟수) — 숫자는 scoring 임계값에서 읽어 자동 동기화. 강등은 없다.
  const rules: { ico: string; tone: string; text: string }[] = [
    {
      ico: 'trending_up',
      tone: 'text-primary bg-primary/10',
      text: t('lv.rule_up', { p1: Math.round(PROMOTE_RATE_LOW * 100), p2: Math.round(PROMOTE_RATE_HIGH * 100) }),
    },
    {
      ico: 'shield',
      tone: 'text-secondary bg-secondary/10',
      text: t('lv.rule_nodown'),
    },
    {
      ico: 'refresh',
      tone: 'text-secondary bg-secondary/10',
      text: t('lv.rule_daily', { n: DAILY_ATTEMPTS_BASE }),
    },
  ]

  const focusSoon = COMING_SOON_LEVELS.includes(focus)
  // 아직 승급하지 못한 레벨 — 카드는 그대로 보여주고 색만 회색, 응시 버튼만 막는다.
  const focusLocked = focus > unlocked
  const focusQ = questionsForLevel(focus)
  const MIN_PICK = 1 // 모바일 ‹ 버튼 하한

  return (
    <div className="bg-background text-on-surface min-h-screen relative overflow-x-hidden flex flex-col">
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
        <div className="ambient-mesh bg-surface-mesh-blue top-[-20%] left-[-10%]"></div>
        <div className="ambient-mesh bg-surface-mesh-cyan bottom-[-20%] right-[-10%]"></div>
      </div>

      {/* flex-col + 사다리의 mt-auto → 모바일에서 카드는 위, 사다리는 아래로 갈라놓는다.
          (안 그러면 둘이 위에 붙고 화면 절반이 빈 채로 남는다) */}
      <main className="flex-grow flex flex-col pt-6 pb-16 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full">
        {/* 아레나로 — /games(미니게임)·/daily 와 같은 위치·문구의 뒤로가기 칩.
            테두리·그림자만 이 화면 톤(Material)에 맞췄다(저쪽은 카툰 톤).
            ⚠️ 제목 위 오버라인이 원래 같은 'WORLD ARENA' 였는데 문구가 겹쳐서 칩이 그 역할을 대신한다. */}
        <Link
          to="/arena"
          aria-label={t('arena.title')}
          className="self-start inline-flex items-center gap-1.5 mb-4 pl-3 pr-4 py-2 rounded-full border border-outline-variant/60 bg-surface-container-lowest text-on-surface-variant font-label-md text-[12.5px] font-bold tracking-[0.06em] hover:border-primary/50 hover:text-primary transition-colors"
        >
          <span className="text-[15px] leading-none">‹</span>
          {t('arena.title')}
        </Link>

        {/* 헤더 한 줄 + 규칙 토글 */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-primary/10 text-primary shrink-0">
              <span className="material-symbols-outlined text-[24px]">public</span>
            </span>
            <div className="min-w-0">
              <h1 className="font-title-md text-3xl md:text-4xl font-bold text-on-surface tracking-tight break-keep">
                {t('lv.title')}
              </h1>
            </div>
          </div>
          <button
            onClick={() => setRuleOpen((v) => !v)}
            aria-expanded={ruleOpen}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant font-label-md text-[15px] font-bold hover:border-primary hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">info</span>
            {t('lv.rule_btn')}
            <span className={`material-symbols-outlined text-[16px] transition-transform ${ruleOpen ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          </button>
        </div>

        {ruleOpen ? (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-5 mb-4">
            {/* 레벨별 문항 수·시간 표는 뺐다 — 선택한 레벨 기준으로 위 카드 칩에 이미 나온다. */}
            <ul className="grid gap-2.5">
              {rules.map((r) => (
                <li key={r.ico} className="flex items-start gap-3">
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${r.tone}`}>
                    <span className="material-symbols-outlined text-[17px]">{r.ico}</span>
                  </span>
                  <span className="font-body-md text-[15px] text-on-surface-variant break-keep pt-0.5">{r.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3.5 pt-3.5 border-t border-outline-variant/30 font-body-sm text-[15px] text-outline">
              {t('lv.rule_note', { max: MAX_LEVEL })}
            </p>
          </div>
        ) : null}

        {bannerText ? (
          <div className="mb-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 font-body-sm text-[15px] text-primary break-keep">
            ✨ {bannerText}
          </div>
        ) : null}

        {error ? (
          <div className="mb-3 rounded-xl border border-error/20 bg-error/5 px-4 py-2.5 font-body-sm text-[15px] text-error break-keep">
            {error}
          </div>
        ) : null}

        {/* 응시 카드 — 이 화면의 유일한 결정.
            모바일은 폭이 좁아 가로 사다리가 성립하지 않는다(원 7개가 붙어버림) → 카드 안에서
            ‹ › 로 레벨을 넘기고, 사다리는 진행바 + 'N / 7' 로 압축한다. PC 는 아래 가로 사다리를 쓴다. */}
        <div className="flex-1 flex flex-col justify-center md:block md:flex-none">
        <div className="bg-surface-container-lowest rounded-2xl border border-primary/30 p-5 md:p-6 ambient-shadow">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPicked(Math.max(MIN_PICK, focus - 1))}
              disabled={focus <= MIN_PICK}
              aria-label={t('lv.prev_level')}
              className="md:hidden w-9 h-9 shrink-0 rounded-full grid place-items-center border border-outline-variant/50 text-on-surface-variant disabled:opacity-30 active:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_left</span>
            </button>
            <span
              className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center font-title-md text-lg font-bold text-white"
              style={{ background: focusLocked ? 'var(--color-outline-variant)' : LEVEL_COLORS[focus] }}
            >
              {focus}
            </span>
            <b className="font-title-md text-2xl md:text-[28px] font-bold text-on-surface tracking-tight break-keep">
              Lv.{focus} {t(`lv.${focus}.name`)}
            </b>
            <button
              onClick={() => setPicked(Math.min(MAX_LEVEL, focus + 1))}
              disabled={focus >= MAX_LEVEL}
              aria-label={t('lv.next_level')}
              className="md:hidden w-9 h-9 shrink-0 rounded-full grid place-items-center border border-outline-variant/50 text-on-surface-variant ml-auto disabled:opacity-30 active:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_right</span>
            </button>
          </div>
          {/* 카드 리드 — 본문(15px)보다 한 단 위. 제목과의 간격을 맞춘 크기다. */}
          <p className="mt-3 font-body-md text-[17px] leading-relaxed text-on-surface-variant break-keep">
            {t(`lv.${focus}.desc`)}
          </p>

          {/* 응시 직전에 알고 싶은 것 — 규칙 패널을 펼치지 않아도 여기서 읽힌다 */}
          <div className="flex gap-2 flex-wrap mt-3.5">
            {[
              t('lv.fact_q', { n: focusQ }),
              t('lv.fact_min', { n: durationMinutesForLevel(focus) }),
              t('lv.fact_cut', { n: promoteCut(focus, focusQ) }),
            ].map((s) => (
              <span
                key={s}
                className="font-label-md text-[15px] font-bold text-on-surface-variant bg-surface-container-low rounded-lg px-3 py-1.5"
              >
                {s}
              </span>
            ))}
          </div>

          {/* 모바일은 버튼 풀폭 + 남은 횟수 아래 줄(한 줄에 붙이면 언어에 따라 줄바꿈이 터진다) */}
          <div className="flex flex-col md:flex-row md:items-center gap-2.5 md:gap-3.5 mt-4">
            {/* 잠긴 레벨은 회색 비활성 버튼 — 내용은 다 보이지만 응시만 막힌다(서버 start-test 도 403). */}
            <button
              onClick={() => start(focus)}
              disabled={loading !== null || focusSoon || focusLocked}
              className={`w-full md:w-auto px-6 py-3.5 md:py-3 inline-flex items-center justify-center gap-1.5 font-label-md text-[15px] font-bold rounded-xl transition-colors ambient-shadow ${
                focusLocked
                  ? 'bg-outline-variant text-on-surface-variant cursor-not-allowed'
                  : 'bg-primary-container text-on-primary hover:bg-primary disabled:opacity-60'
              }`}
            >
              {focusLocked ? (
                <>
                  <span className="material-symbols-outlined text-[18px]">lock</span>
                  {t('lv.locked')}
                </>
              ) : focusSoon ? (
                t('lv.coming_soon')
              ) : loading === focus ? (
                t('lv.preparing')
              ) : (
                t('lv.start_now')
              )}
            </button>
            {focusLocked ? (
              <span className="font-label-md text-[15px] font-bold text-outline break-keep">{t('lv.locked_hint')}</span>
            ) : dailyLeft != null ? (
              <span className="font-label-md text-[15px] font-bold text-outline break-keep">
                {t('lv.left_today', { n: Math.max(0, dailyLeft) })}
              </span>
            ) : null}
          </div>

          {/* 모바일 전용 사다리 요약 — 원 7개 대신 진행바 하나 */}
          <div className="md:hidden mt-4 pt-4 border-t border-outline-variant/30 flex items-center gap-3">
            <span className="flex-1 h-1.5 rounded-full bg-outline-variant/50 overflow-hidden">
              <span
                className="block h-full rounded-full transition-all duration-300"
                style={{
                  width: `${(focus / MAX_LEVEL) * 100}%`,
                  background: focusLocked ? 'var(--color-outline-variant)' : LEVEL_COLORS[focus],
                }}
              />
            </span>
            <span className="font-label-md text-[15px] font-bold text-outline tabular-nums shrink-0">
              {focus} / {MAX_LEVEL}
            </span>
          </div>
        </div>

        </div>

        {/* 가로 사다리 — PC 전용. 모바일에선 폭이 안 나와 카드 안 ‹ › + 진행바로 대체한다.
            레벨 이름은 안 적는다: 고른 레벨의 이름은 위 카드가 크게 보여준다(hover 툴팁·스크린리더 라벨로만 남긴다).
            잠긴 레벨도 눌러서 내용을 볼 수 있다 — 해금 여부는 **동그라미 색**이 말한다(뚫은 레벨만 레벨 색, 잠긴 건 회색+자물쇠). */}
        <div className="hidden md:flex mt-14 items-center">
          {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((n) => {
            const locked = n > unlocked
            const on = n === focus
            const name = `Lv.${n} ${t(`lv.${n}.name`)}`
            return (
              <div key={n} className={`flex items-center ${n < MAX_LEVEL ? 'flex-1' : ''}`}>
                <button
                  onClick={() => setPicked(n)}
                  aria-current={on ? 'true' : undefined}
                  aria-label={locked ? `${name} · ${t('lv.locked')}` : name}
                  title={locked ? `${name} · ${t('lv.locked_hint')}` : name}
                  className={`w-12 h-12 shrink-0 rounded-full grid place-items-center font-title-md text-[17px] font-bold text-white transition-all duration-200 ${
                    on
                      ? 'ring-4 ring-primary/25 scale-110 shadow-md'
                      : locked
                        ? 'opacity-70 hover:opacity-100 hover:scale-105'
                        : 'hover:scale-105 hover:shadow-sm'
                  }`}
                  style={{ background: locked ? 'var(--color-outline-variant)' : LEVEL_COLORS[n] }}
                >
                  {/* 자물쇠 아이콘 없이 숫자만 — 잠김 여부는 회색 배경 하나로 말한다. */}
                  {n}
                </button>
                {n < MAX_LEVEL ? (
                  <span
                    className={`flex-1 h-1 rounded-full ${n < unlocked ? 'bg-primary/40' : 'bg-outline-variant/60'}`}
                  />
                ) : null}
              </div>
            )
          })}
        </div>

        {!isFullUser ? (
          <p className="mt-4 font-body-sm text-[15px] text-primary flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">lock</span>
            {t('lv.login_to_save')}
          </p>
        ) : null}
      </main>

      <SiteFooter />
    </div>
  )
}
