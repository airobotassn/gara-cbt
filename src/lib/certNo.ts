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
// 종목↔등급 배치(현재 해석): CARIS(CA)=Beginner·Pro·Elite / CARIS Master(CM)=Master·Grand Master·Zenith.

export type CertTrack = 'pro' | 'master'
export type GradeCode = 'BEG' | 'PRO' | 'ELT' | 'MAS' | 'GMA' | 'ZEN'

const SUBJECT_CODE: Record<GradeCode, 'CA' | 'CM'> = {
  BEG: 'CA', PRO: 'CA', ELT: 'CA',
  MAS: 'CM', GMA: 'CM', ZEN: 'CM',
}

// 현재 운영 트랙(CARIS Pro / CARIS Master) → 등급코드.
// ⚠️ 임시 매핑(사용자 지시로 임시 확정) — 등급 체계(6단계)가 확정되면 이 표 한 곳만 갱신하면 됨.
//    Beginner·Elite·Grand Master·Zenith 도입 및 Pro 급수(4~1급)별 코드 세분화도 여기서 처리.
const TRACK_GRADE: Record<CertTrack, GradeCode> = { pro: 'PRO', master: 'MAS' }

// 형식 조합. seq 는 서버가 부여한 종목·등급·연도별 순차 번호.
export function makeCertNo(track: CertTrack, year: number, seq: number): string {
  const grade = TRACK_GRADE[track]
  return `${SUBJECT_CODE[grade]}-${grade}-${year}-${String(Math.max(1, seq)).padStart(4, '0')}`
}

// 시험명으로 트랙 추정 — "Master" 포함이면 master, 아니면 pro(기본).
export function trackOfTitle(title?: string | null): CertTrack {
  return title && /master/i.test(title) ? 'master' : 'pro'
}

// 서버 시퀀스 연동 전 임시 일련번호 — attemptId 해시(순차 아님, 형식 미리보기용).
export function tempSeq(attemptId: string): number {
  let h = 0
  for (const ch of attemptId.replace(/-/g, '')) h = (h * 31 + ch.charCodeAt(0)) % 100000
  return h || 1
}
