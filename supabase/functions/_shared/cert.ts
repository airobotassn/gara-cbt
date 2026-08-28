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

/** 등급 → 자격종목 코드. 채번 RPC 에 넘길 값이라 밖에서도 쓴다. */
export function subjectOf(grade: GradeCode): SubjectCode {
  return SUBJECT_CODE[grade]
}

/** 일련번호 자릿수 — 프론트 certNo.ts 의 SEQ_DIGITS 와 같은 값이어야 한다. */
export const SEQ_DIGITS = 6

// 자격번호 형식 조합 — {종목}-{등급}-{연도}-{일련(6자리)}.
// ⚠️ seq 는 **DB RPC `next_cert_seq` 가 부여한 값만** 넣는다. 여기서 만들어내지 말 것
//    (해시·타임스탬프 같은 임시 번호를 넣으면 중복이 나가고, 되돌릴 수 없다).
export function makeCertNo(grade: GradeCode, year: number, seq: number): string {
  return `${SUBJECT_CODE[grade]}-${grade}-${year}-${String(Math.max(1, seq)).padStart(SEQ_DIGITS, '0')}`
}

// 등급 → 유효기간(개월). null=무기한.
export function expiryMonths(grade: GradeCode): number | null {
  return EXPIRY_MONTHS[grade]
}

// ── 레벨테스트(무료) 인증서 진위확인 토큰 ─────────────────────────────────
// ⚠️ **임시 방식이다(2026-08-28).** CBT 는 발급 시점에 난수를 뽑아 exam_attempts.verify_token 에
//    저장하지만, 레벨테스트 인증서에는 '발급' 이라는 사건이 없다(레벨을 깨는 순간부터 유효) —
//    난수를 담아둘 행이 없다. 그래서 지금은 **user_id 를 되돌릴 수 있게 인코딩**해 토큰으로 쓴다.
//    · 위조해도 얻는 게 없다 — verify-cert 는 토큰이 가리키는 **서버 원본 기록**만 보고 판정한다.
//    · 대가: QR 을 뜯으면 그 사람의 user_id 가 보인다(uid 만으로는 아무 권한도 없다. RLS 는 JWT 를 본다).
// ⛔ 제대로 하려면 user_progress 에 verify_token(난수·유니크) 컬럼을 만들고 **이 두 함수만** 갈아끼운다.
//    부르는 곳은 list-attempts(발급)와 verify-cert(조회) 둘뿐이라 그때 형식이 바뀌어도 옛 QR 만 죽는다.
const LEVEL_TOKEN_PREFIX = 'lv-'

/** user_id(uuid) → `lv-<base64url 22자>`. uuid 가 아니면 빈 문자열(= QR 을 그리지 않는다). */
export function levelCertToken(userId: string): string {
  const hex = (userId ?? '').replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) return ''
  let bin = ''
  for (let i = 0; i < 32; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return LEVEL_TOKEN_PREFIX + b64
}

/** 토큰 → user_id. 레벨테스트 토큰이 아니거나 형식이 깨졌으면 null(= CBT 토큰으로 넘긴다). */
export function parseLevelCertToken(token: string): string | null {
  if (typeof token !== 'string' || !token.startsWith(LEVEL_TOKEN_PREFIX)) return null
  const raw = token.slice(LEVEL_TOKEN_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')
  try {
    const bin = atob(raw + '='.repeat((4 - (raw.length % 4)) % 4))
    if (bin.length !== 16) return null
    let hex = ''
    for (let i = 0; i < 16; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  } catch {
    return null
  }
}

/** 레벨 인증서의 표시용 조회번호. ⚠️ 자격번호(makeCertNo)가 **아니다** — 채번 대장이 없다. */
export function levelCertNo(userId: string, level: number, issuedAt?: string | null): string {
  const year = issuedAt ? new Date(issuedAt).getFullYear() : new Date().getFullYear()
  const tail = (userId ?? '').replace(/-/g, '').slice(-6).toUpperCase()
  return `WA-L${level}-${year}-${tail || '000000'}`
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
