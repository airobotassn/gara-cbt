// CARIS 자격 체계 데이터 — Guide(안내)와 ExamApply(원서접수)가 공유.
// 1차: 한국어 단일 · 응시료는 임시 예시값 — 디자인/정책 확정 후 i18n·실가격 반영.
//
// 결제 단위 차이(중요):
//   · Pro    = 시험 1개(단일 응시료). 취득 점수에 따라 4급~1급 차등 부여 → 급수별 결제 아님(examFee).
//   · Master = 급수별 별도 시험(순차). 급수마다 응시료 다름 → Level.fee.
//
// 다국어: 사용자 표시 문자열은 i18n D 사전(caris.* 키)에 있고, getTracks/getRolling(lang) 이 tr() 로 조립한다.
// 등급/스코어링 내부 식별자는 한국어('4급'..)를 그대로 유지(로직·동기화 안 깨지게). 표시용 등급은 gradeLabel().
import { tr, type Lang } from './i18n'

export type Level = {
  grade: string
  tag?: string // Pro: 대상
  prereq?: string // Master: 응시 자격(선행 급수)
  method?: string // Master: 검정 방법(필기/실기)
  subjects: string[]
  practical?: string // Master: 실기 내용
  pass: string
  fee?: number // Master: 급수별 응시료(원) — 임시 예시값
}

export type Track = {
  key: string
  name: string
  tagline: string
  eligibility: string
  icon: string
  caption: string
  format?: string // Pro: 공통 시험 구성
  formatSub?: string
  examFee?: number // Pro: 단일 시험 응시료(급수는 점수로 판정) — 임시 예시값
  levels: Level[]
}

// 급수 내부 식별자(한국어) ↔ i18n 키 suffix. 스코어링/판정은 이 한국어 값을 그대로 쓴다.
const GRADES = ['g4', 'g3', 'g2', 'g1'] as const
type G = (typeof GRADES)[number]
const GRADE_KO: Record<G, string> = { g4: '4급', g3: '3급', g2: '2급', g1: '1급' }
const KO_TO_G: Record<string, G> = { '4급': 'g4', '3급': 'g3', '2급': 'g2', '1급': 'g1' }

// 표시용 등급 라벨(로케일별). 입력은 내부 한국어 grade('4급'..) — 없으면 원문 반환.
export function gradeLabel(grade: string, lang: Lang): string {
  const g = KO_TO_G[grade]
  return g ? tr(lang, `caris.grade.${g}`) : grade
}

// Pro 급수의 대상(tag) 로케일 문구 — ExamResult 안내문에 사용.
export function proGradeTag(grade: string, lang: Lang): string {
  const g = KO_TO_G[grade]
  return g ? tr(lang, `caris.pro.tag.${g}`) : ''
}

// CARIS 트랙 데이터(로케일 반영본). Guide/ExamApply 가 소비. grade 는 표시용 라벨.
export function getTracks(lang: Lang): Track[] {
  const subjects = (track: 'pro' | 'master', g: G) => [
    tr(lang, `caris.${track}.subj.${g}.0`),
    tr(lang, `caris.${track}.subj.${g}.1`),
  ]
  const masterFee: Record<G, number> = { g4: 80000, g3: 100000, g2: 120000, g1: 150000 }
  const pro: Track = {
    key: 'pro',
    name: 'CARIS Pro',
    tagline: tr(lang, 'caris.pro.tagline'),
    eligibility: tr(lang, 'caris.pro.eligibility'),
    icon: 'school',
    caption: tr(lang, 'caris.pro.caption'),
    format: tr(lang, 'caris.pro.format'),
    formatSub: tr(lang, 'caris.pro.formatSub'),
    examFee: 30000,
    levels: GRADES.map((g) => ({
      grade: tr(lang, `caris.grade.${g}`),
      tag: tr(lang, `caris.pro.tag.${g}`),
      subjects: subjects('pro', g),
      pass: tr(lang, `caris.pass.${g}`),
    })),
  }
  const master: Track = {
    key: 'master',
    name: 'CARIS Master',
    tagline: tr(lang, 'caris.master.tagline'),
    eligibility: tr(lang, 'caris.master.eligibility'),
    icon: 'workspace_premium',
    caption: tr(lang, 'caris.master.caption'),
    levels: GRADES.map((g) => ({
      grade: tr(lang, `caris.grade.${g}`),
      prereq: tr(lang, `caris.master.prereq.${g}`),
      method: tr(lang, `caris.master.method.${g}`),
      subjects: subjects('master', g),
      practical: g === 'g1' ? undefined : tr(lang, `caris.master.practical.${g}`),
      pass: tr(lang, `caris.master.pass.${g}`),
      fee: masterFee[g],
    })),
  }
  return [pro, master]
}

// 내부 참조가 필요할 때를 위한 급수 코드(디버그/타입). 화면은 getTracks 사용.
export const GRADE_CODES = GRADES
export { GRADE_KO }

// ── CARIS Pro 급수 판정 ───────────────────────────────────────────
// Pro 는 단일 필기시험 → 취득 점수(0~100)에 따라 4급~1급을 차등 부여.
// 컷: 4급 60 / 3급 70 / 2급 80 / 1급 90. 60점 미만은 불합격(급수 없음).
// ⚠️ TRACKS['pro'].levels 의 pass 문구(60/70/80/90점 이상)와 반드시 동기화.
export type ProGrade = { grade: string; min: number; tag: string }

export const PRO_PASS_MIN = 60 // 합격 최소 점수(4급 컷)

export const PRO_GRADE_CUTS: ProGrade[] = [
  { grade: '1급', min: 90, tag: '관리자·강사 및 전문가 과정 진입' },
  { grade: '2급', min: 80, tag: '대학생 및 직장인 중급' },
  { grade: '3급', min: 70, tag: '중·고등학생 및 직장인 기초' },
  { grade: '4급', min: 60, tag: '전 국민 입문 · 기초 소양' },
]

// 취득 점수(%)로 얻은 최고 급수. 60 미만이면 null(불합격).
export function proGradeForScore(pct: number): ProGrade | null {
  return PRO_GRADE_CUTS.find((g) => pct >= g.min) ?? null
}

// 다음(더 높은) 급수 컷. 이미 1급이면 null.
export function nextProGrade(pct: number): ProGrade | null {
  return [...PRO_GRADE_CUTS].reverse().find((g) => g.min > pct) ?? null // 4급→1급 오름차순 탐색
}

export type Round = { id: string; roundKey: string; dateKey: string; open: boolean }

export const SCHEDULE: Round[] = [
  { id: 'r4', roundKey: 'guide.sched_r4_round', dateKey: 'guide.sched_r4_date', open: true },
  { id: 'r5', roundKey: 'guide.sched_r5_round', dateKey: 'guide.sched_r5_date', open: false },
  { id: 'r1_2027', roundKey: 'guide.sched_r1_round', dateKey: 'guide.sched_r1_date', open: false },
]

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
