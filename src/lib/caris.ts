// CARIS 자격 체계 데이터 — Guide(안내)와 ExamApply(원서접수)가 공유.
//
// 2026-07 개편: 트랙/급수 체계 전면 교체.
//   · CARIS-Ⅰ(전국민 AI·로봇 리터러시): Beginner / Pro / Elite — 각 독립 개별 시험, 고정 60% 합격.
//   · CARIS-Ⅱ(피지컬 AI 전문가): Master / Grand Master / Zenith — 2026-08-13 내용 확정.
//     Master·Grand Master = 필기(객50+주10/60분) + 실기(120분), Zenith = 필기 서술·논술형 120분(실기 없음).
//     ⚠️ 표시 문구는 확정됐지만 **채점은 아직 총점 60% 단일 기준**이다 — 과목별 40점 과락·실기 70점·
//        Zenith 루브릭(심사위원 3인)은 판정 코드가 없다(서버 my-attempts/admin 의 PASS_RATIO 0.6).
// 구 모델("Pro 단일시험 → 취득 점수로 4급~1급 차등")은 폐기. 각 티어가 독립 시험(합격 = 60%↑)이다.
// 결과판정은 ExamResult 가 총점 60% 합/불로 직접 처리 — 구 점수→급수 판정 코드는 제거됨.
//
// 다국어: 사용자 표시 문자열은 i18n D 사전(caris.* 키)에 있고, getTracks/getRolling(lang) 이 tr() 로 조립한다.
// 티어 이름(Beginner..Zenith)은 브랜드 고유명이라 언어 무관 영문 고정. 내부 식별자(key)는 fee 키·판정에 쓴다.
import { tr, type Lang } from './i18n'

export type Tier = {
  key: string // 내부 식별자(fee 키·판정) — beginner|pro|elite | master|grandmaster|zenith
  name: string // 표시 이름(브랜드 영문 고정)
  target?: string // CARIS-Ⅰ: 대상
  prereq?: string // CARIS-Ⅱ: 응시 자격(선행 티어)
  subjects: string[] // CARIS-Ⅰ=3, CARIS-Ⅱ=2(Zenith 만 3)
  format?: string // CARIS-Ⅰ: 시험 구성(티어별로 다름)
  method?: string // CARIS-Ⅱ: 검정 방법(필기/실기)
  practical?: string // CARIS-Ⅱ: 실기 내용
  pass: string // 합격 기준
  // ⚠️ 응시료(fee)는 여기 없다. 정가 단일 소스 = **DB `exam_fees`**(2026-08-06).
  //    예전엔 이 타입에 `fee?: number`(달러 임시값 $1)가 있었고 화면이 그걸 썼는데, DB 테이블과
  //    값·단위가 따로 놀았다. 금액이 필요하면 src/lib/fees.ts 의 useExamFees()/feeKey() 를 쓸 것.
}

export type Track = {
  key: string // 't1' | 't2' (fee 키 접두사)
  name: string // 'CARIS-Ⅰ' | 'CARIS-Ⅱ'
  tagline: string
  eligibility: string
  icon: string
  caption: string
  tiers: Tier[]
}

// 티어 목록(이름만). 이름/키는 브랜드 고유명이라 언어 무관 고정. **금액은 여기 두지 않는다**(DB exam_fees).
const T1_TIERS = [
  { key: 'beginner', name: 'Beginner' },
  { key: 'pro', name: 'Pro' },
  { key: 'elite', name: 'Elite' },
] as const
// subj = 검정 과목 수. ⚠️ 사전(caris.t2.<key>.subj.N)에 키를 더하는 것만으로는 화면에 안 나온다 —
//   이 숫자를 같이 올릴 것(그래서 세 번째 과목이 한동안 안 보였다).
// ⚠️ Master·Grand Master 의 3과목은 **실기 내용과 같은 문장**이다(2026-08-21, 공식 검정과목표 기준).
//   공식 표가 그걸 검정과목 3으로 세기 때문이고, `practical` 키는 그대로 남아 있어 원서접수·응시준비
//   화면에서는 '실기' 로도 한 번 더 나온다.
const T2_TIERS = [
  { key: 'master', name: 'Master', subj: 3 },
  { key: 'grandmaster', name: 'Grand Master', subj: 3 },
  { key: 'zenith', name: 'Zenith', subj: 3 },
] as const

/** 티어 key → 표시 이름. 칭호(user_titles)가 **key 만** 돌려주므로 화면은 여기서 이름을 얻는다.
 *  티어 이름은 브랜드 고유명이라 언어 무관 고정이고, 그래서 i18n 사전이 아니라 이 표가 단일 출처다.
 *  (서버 쪽 짝은 supabase/functions/_shared/exam-tickets.ts 의 TIER_LABEL — 티어를 추가하면 둘 다.) */
const TIER_NAME: Record<string, string> = Object.fromEntries(
  [...T1_TIERS, ...T2_TIERS].map((t) => [t.key, t.name]),
)
export function tierName(key: string): string {
  return TIER_NAME[key] ?? key
}

