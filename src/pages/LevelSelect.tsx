// /test/select — 레벨 선택(D안: 결정 중심).
//   화면 구성: 헤더 → '지금 도전' 응시 카드 1장 → 7단 사다리 스트립(위치만) → 지난 레벨 접이식.
//   왜 목록이 아닌가: 내 등급보다 높은 레벨은 서버(start-test)가 403 으로 막고, 낮은 레벨은 잘 봐도
//   승급이 안 된다(승급 조건 = 응시레벨 ≥ 내 등급). 즉 실질 선택지가 사실상 1개라 7장을 늘어놓을 이유가 없다.
//   톤은 **레벨테스트 인증서(pages/LevelCert.tsx)와 같은 밤하늘** — 루트 .lvnight 가 Material 토큰을
//   그 자리에서 갈아끼워 하위를 통째로 어둡게 만든다(수법 설명은 levelselect.css).
//   금 = 획득/강조, 은 = 미획득. 레벨 고유색(LEVEL_COLORS)은 별 빛무리에만 남는다.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { loadAdminMe } from '../lib/adminMe'
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
import type { ListAttemptsResponse } from '../lib/testTypes'

// 레벨 색(LEVEL_COLORS)은 응시 전 경고 화면과 공유 → lib/testConfigLevel.ts 가 단일 출처.
// 이 화면에선 별 빛무리(--lv-c)에만 쓴다 — 배지·진행바는 금/은(인증서와 같은 규칙)이라 색을 안 받는다.

// ===== 북두칠성 레벨 선택 =====
// 별 순서·연결은 **인증서(pages/LevelCert.tsx)와 동일** — 국자 1‑2‑3‑4, 손잡이 4‑5‑6‑7.
//   두 화면이 같은 그림으로 "어디까지 왔나"를 말해야 해서 좌표를 새로 그리지 않고 인증서 것을 옮겼다.
//   다만 인증서 좌표계는 세로로 길고(893×1035) 이 화면의 빈자리는 가로로 넓다 →
//   **Lv.1→Lv.7 축이 수평이 되도록 회전 + 좌우 반전**한 값이다(순서·연결은 그대로).
//   반전인 이유: Lv.1 이 왼쪽 위에 와야 1→7 로 읽힌다. 회전만으로는 1 이 최상단이 되는 순간
//   오른쪽으로 밀려간다(각도 전 구간에서 그렇다). 반전이라 손잡이(4‑5‑6‑7) 휘는 방향은 인증서와 반대다.
//   ⚠️ **PC·폰이 같은 배치를 쓴다(한 벌).** 예전엔 폰용 세로 별자리를 따로 뒀는데, 두 화면이
//      서로 다른 각도의 별자리를 보여주게 돼서 없앴다. 폭만 줄어들고 그림은 같다.
//   선(SVG)은 이 좌표를 그대로 쓰고, 별은 %로 환산해 HTML 로 얹는다
//   (별을 SVG 안에 넣으면 폭에 따라 별 크기가 같이 줄어 모바일에서 못 누른다).
type DipperLayout = { box: { w: number; h: number }; at: Record<number, { x: number; y: number }> }
const DIPPER: DipperLayout = {
  box: { w: 1339, h: 538 },
  at: {
    1: { x: 70, y: 70 }, 2: { x: 74, y: 389 }, 3: { x: 436, y: 468 }, 4: { x: 547, y: 218 },
    5: { x: 754, y: 99 }, 6: { x: 1019, y: 79 }, 7: { x: 1269, y: 70 },
  },
}
const DIPPER_EDGES: [number, number][] = [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]]

