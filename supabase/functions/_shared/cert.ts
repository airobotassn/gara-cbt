// 자격번호·등급·만료·이름마스킹 — Edge Function 공용(Deno).
// ⚠️ 프론트 src/lib/certNo.ts 와 형식/등급/만료 로직을 동기화 유지(양쪽 수정). 마스킹은 서버 전용.
//   트랙↔종목: CARIS(CA)=Beginner·Pro·Elite / CARIS Master(CM)=Master·Grand Master·Zenith.

export type GradeCode = 'BEG' | 'PRO' | 'ELT' | 'MAS' | 'GMA' | 'ZEN'
type SubjectCode = 'CA' | 'CM'

const SUBJECT_CODE: Record<GradeCode, SubjectCode> = {
  BEG: 'CA', PRO: 'CA', ELT: 'CA',
  MAS: 'CM', GMA: 'CM', ZEN: 'CM',
}

// 인증서 유효기간(개월) — 등급별. null = 무기한. 정책 변경 시 이 표 한 곳만 수정.
//   CARIS-Ⅰ: Beginner·Pro = 6개월, Elite = 12개월. CARIS-Ⅱ(Master 계열) = 무기한(내용 미확정).
const EXPIRY_MONTHS: Record<GradeCode, number | null> = {
  BEG: 6, PRO: 6, ELT: 12, MAS: null, GMA: null, ZEN: null,
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

// 서버 시퀀스 연동 전 임시 일련번호 — attemptId 해시(순차 아님). 프론트 certNo.ts 와 동일.
export function tempSeq(attemptId: string): number {
  let h = 0
  for (const ch of attemptId.replace(/-/g, '')) h = (h * 31 + ch.charCodeAt(0)) % 100000
  return h || 1
}

// 자격번호 형식 조합 — {종목}-{등급}-{연도}-{일련(4자리+)}.
export function makeCertNo(grade: GradeCode, year: number, seq: number): string {
  return `${SUBJECT_CODE[grade]}-${grade}-${year}-${String(Math.max(1, seq)).padStart(4, '0')}`
}

// 등급 → 유효기간(개월). null=무기한.
export function expiryMonths(grade: GradeCode): number | null {
  return EXPIRY_MONTHS[grade]
}

// 이름 마스킹 — 공개 검증 페이지 PII 최소화. 홍길동→홍*동, 홍*(2자), 단어별 적용(영문 이름).
export function maskName(raw: string): string {
  const one = (s: string): string => {
    const a = [...s]
    if (a.length <= 1) return s
    if (a.length === 2) return `${a[0]}*`
    return `${a[0]}${'*'.repeat(a.length - 2)}${a[a.length - 1]}`
  }
  return raw.trim().split(/\s+/).filter(Boolean).map(one).join(' ')
}
