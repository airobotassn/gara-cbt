// 주관식 단답 정규화 — 표기 변형(대소문자·공백·하이픈·구두점)만 흡수해 정답 비교에 쓴다.
// 채점은 이 정규화 후 "정확일치"만 사용(임베딩/유사도/편집거리 없음 — 자격검정 false positive 방지).
// ⚠️ src/lib/normalize.ts ↔ supabase/functions/_shared/normalize.ts 는 항상 동일 내용으로 유지할 것.
//    (관리자 미리보기 판정과 서버 채점이 어긋나면 안 됨) — <normalize-sync>

// 제거 대상 구두점(명시 열거). \p{P}는 런타임 ICU 버전차로 결과가 갈릴 수 있어 쓰지 않는다.
//  · 보존: 숫자 사이 '.'/','(2.5·1,000)과 연산자 + = & _ %(H+ ≠ H, a_b) — 의미 훼손 방지.
const HYPHENS = /[-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]/g
const PUNCT = /[.,/~:;!?()[\]{}<>'"`‘’“”·・|]/g

export function normalizeAnswer(input: string | null | undefined): string {
  if (!input) return ''
  let t = input.normalize('NFKC')
  // 숫자 사이 '.' ',' 는 보존: 임시 제어문자로 대피 후 마지막에 복원.
  t = t.replace(/(\d)\.(\d)/g, '$1\u0001$2').replace(/(\d),(\d)/g, '$1\u0002$2')
  t = t.replace(/\s+/g, '') // 모든 공백류 제거(NFKC로 전각공백→일반공백 후)
  t = t.replace(HYPHENS, '') // 하이픈/대시류 제거
  t = t.replace(PUNCT, '') // 명시 구두점 제거(+ = & _ % 는 보존)
  t = t.replaceAll('\u0001', '.').replaceAll('\u0002', ',')
  return t.toLowerCase()
}

// answer_key(줄바꿈 구분 허용답안 목록) → 정규화된 유니크 목록.
export function parseAcceptedAnswers(answerKey: string | null | undefined): string[] {
  if (!answerKey) return []
  const set = new Set<string>()
  for (const line of answerKey.split(/\r?\n/)) {
    const n = normalizeAnswer(line)
    if (n) set.add(n)
  }
  return [...set]
}

// 제출 답안이 허용답안 중 하나와 정규화 정확일치하면 정답.
// 허용답안이 하나도 없으면 false → 호출측이 자동채점 대신 수동검수(pending)로 폴백한다.
export function matchShort(submitted: string | null | undefined, answerKey: string | null | undefined): boolean {
  const accepted = parseAcceptedAnswers(answerKey)
  if (accepted.length === 0) return false
  const s = normalizeAnswer(submitted)
  if (!s) return false
  return accepted.includes(s)
}
