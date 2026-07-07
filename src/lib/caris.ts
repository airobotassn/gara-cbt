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
