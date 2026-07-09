// 자격번호·트랙·만료·이름마스킹 — Edge Function 공용(Deno).
// ⚠️ 프론트 src/lib/certNo.ts 와 형식 로직을 동기화 유지(양쪽 수정). 만료·마스킹은 서버 전용.
//   트랙↔종목: CARIS(CA)=Beginner·Pro·Elite / CARIS Master(CM)=Master·Grand Master·Zenith.

export type CertTrack = 'pro' | 'master'
type GradeCode = 'BEG' | 'PRO' | 'ELT' | 'MAS' | 'GMA' | 'ZEN'
type SubjectCode = 'CA' | 'CM'

const SUBJECT_CODE: Record<GradeCode, SubjectCode> = {
  BEG: 'CA', PRO: 'CA', ELT: 'CA',
  MAS: 'CM', GMA: 'CM', ZEN: 'CM',
}
const TRACK_GRADE: Record<CertTrack, GradeCode> = { pro: 'PRO', master: 'MAS' }

// 자격증 유효기간(개월) — 종목코드별. null = 무기한. 정책 변경(2년→3년 등) 시 이 표만 수정.
//   CA(Beginner·Pro·Elite) = 24개월, CM(Master 계열) = 무기한.
const EXPIRY_MONTHS: Record<SubjectCode, number | null> = { CA: 24, CM: null }

// 시험명으로 트랙 추정 — "Master" 포함이면 master, 아니면 pro(기본).
export function trackOfTitle(title?: string | null): CertTrack {
  return title && /master/i.test(title) ? 'master' : 'pro'
}

// 서버 시퀀스 연동 전 임시 일련번호 — attemptId 해시(순차 아님). 프론트 certNo.ts 와 동일.
export function tempSeq(attemptId: string): number {
  let h = 0
  for (const ch of attemptId.replace(/-/g, '')) h = (h * 31 + ch.charCodeAt(0)) % 100000
  return h || 1
}

// 자격번호 형식 조합 — {종목}-{등급}-{연도}-{일련(4자리+)}.
export function makeCertNo(track: CertTrack, year: number, seq: number): string {
  const grade = TRACK_GRADE[track]
  return `${SUBJECT_CODE[grade]}-${grade}-${year}-${String(Math.max(1, seq)).padStart(4, '0')}`
}

// 트랙 → 유효기간(개월). null=무기한.
export function expiryMonths(track: CertTrack): number | null {
  return EXPIRY_MONTHS[SUBJECT_CODE[TRACK_GRADE[track]]]
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