/** 아직 열지 않은 급수 = CARIS-Ⅱ 전부. 출제 배분표(TIER_DRAW_CELLS)도 문제은행도 없어서 "팔 수 있는 시험"이
 *  아니다. 그런데 지금까지 이걸 막는 장치가 **응시료 미설정 하나뿐**이라, 관리자가 금액칸에 숫자를 한 번
 *  넣으면 문항 0개짜리 시험이 그대로 결제된다(2026-08-18). 그래서 관리자 화면에서 두 입구를 잠근다 —
 *  회차의 '열리는 급수' 체크와 응시료 입력.
 *  ⚠️ **이미 열려 있는 회차는 건드리지 않는다**(제5회 CARIS 의 Master 가 그렇다). 잠금은 '새로 여는 것'만
 *     막는다 — 운영 중인 회차의 급수를 코드 배포가 조용히 닫으면 그 회차 화면이 하루아침에 달라진다.
 *  ⚠️ 서버 짝 = supabase/functions/_shared/exam-tickets.ts 의 LOCKED_TIERS. 급수를 열 땐 **둘 다** 지울 것
 *     (한쪽만 지우면 화면은 열리는데 서버가 거절해서 원인을 못 찾는다). */
export const LOCKED_TIERS: readonly string[] = ['master', 'grandmaster', 'zenith']
export const isTierLocked = (key: string) => LOCKED_TIERS.includes(key)

/** 급수 대표색(딥블루 → 그린 사다리). /guide 피라미드와 러닝 라이브러리(/ebooks) 급수 열이 같이 쓴다.
 *  ⚠️ src/styles/guide.css · Guide.tsx 의 SPECTRUM(그라데이션 두 끝점)과 동기화 — 바꾸면 셋 다. */
export const TIER_COLORS: Record<string, string> = {
  beginner: '#0d54bd', pro: '#1a80d6', elite: '#14a2e0',
  master: '#10b3ac', grandmaster: '#18bd6a', zenith: '#62c045',
}

// 급수별 시험 구성(뽑기 blueprint) — caris.t1.*.format · caris.t2.*.method 표시문자열과 수치 일치.
//  Beginner=객40, Pro=객50, Elite=객50+주10, Master·Grand Master=객50+주10, Zenith=서술·논술 120분.
//  ⚠️ format·method 문자열 바꾸면 여기 수치도 같이 갱신할 것(원서접수 화면과 문항 관리가 서로 다른 말을 한다).
export type TierExamSpec = { mc: number; short: number; durationMin: number; passPct: number }
export const TIER_EXAM_SPEC: Record<string, TierExamSpec> = {
  beginner: { mc: 40, short: 0, durationMin: 40, passPct: 60 },
  pro: { mc: 50, short: 0, durationMin: 50, passPct: 60 },
  elite: { mc: 50, short: 10, durationMin: 60, passPct: 60 },
  // CARIS-Ⅱ 필기 확정(2026-08-13). Master·Grand Master = 객관식 50 + 주관식 10 / 60분.
  //   ⚠️ **실기는 여기 없다** — 이 표는 CBT 필기 출제용 수치다(실기는 PC작업형·복합작업형 별도 운영).
  //   ⚠️ Zenith 는 서술·논술형 120분이라 **문항 수 개념이 없다** → mc/short 는 0으로 둔다.
  //      0 이라고 미확정이 아니다. 여기에 임의 문항 수를 채우면 문제은행 목표 수량이 거짓으로 잡힌다.
  master: { mc: 50, short: 10, durationMin: 60, passPct: 60 },
  grandmaster: { mc: 50, short: 10, durationMin: 60, passPct: 60 },
  zenith: { mc: 0, short: 0, durationMin: 120, passPct: 60 },
}
export const tierTotal = (k: string) => (TIER_EXAM_SPEC[k]?.mc ?? 0) + (TIER_EXAM_SPEC[k]?.short ?? 0)

// 문제은행 구축 기준 = 출제 배분표(TIER_DRAW_CELLS) × 3배수. 유형(mc/short)별로 따로 채워야 추출이 성립.
export const POOL_MULTIPLIER = 3

export const DRAW_DIFFS = ['하', '중', '상'] as const

// 실제 시험 출제 배분표 — 과목(getTracks 순서 0..2) × 난이도[하,중,상]별 출제 수.
//  · 객관식(mc) = 이미지 설계표 그대로.
//  · 주관식(short) = 난이도 3:4:3(하3·중4·상3) + 과목 3:4:3(①3·②4·③3) — Elite만. (객관식 = 이미지총 − 주관식)
//  ⚠️ 추출(admin examDraw)은 이 표를 클라에서 받아 그대로 뽑음. 합 = TIER_EXAM_SPEC 와 일치.
export const TIER_DRAW_CELLS: Record<string, { mc: number[][]; short: number[][] | null }> = {
  beginner: { mc: [[4, 7, 3], [4, 7, 2], [4, 7, 2]], short: null }, // 객40
  pro: { mc: [[5, 9, 3], [5, 9, 3], [5, 8, 3]], short: null }, // 객50
  elite: { mc: [[5, 9, 3], [5, 8, 3], [5, 9, 3]], short: [[1, 1, 1], [1, 2, 1], [1, 1, 1]] }, // 객50 + 주10(3:4:3)
}

