// 자격번호 규격 (협회 규정 제80조)
//   형식: {자격종목코드}-{등급코드}-{발급연도(4자리)}-{일련번호(6자리)}
//   자격종목코드: CARIS → "CA", CARIS Master → "CM"
//   등급코드: Beginner "BEG" · Pro "PRO" · Elite "ELT" · Master "MAS" · Grand Master "GMA" · Zenith "ZEN"
//   일련번호: 자격종목·등급·발급연도별로 1부터 순차 부여(중복 없이). 100만을 넘으면 7자리로 자연 확장.
//   예: CA-BEG-2026-000001
//
// ⚠️ 일련번호의 "순차·무중복"은 **DB 가 단일 소스**다 — 발급 시 RPC `next_cert_seq(종목,등급,연도)`
//    가 원자적으로 채번하고(schema.sql 의 cert_serials 테이블), `exam_attempts.cert_no` 에는
//    unique 인덱스가 걸려 있다. 이 파일은 **형식 조합만** 담당한다.
//    → 앱(프론트/서버)이 번호를 스스로 지어내면 안 된다. 발급 전 화면은 certNoPending 을 쓴다.
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

/** 일련번호 자릿수 — 여기만 고치면 형식·자리 가림(certNoPending)이 같이 따라온다. */
export const SEQ_DIGITS = 6

// 형식 조합. seq 는 서버가 부여한 종목·등급·연도별 순차 번호.
export function makeCertNo(grade: GradeCode, year: number, seq: number): string {
  return `${SUBJECT_CODE[grade]}-${grade}-${year}-${String(Math.max(1, seq)).padStart(SEQ_DIGITS, '0')}`
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

/**
 * 발급 **전** 화면에 쓰는 자격번호 — 일련번호 자리를 가린 형태(`CA-PRO-2026-••••••`).
 *
 * ⚠️ 발급 전에는 번호가 존재하지 않는다. 채번은 발급 순간에 서버가 한다.
 *    예전엔 attemptId 해시로 그럴듯한 번호를 만들어 보여줬는데, 사용자는 그걸 자기 번호로 읽는다
 *    — 실제 발급하면 다른 번호가 나오고, 해시라 남과 겹칠 수도 있었다.
 *    그래서 '아직 정해지지 않았다'를 그대로 보여준다.
 */
export function certNoPending(grade: GradeCode, year: number): string {
  return `${SUBJECT_CODE[grade]}-${grade}-${year}-${'•'.repeat(SEQ_DIGITS)}`
}
