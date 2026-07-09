// CARIS 자격 체계 데이터 — Guide(안내)와 ExamApply(원서접수)가 공유.
//
// 2026-07 개편: 트랙/급수 체계 전면 교체.
//   · CARIS-Ⅰ(전국민 AI·로봇 리터러시): Beginner / Pro / Elite — 각 독립 개별 시험, 고정 60% 합격.
//   · CARIS-Ⅱ(피지컬 AI 전문가): Master / Grand Master / Zenith — 내용 미확정이라
//     기존 Master 트랙 내용을 그대로 유지하고 티어 이름만 교체(4급~1급 → Master/Grand Master/Zenith).
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
  subjects: string[] // CARIS-Ⅰ=3, CARIS-Ⅱ=2(기존 유지)
  format?: string // CARIS-Ⅰ: 시험 구성(티어별로 다름)
  method?: string // CARIS-Ⅱ: 검정 방법(필기/실기)
  practical?: string // CARIS-Ⅱ: 실기 내용
  pass: string // 합격 기준
  fee?: number // 티어별 응시료(원) — 임시 예시값(실값은 DB exam_fees)
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

// 티어 목록(이름·응시료). 이름/키는 언어 무관 고정, fee 는 임시 예시값(실값은 DB exam_fees).
const T1_TIERS = [
  { key: 'beginner', name: 'Beginner', fee: 30000 },
  { key: 'pro', name: 'Pro', fee: 40000 },
  { key: 'elite', name: 'Elite', fee: 55000 },
] as const
const T2_TIERS = [
  { key: 'master', name: 'Master', fee: 80000 },
  { key: 'grandmaster', name: 'Grand Master', fee: 100000 },
  { key: 'zenith', name: 'Zenith', fee: 150000 },
] as const

// 급수별 시험 구성(뽑기 blueprint) — /guide 의 caris.t1.*.format 표시문자열과 수치 일치.
//  Beginner=객40, Pro=객50, Elite=객50+주10. T2(Master~Zenith)는 필기+실기 미확정 → 잠정 0(추후 확정).
//  ⚠️ format 문자열 바꾸면 여기 수치도 같이 갱신할 것.
export type TierExamSpec = { mc: number; short: number; durationMin: number; passPct: number }
export const TIER_EXAM_SPEC: Record<string, TierExamSpec> = {
  beginner: { mc: 40, short: 0, durationMin: 40, passPct: 60 },
  pro: { mc: 50, short: 0, durationMin: 50, passPct: 60 },
  elite: { mc: 50, short: 10, durationMin: 60, passPct: 60 },
  master: { mc: 0, short: 0, durationMin: 0, passPct: 60 },
  grandmaster: { mc: 0, short: 0, durationMin: 0, passPct: 60 },
  zenith: { mc: 0, short: 0, durationMin: 0, passPct: 60 },
}
export const tierTotal = (k: string) => (TIER_EXAM_SPEC[k]?.mc ?? 0) + (TIER_EXAM_SPEC[k]?.short ?? 0)

// 급수별 출제 마진(1회 시험) — 난이도 하:중:상 = 3:4:3, 과목 ①:②:③ = 3:4:3(가운데 40%).
//  · subj = getTracks subjects 순서(0..2)별 출제 수. diff = 난이도별 출제 수. 둘 다 총문항의 마진.
//  · 문제은행 목표 = 이 값 × POOL_MULTIPLIER(3배수). 문항 풀 충족 판정 기준.
//  · T2(master~zenith)는 출제 설계 미확정 → 미정(undefined).
//  ⚠️ 추출 로직(admin 함수 examDraw)도 이 마진을 쓰므로 supabase/functions/admin 쪽 사본과 동기화할 것.
export const POOL_MULTIPLIER = 3
export type TierBlueprint = { diff: { 하: number; 중: number; 상: number }; subj: number[] }
export const TIER_BLUEPRINT: Record<string, TierBlueprint> = {
  beginner: { diff: { 하: 12, 중: 16, 상: 12 }, subj: [12, 16, 12] }, // 40
  pro: { diff: { 하: 15, 중: 20, 상: 15 }, subj: [15, 20, 15] }, // 50
  elite: { diff: { 하: 18, 중: 24, 상: 18 }, subj: [18, 24, 18] }, // 60 (객50+주10)
}

