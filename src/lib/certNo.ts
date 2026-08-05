// 자격번호 규격 (협회 규정 제80조)
//   형식: {자격종목코드}-{등급코드}-{발급연도(4자리)}-{일련번호(4자리 이상)}
//   자격종목코드: CARIS → "CA", CARIS Master → "CM"
//   등급코드: Beginner "BEG" · Pro "PRO" · Elite "ELT" · Master "MAS" · Grand Master "GMA" · Zenith "ZEN"
//   일련번호: 자격종목·등급·발급연도별로 순차 부여(중복 없이), 1만을 넘으면 5자리 이상으로 자연 확장.
//   예: CA-BEG-2026-0001
//
// ⚠️ 일련번호의 "순차·무중복"은 서버(Supabase)가 단일 소스여야 한다(경쟁 상태 방지).
//    makeCertNo 는 형식 조합만 담당하고 seq 는 서버가 부여한 값을 받는다.
//    tempSeq 는 서버 시퀀스 연동 전까지 형식 미리보기에 쓰는 임시값(순차 아님).
//
// ⚠️ 서버 supabase/functions/_shared/cert.ts 와 동일 로직(등급판정·자격번호·유효기간) — 양쪽 동기화 유지.
//    종목↔등급 배치: CARIS(CA)=Beginner·Pro·Elite / CARIS Master(CM)=Master·Grand Master·Zenith.

export type GradeCode = 'BEG' | 'PRO' | 'ELT' | 'MAS' | 'GMA' | 'ZEN'

const SUBJECT_CODE: Record<GradeCode, 'CA' | 'CM'> = {
  BEG: 'CA', PRO: 'CA', ELT: 'CA',
  MAS: 'CM', GMA: 'CM', ZEN: 'CM',
}

// 인증서 유효기간(개월) — 등급별. null = 무기한. 정책 변경 시 이 표 한 곳만 수정.
//   CARIS-Ⅰ: Beginner·Pro = 6개월, Elite = 12개월. CARIS-Ⅱ(Master 계열) = 무기한(내용 미확정).
const EXPIRY_MONTHS: Record<GradeCode, number | null> = {
  BEG: 6, PRO: 6, ELT: 12, MAS: null, GMA: null, ZEN: null,
}

// 등급 표시명(브랜드 고정, 언어 무관) — 인증서 급수 라벨("CARIS PRO" 등)에 사용.
const GRADE_NAME: Record<GradeCode, string> = {
  BEG: 'BEGINNER', PRO: 'PRO', ELT: 'ELITE', MAS: 'MASTER', GMA: 'GRAND MASTER', ZEN: 'ZENITH',
}

// 시험명(급수) → 등급코드. Grand Master 는 Master 보다 먼저 검사. 미상은 Pro 로 폴백.
export function gradeOfTitle(title?: string | null): GradeCode {
  const t = (title ?? '').toLowerCase()
  if (/grand\s*master/.test(t)) return 'GMA'
  if (/zenith/.test(t)) return 'ZEN'
  if (/master/.test(t)) return 'MAS'
  if (/elite/.test(t)) return 'ELT'
  if (/beginner/.test(t)) return 'BEG'
  return 'PRO'
}

// 인증서 표시용 급수명 — "CARIS PRO" 등(브랜드 고정).
export function gradeDisplay(title?: string | null): string {
  return `CARIS ${GRADE_NAME[gradeOfTitle(title)]}`
}

// 형식 조합. seq 는 서버가 부여한 종목·등급·연도별 순차 번호.
export function makeCertNo(grade: GradeCode, year: number, seq: number): string {
  return `${SUBJECT_CODE[grade]}-${grade}-${year}-${String(Math.max(1, seq)).padStart(4, '0')}`
}

// 등급 유효기간(개월). null=무기한.
export function expiryMonths(grade: GradeCode): number | null {
  return EXPIRY_MONTHS[grade]
}

// 날짜 표기 "2026. 07. 15" — 인증서/성적표 공용 포맷.
export function fmtCertDate(d: Date): string {
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
}

// 취득일(Date) + 급수(title) → 유효기간(만료일) 문자열. null = 무기한.
export function certExpiryDate(title: string | null | undefined, acquiredAt: Date): string | null {
  const m = expiryMonths(gradeOfTitle(title))
  if (m == null) return null
  const d = new Date(acquiredAt)
  d.setMonth(d.getMonth() + m)
  return fmtCertDate(d)
}

// 서버 시퀀스 연동 전 임시 일련번호 — attemptId 해시(순차 아님, 형식 미리보기용).
export function tempSeq(attemptId: string): number {
  let h = 0
  for (const ch of attemptId.replace(/-/g, '')) h = (h * 31 + ch.charCodeAt(0)) % 100000
  return h || 1
}