// 추출 요청에 실어보낼 배분표 — 과목 문자열(getTracks 순서)까지 담아 서버가 그대로 뽑게 한다.
export function buildDrawCells(tierKey: string, subjects: string[]) {
  const c = TIER_DRAW_CELLS[tierKey]
  if (!c) return null
  return { subjects, diffs: [...DRAW_DIFFS], mc: c.mc, short: c.short }
}

// CARIS 트랙 데이터(로케일 반영본). Guide/ExamApply 가 소비.
export function getTracks(lang: Lang): Track[] {
  const track1: Track = {
    key: 't1',
    name: tr(lang, 'caris.t1.name'),
    tagline: tr(lang, 'caris.t1.tagline'),
    eligibility: tr(lang, 'caris.t1.eligibility'),
    icon: 'diversity_3',
    caption: tr(lang, 'caris.t1.caption'),
    tiers: T1_TIERS.map((tier) => ({
      key: tier.key,
      name: tier.name,
      target: tr(lang, `caris.t1.${tier.key}.target`),
      subjects: [0, 1, 2].map((i) => tr(lang, `caris.t1.${tier.key}.subj.${i}`)),
      format: tr(lang, `caris.t1.${tier.key}.format`),
      pass: tr(lang, `caris.t1.${tier.key}.pass`),
    })),
  }
  const track2: Track = {
    key: 't2',
    name: tr(lang, 'caris.t2.name'),
    tagline: tr(lang, 'caris.t2.tagline'),
    eligibility: tr(lang, 'caris.t2.eligibility'),
    icon: 'workspace_premium',
    caption: tr(lang, 'caris.t2.caption'),
    tiers: T2_TIERS.map((tier) => ({
      key: tier.key,
      name: tier.name,
      prereq: tr(lang, `caris.t2.${tier.key}.prereq`),
      method: tr(lang, `caris.t2.${tier.key}.method`),
      subjects: Array.from({ length: tier.subj }, (_, i) => tr(lang, `caris.t2.${tier.key}.subj.${i}`)),
      practical: tier.key === 'zenith' ? undefined : tr(lang, `caris.t2.${tier.key}.practical`),
      pass: tr(lang, `caris.t2.${tier.key}.pass`),
    })),
  }
  return [track1, track2]
}

/** 급수 key(`exam_tickets.tier`) → 그 급수가 속한 트랙·티어.
 *  인자가 **급수 하나뿐인 이유**: 응시권에는 트랙 컬럼이 없다(`exam_tickets.tier` 한 컬럼). 티어 key 는
 *  두 트랙을 통틀어 유일하므로 여기서 트랙까지 찾아 준다.
 *  ⛔ **못 찾았을 때 아무 급수나 돌려주지 말 것.** 예전엔 인자 기본값이 `t1`·`pro` 였고 응시 준비 화면이
 *     인자를 아예 안 넘겨서, **어떤 응시권으로 들어와도 CARIS-Ⅰ Pro 의 과목·합격 기준**이 떴다
 *     (Elite 응시권으로 응시하면서 Pro 안내를 읽는다 — 2026-08-26 발견). 모르면 null 을 줘서
 *     호출부가 '틀린 안내' 대신 '안내 없음'을 그리게 한다. */
export function getPrepareExam(lang: Lang, tierKey: string): { track: Track; tier: Tier } | null {
  for (const track of getTracks(lang)) {
    const tier = track.tiers.find((t) => t.key === tierKey)
    if (tier) return { track, tier }
  }
  return null
}

// 시험 일정(정기/상시)은 DB(exam_rounds)가 단일 소스 — src/lib/rounds.ts 의 useExamRounds 로 로드.
// (구 하드코딩 SCHEDULE/Round 는 제거: ExamSchedule·Guide·ExamApply 모두 DB 조회로 통일)

// 상시시험 — 회차와 무관하게 연중 접수(예약 응시). 로케일은 caris.rolling.* 키.
export type Rolling = { id: string; name: string; badge: string; date: string; desc: string }

export function getRolling(lang: Lang): Rolling[] {
  return [
    {
      id: 'pro-cbt',
      name: tr(lang, 'caris.rolling.pro_cbt.name'),
      badge: tr(lang, 'caris.rolling.pro_cbt.badge'),
      date: tr(lang, 'caris.rolling.pro_cbt.date'),
      desc: tr(lang, 'caris.rolling.pro_cbt.desc'),
    },
  ]
}