// 유형(mc/short)별 출제 마진 — 실제 추출은 이 마진으로 과목×난이도 배분표를 만들어 뽑는다.
//  Beginner/Pro = 전부 객관식. Elite = 객50(3:4:3) + 주10(3:4:3).
export type DrawKindPlan = { diff: { 하: number; 중: number; 상: number }; subj: number[] }
export const TIER_DRAW: Record<string, { mc: DrawKindPlan; short: DrawKindPlan | null }> = {
  beginner: { mc: { diff: { 하: 12, 중: 16, 상: 12 }, subj: [12, 16, 12] }, short: null },
  pro: { mc: { diff: { 하: 15, 중: 20, 상: 15 }, subj: [15, 20, 15] }, short: null },
  elite: { mc: { diff: { 하: 15, 중: 20, 상: 15 }, subj: [15, 20, 15] }, short: { diff: { 하: 3, 중: 4, 상: 3 }, subj: [3, 4, 3] } },
}

export const DRAW_DIFFS = ['하', '중', '상'] as const

// 과목(행합=subj[]) × 난이도(열합=cols[]) 마진을 모두 만족하는 정수 배분표. sum(subj)=sum(cols) 전제.
// 독립비례로 시작 → 행합을 정확히 맞추고(최대 소수부 우선) → 열 초과분을 같은 행 안에서 이동해 열합까지 맞춘다.
export function biproportional(rows: number[], cols: number[]): number[][] {
  const R = rows.length, C = cols.length
  const T = rows.reduce((a, b) => a + b, 0)
  if (T === 0) return rows.map(() => new Array(C).fill(0))
  const M = rows.map((r) => cols.map((c) => Math.floor((r * c) / T)))
  for (let i = 0; i < R; i++) {
    let deficit = rows[i] - M[i].reduce((a, b) => a + b, 0)
    const order = cols
      .map((c, j) => ({ j, f: (rows[i] * c) / T - Math.floor((rows[i] * c) / T) }))
      .sort((a, b) => b.f - a.f)
    let k = 0
    while (deficit-- > 0) { M[i][order[k % C].j]++; k++ }
  }
  const colSum = (j: number) => M.reduce((a, r) => a + r[j], 0)
  for (let guard = 0; guard < 4000; guard++) {
    const j1 = cols.findIndex((c, j) => colSum(j) > c)
    const j2 = cols.findIndex((c, j) => colSum(j) < c)
    if (j1 < 0 || j2 < 0) break
    const i = M.findIndex((r) => r[j1] > 0)
    if (i < 0) break
    M[i][j1]--; M[i][j2]++
  }
  return M
}

// 추출 요청에 실어보낼 배분표 — 과목 문자열(getTracks 순서)까지 담아 서버가 그대로 뽑게 한다.
export function buildDrawCells(tierKey: string, subjects: string[]) {
  const plan = TIER_DRAW[tierKey]
  if (!plan) return null
  const toCols = (d: DrawKindPlan['diff']) => [d.하, d.중, d.상]
  return {
    subjects,
    diffs: [...DRAW_DIFFS],
    mc: biproportional(plan.mc.subj, toCols(plan.mc.diff)),
    short: plan.short ? biproportional(plan.short.subj, toCols(plan.short.diff)) : null,
  }
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
      fee: tier.fee,
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
      subjects: [0, 1].map((i) => tr(lang, `caris.t2.${tier.key}.subj.${i}`)),
      practical: tier.key === 'zenith' ? undefined : tr(lang, `caris.t2.${tier.key}.practical`),
      pass: tr(lang, `caris.t2.${tier.key}.pass`),
      fee: tier.fee,
    })),
  }
  return [track1, track2]
}

// 응시 전 안내(ExamPrepare)에서 보여줄 '결제한 시험' → 트랙·티어. 결제/응시권 연동 전까지 CARIS-Ⅰ Pro 고정(표시용).
// ⚠️ 실제 응시 문제는 단일시험(gara-default)이라 이 티어는 안내 표시일 뿐 문제 내용과 무관.
// TODO: 결제/응시권(exam registration)에서 사용자가 결제한 트랙·티어를 조회해 인자로 넘기도록 교체.
export function getPrepareExam(
  lang: Lang,
  trackKey: string = 't1',
  tierKey: string = 'pro',
): { track: Track; tier: Tier } {
  const tracks = getTracks(lang)
  const track = tracks.find((t) => t.key === trackKey) ?? tracks[0]
  const tier = track.tiers.find((t) => t.key === tierKey) ?? track.tiers[0]
  return { track, tier }
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