export default function LevelSelect() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isFullUser, user } = useAuth()
  const { t } = useT()
  const [ruleOpen, setRuleOpen] = useState(false) // 등급 규칙 접기(기본 접힘)
  // 해금된 최고 레벨 = 현재 등급(rank). 게스트/첫 유저 = 1. 승급 시 한 단계씩 해제.
  const [unlocked, setUnlocked] = useState(1)
  // 사다리에서 직접 고른 레벨(null = 기본값인 '내 등급'을 따름)
  const [picked, setPicked] = useState<number | null>(null)
  // 오늘 남은 응시 횟수(서버 계산). 미지원이면 null → 표시 생략.
  const [dailyLeft, setDailyLeft] = useState<number | null>(null)
  // 별자리 배치는 PC·폰 공통(DIPPER 한 벌). wideSky 는 **크기**에만 쓴다 —
  // 별 지름(46/38px)과 링이 브레이크포인트마다 달라서 선을 자르는 계산에 필요하다.
  const [wideSky, setWideSky] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const sync = () => setWideSky(mq.matches)
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const sky = DIPPER
  // 별자리 선을 별 앞에서 끊으려면 **좌표계 1단위가 화면 몇 px 인지**를 알아야 한다.
  // 별 크기는 px 고정(46/38)인데 viewBox 는 컨테이너 폭에 따라 늘어나므로 폭을 실제로 잰다.
  const skyBoxRef = useRef<HTMLDivElement>(null)
  const [skyW, setSkyW] = useState(0)
  useEffect(() => {
    const el = skyBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSkyW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
    // ⚠️ 둘을 **동시에** 부른다. 예전엔 admin 을 먼저 부르고 그게 403 으로 **실패해야** list-attempts 를
    //    시작했는데, 일반 회원은 항상 그 경로라 첫 화면이 늘 두 왕복을 줄줄이 기다렸다.
    //    두 응답은 서로를 인자로 쓰지 않는다 — 받아놓고 고르기만 하면 된다.
    let alive = true
    void Promise.all([
      loadAdminMe(user?.id ?? null),
      callFunction<ListAttemptsResponse>('list-attempts', {}).catch(() => null),
    ]).then(([me, r]) => {
      if (!alive) return
      setUnlocked(me.isAdmin ? MAX_LEVEL : (r?.currentRank ?? 1))
      // 관리자는 쿨다운이 면제라 남은 횟수를 띄우지 않는다(옛 동작 그대로).
      setDailyLeft(me.isAdmin ? null : (r?.dailyLeft ?? null))
    })
    return () => { alive = false }
  }, [isFullUser, user])

  // 카드에 띄울 레벨 = 사다리에서 고른 것 > 검색 추천(해금 범위 안) > 내 등급(승급 도전 레벨).
  //   잠긴 레벨도 고를 수 있다 — 내용(이름·설명·문항수·시간·승급컷)은 열어 두고 응시만 막는다.
  const recommended = searchRec && searchRec.level <= unlocked ? searchRec.level : unlocked
  const focus = picked ?? recommended
  const bannerText =
    searchRec && searchRec.level <= unlocked
      ? t('reco.result', { n: searchRec.level, name: t(`lv.${searchRec.level}.name`) }) +
        (searchRec.alt ? t('reco.result_alt', { n: searchRec.alt }) : '')
      : null

  // ⛔ 여기서 응시를 만들지 않는다 — 안내 게이트(/test/ready)의 「전체화면으로 시작」이 만든다.
  //    예전엔 이 버튼이 곧바로 start-test 를 불러서, 안내만 보고 「취소」를 눌러도 하루 응시
  //    횟수가 이미 1회 깎였다(문제를 한 개도 못 본 채로). 익명 세션 생성도 같이 미룬다.
  //    응시 실패(하루 소진·잠긴 레벨)도 이제 그 화면에서 뜬다 — 여기엔 띄울 것이 없다.
  function start(level: number) {
    navigate(`/test/ready/${level}`)
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
    <div className="lvnight text-on-surface min-h-screen relative overflow-x-hidden flex flex-col">
      {/* 하늘 — 인증서·랭킹과 같은 밤하늘 사진(cert/bg.webp) + 비네트.
          fixed 가 아니라 absolute 다: 문서 전체를 덮어야 아래로 스크롤해도 별이 계속 있고,
          풀페이지 캡처에서도 화면 밖이 흰 종이로 남지 않는다.
          라이트 톤의 ambient-mesh 두 덩이는 걷어냈다(밤하늘에선 파란 안개로만 보인다). */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[-1]">
        <div className="lvn-sky" />
        <div className="lvn-vig" />
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
          className="lvn-chip self-start inline-flex items-center gap-1.5 mb-4 pl-3 pr-4 py-2 rounded-full font-label-md text-[12.5px] font-bold tracking-[0.06em] transition-colors"
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
              {/* .lvn-display = 크기·굵기만. 서체는 화면 공통 Pretendard 다(2026-08-05 통일).
                  예전엔 인증서와 같은 명조를 썼는데, 명조는 이제 인증서 안에서만 쓴다. */}
              <h1 className="lvn-display text-[34px] md:text-[46px] text-on-surface tracking-tight break-keep">
                {t('lv.title')}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 레벨테스트 인증서 — 응시 여부와 무관하게 항상 있는 자리(기록이 없으면 인증서 화면이 안내한다).
                ⚠️ 원래 금색(primary)이었는데 중립으로 내렸다 — 이 화면에서 금색은 '응시 시작' 하나여야 한다.
                   금색 물건이 넷(인증서·규칙·배지·CTA)이면 뭐가 결정인지 안 보인다. */}
            {/* 내 기록 — 옛 마이페이지 '학습 대시보드'의 레벨테스트 몫(스탯·영역 밸런스·승급 기록)이
                여기로 왔다(2026-08-25). 인증서와 같은 성격(응시 이력을 보는 자리)이라 나란히 둔다.
                인증서와 같은 이유로 중립 칩이다 — 이 화면에서 금색은 '응시 시작' 하나여야 한다. */}
            <button
              onClick={() => navigate('/test/record')}
              className="lvn-chip inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full font-label-md text-[15px] font-bold transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">timeline</span>
              {t('db.title')}
            </button>
            <button
              onClick={() => navigate('/test/certificate')}
              className="lvn-chip inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full font-label-md text-[15px] font-bold transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">workspace_premium</span>
              {t('lcert.issue_btn')}
            </button>
            <button
              onClick={() => setRuleOpen((v) => !v)}
              aria-expanded={ruleOpen}
              className="lvn-chip inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full font-label-md text-[15px] font-bold transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">info</span>
              {t('lv.rule_btn')}
              <span className={`material-symbols-outlined text-[16px] transition-transform ${ruleOpen ? 'rotate-180' : ''}`}>
                expand_more
              </span>
            </button>
          </div>
        </div>

        {ruleOpen ? (
          <div className="lvn-card bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-5 mb-4">
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
          </div>
        ) : null}

        {bannerText ? (
          <div className="mb-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 font-body-sm text-[15px] text-primary break-keep">
            ✨ {bannerText}
          </div>
        ) : null}

        {/* 응시 카드 — 이 화면의 유일한 결정.
            모바일은 폭이 좁아 가로 사다리가 성립하지 않는다(원 7개가 붙어버림) → 카드 안에서
            ‹ › 로 레벨을 넘기고, 사다리는 진행바 + 'N / 7' 로 압축한다. PC 는 아래 가로 사다리를 쓴다. */}
        <div className="flex-1 flex flex-col justify-center md:block md:flex-none">
        {/* PC 는 2단 — 왼쪽 '무슨 레벨인가' / 오른쪽 '응시할 것인가'.
            1단으로 두면 1200px 카드의 오른쪽 2/3 이 빈 하늘로 남아 미완성으로 읽히고, CTA 가
            왼쪽 아래 구석에 처박혀 아래 별자리한테 초점을 뺏긴다.
            ⚠️ 금박 모서리 각인(lvn-orn)은 뺐다 — 카드가 1200×245 라 위/아래 장식이 1100px 씩 떨어져
               액자가 아니라 부스러기 4점으로 읽혔다. 금박 정체성은 별 링·별자리 선이 이미 지고 있다. */}
        <div className="lvn-card rounded-2xl border border-primary/30 p-5 md:p-7 ambient-shadow md:flex md:items-center md:gap-9">
          <div className="md:flex-1 md:min-w-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPicked(Math.max(MIN_PICK, focus - 1))}
              disabled={focus <= MIN_PICK}
              aria-label={t('lv.prev_level')}
              className="md:hidden w-9 h-9 shrink-0 rounded-full grid place-items-center border border-outline-variant/50 text-on-surface-variant disabled:opacity-30 active:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_left</span>
            </button>
            {/* 레벨 번호 네모 배지는 삭제 — 바로 옆 "Lv.7 마스터" 가 같은 숫자를 이미 말한다(중복).
                금색 사각형이 하나 줄면서 이 화면의 금색은 '응시 시작' 하나로 모인다. */}
            {/* 제목에 금박 명판을 둘렀다가 뺐다 — 카드가 2단이라 제목(왼쪽)과 응시 버튼(오른쪽)이
                나란히 붙는데, 버튼이 금박 에셋이라 둘 다 판을 두르면 금색 덩어리 둘이 정면으로 싸운다.
                밑에 별자리까지 금이라 화면에 화려한 게 셋이 된다. 제목은 금선 하나만 남긴다.
                (에셋은 public/cert/cta-plate2.webp 에 남아있다) */}
            <b className="lvn-title lvn-display min-w-0 text-[27px] md:text-[34px] text-on-surface tracking-tight break-keep">
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
          {/* 위계 = 제목 34 → 설명 18 → 보조수치 15. 크기를 줄여서 위계를 만들지 말 것 —
              전부 키우고 **간격**을 벌린다(작게 만들면 읽기만 힘들어지고 화면이 더 초라해진다). */}
          <p className="mt-3 font-body-md text-[18px] leading-relaxed text-on-surface-variant break-keep max-w-[52ch]">
            {t(`lv.${focus}.desc`)}
          </p>

          {/* 응시 직전에 알고 싶은 것 — 규칙 패널을 펼치지 않아도 여기서 읽힌다.
              굵은 15px 이면 설명문과 무게가 같아져서 '칩'이 아니라 두 번째 문단처럼 보인다. */}
          <div className="flex gap-2 flex-wrap mt-4">
            {[
              t('lv.fact_q', { n: focusQ }),
              t('lv.fact_min', { n: durationMinutesForLevel(focus) }),
              t('lv.fact_cut', { n: promoteCut(focus, focusQ) }),
            ].map((s) => (
              <span
                key={s}
                className="lvn-fact font-label-md text-[15px] font-semibold rounded-lg px-3 py-1.5"
              >
                {s}
              </span>
            ))}
          </div>
          </div>

          {/* 오른쪽 = 결정 열. PC 에선 세로 구분선으로 정보/행동을 가른다 */}
          <div className="flex flex-col gap-2.5 mt-4 md:mt-0 md:shrink-0 md:w-[236px] md:pl-9 md:border-l md:border-outline-variant/25">
            {/* 잠긴 레벨은 회색 비활성 버튼 — 내용은 다 보이지만 응시만 막힌다(서버 start-test 도 403). */}
            <button
              onClick={() => start(focus)}
              disabled={focusSoon || focusLocked}
              className={`w-full px-6 py-3.5 md:py-4 inline-flex items-center justify-center gap-1.5 font-label-md text-[17px] md:text-[18px] font-bold rounded-xl transition-colors ambient-shadow ${
                focusLocked
                  ? 'bg-outline-variant text-on-surface-variant cursor-not-allowed'
                  : 'lvn-cta disabled:opacity-60'
              }`}
            >
              {focusLocked ? (
                <>
                  <span className="material-symbols-outlined text-[18px]">lock</span>
                  {t('lv.locked')}
                </>
              ) : focusSoon ? (
                t('lv.coming_soon')
              ) : (
                t('lv.start_now')
              )}
            </button>
            {/* 잠김 안내 문구는 뺐다 — 자물쇠 버튼이 이미 같은 말을 한다. 별 툴팁에는 남아 있다. */}
            {!focusLocked && dailyLeft != null ? (
              <span className="font-label-md text-[15px] font-bold text-outline break-keep md:text-center">
                {t('lv.left_today', { n: Math.max(0, dailyLeft) })}
              </span>
            ) : null}

          {/* 모바일 전용 사다리 요약 — 원 7개 대신 진행바 하나 */}
          <div className="md:hidden mt-1.5 pt-4 border-t border-outline-variant/30 flex items-center gap-3">
            <span className="flex-1 h-1.5 rounded-full bg-outline-variant/50 overflow-hidden">
              <span
                className={`lvn-bar${focusLocked ? ' is-locked' : ''} block h-full rounded-full transition-all duration-300`}
                style={{ width: `${(focus / MAX_LEVEL) * 100}%` }}
              />
            </span>
            <span className="font-label-md text-[15px] font-bold text-outline tabular-nums shrink-0">
              {focus} / {MAX_LEVEL}
            </span>
          </div>
          </div>
        </div>

        </div>

        {/* 북두칠성 사다리 — 별 하나 = 레벨 하나(가로 사다리를 대체). 좌표는 위 DIPPER 주석 참고.
            레벨 이름은 안 적는다: 고른 레벨의 이름은 위 카드가 크게 보여준다(hover 툴팁·스크린리더 라벨로만 남긴다).
            잠긴 레벨도 눌러서 내용을 볼 수 있다 — 해금 여부는 **별 색**이 말한다(뚫은 레벨만 레벨 색+빛무리, 잠긴 건 회색). */}
        {/* shrink-0 필수 — main 이 flex-col 이라 이 블록이 세로로 눌리면서 폭까지 같이 줄어든다(aspect-ratio) */}
        <div className="lvsky mt-8 md:mt-12 shrink-0">
          {/* 정지 별은 배경 사진이 낸다 — 여기 얹는 건 별자리 근처만 느리게 깜빡이는 층 하나 */}
          <div className="lvsky-twinkle" />

          {/* 세로 별자리는 폭을 안 막으면 태블릿(700px)에서 세로 790px 로 화면을 다 잡아먹는다 */}
          <div
            ref={skyBoxRef}
            className="relative w-full mx-auto"
            style={{ aspectRatio: String(sky.box.w / sky.box.h), maxWidth: 980 }}
          >
            {/* 별자리 선 — 컨테이너와 viewBox 비율이 같아 좌표가 1:1 로 맞는다.
                각인 선 조각(cert/edge-*.webp)을 구간마다 회전·신축 — 인증서와 같은 방식·같은 그림.
                선은 별 뒤로 지나가고 별 중심이 불투명해서 가려진다(선 끝을 끊는 계산 불필요).
                미달성 구간은 SVG 필터로 채도를 빼지 않고 **은색 에셋으로 갈아끼운다**(이유는 levelselect.css 참고). */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={`0 0 ${sky.box.w} ${sky.box.h}`}
              aria-hidden="true"
            >
              {DIPPER_EDGES.map(([a, b]) => {
                const p = sky.at[a], q = sky.at[b]
                // 두 끝이 다 해금된 구간만 금빛 — 1‑2‑3‑4‑5‑6‑7 이 곧 승급 순서라 이게 진행선이 된다.
                const on = a <= unlocked && b <= unlocked
                const dx = q.x - p.x, dy = q.y - p.y
                // 선 굵기는 좌표계 폭에 비례(두 벌 공통 두께). /149 였는데 사진 배경 위에서 갈색 실오라기로
                // 사라져서 /120 으로 올렸다 — 별을 잇는 '각인 막대'로 읽혀야 한다.
                const th = sky.box.w / 120
                const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
                const deg = (Math.atan2(dy, dx) * 180) / Math.PI
                // 별 앞에서 선을 끊는다. 예전엔 별 뒤로 통과시키고 불투명 원반으로 가리려 했는데,
                // 심(46px)과 링(64px) 사이가 비어 선이 그대로 비쳤고, 원반으로 덮으니 이번엔
                // 선 끝이 링에 뭉툭하게 처박혔다. 실제 성도(星圖)처럼 **링 바깥에서 띄워 끊는다**.
                // 심 + 링 inset 양쪽. PC = 46+9*2, 폰 = 30+7*2 (levelselect.css 와 짝)
                const ringPx = wideSky ? 64 : 44
                const unit = skyW > 0 ? sky.box.w / skyW : 0 // 좌표계 1단위 = 화면 몇 px 의 역수
                const cut = (ringPx / 2 + 7) * unit
                const raw = Math.hypot(dx, dy)
                const len = Math.max(raw * 0.25, raw - cut * 2)
                // 나머지 진행선은 한 단계 밝게 — 은하수 사진 위에서 각인 막대가 하늘에 묻힌다.
                // 금색 구간은 이미 opacity 1 이라 더 올릴 데가 없어 brightness + 번짐으로 올린다.
                const op = on ? 1 : 0.72
                const filter = on
                  ? 'brightness(1.2) drop-shadow(0 0 4px rgba(240,205,130,.5))'
                  : 'brightness(1.14)'
                return (
                  <image
                    key={`e${a}-${b}`}
                    href={on ? '/cert/edge-sm.webp' : '/cert/edge-silver-sm.webp'}
                    x={-len / 2} y={-th / 2} width={len} height={th}
                    preserveAspectRatio="none"
                    opacity={op}
                    style={filter ? { filter } : undefined}
                    transform={`translate(${mx},${my}) rotate(${deg})`}
                  />
                )
              })}
            </svg>

            {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((n) => {
              const locked = n > unlocked
              const on = n === focus
              const name = `Lv.${n} ${t(`lv.${n}.name`)}`
              return (
                <div
                  key={n}
                  className="absolute"
                  style={{
                    left: `${(sky.at[n].x / sky.box.w) * 100}%`,
                    top: `${(sky.at[n].y / sky.box.h) * 100}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <button
                    onClick={() => setPicked(n)}
                    aria-current={on ? 'true' : undefined}
                    aria-label={locked ? `${name} · ${t('lv.locked')}` : name}
                    title={locked ? `${name} · ${t('lv.locked_hint')}` : name}
                    className={`lvsky-star${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
                    style={{ ['--lv-c' as string]: LEVEL_COLORS[n] }}
                  >
                    {on ? <span className="lvsky-pick" aria-hidden="true" /> : null}
                    {/* 자물쇠 아이콘 없이 숫자만 — 잠김 여부는 은색 링 하나로 말한다.
                        숫자는 인증서와 같은 금박 각인 에셋(num-N). 잠긴 레벨은 은색 파생본으로 갈아끼운다.
                        alt 는 비운다 — 버튼 aria-label 이 이미 레벨을 읽는다. */}
                    <img
                      className="lvsky-num"
                      src={`/cert/num-${n}${locked ? '-silver' : ''}-sm.webp`}
                      alt=""
                    />
                  </button>
                </div>
              )
            })}
          </div>
          {/* 안내 문구('별을 눌러 레벨을 고르세요…')는 삭제 — 별이 버튼이고 금/은이 해금을 말한다.
              그림이 이미 하는 말을 밑에 자막으로 또 다는 건 화면을 설명서로 만든다. */}
        </div>

        {!isFullUser ? (
          <p className="mt-4 font-body-sm text-[15px] text-primary flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">lock</span>
            {t('lv.login_to_save')}
          </p>
        ) : null}
      </main>

    </div>
  )
}
