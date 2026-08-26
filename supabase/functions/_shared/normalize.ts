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

// 한국어 원문(answer_key) + 번역본(answer_key_i18n) 을 **합쳐** 허용답안 목록을 만든다.
// 주관식 채점의 단일 출처 — 응시 언어와 무관하게 이 하나만 본다.
//
// ⛔ **언어별로 가르지 않고 전부 합친다.** 일본어로 응시해도 기술 용어는 영어로 쓰는 일이 흔하고
//    ('Edge Computing'), 한국어 표기를 그대로 치는 사람도 있다. 어느 쪽이든 맞는 답인데
//    응시 언어의 목록만 보면 **맞은 답을 틀렸다고 한다.** 합집합이라 느슨해 보이지만, 애초에
//    다른 문항의 답이 섞이지 않는 한(한 문항의 자기 답들이다) 오답이 통과할 길은 없다.
// ⚠️ 정규화 후 중복은 자연히 접힌다 — 원문에 이미 영어 표기가 섞여 있는 문항이 많다.
export function acceptedAnswerPool(
  answerKey: string | null | undefined,
  answerKeyI18n: unknown,
): string[] {
  const set = new Set<string>(parseAcceptedAnswers(answerKey))
  const m = answerKeyI18n as Record<string, unknown> | null | undefined
  if (m && typeof m === 'object') {
    for (const v of Object.values(m)) {
      if (!Array.isArray(v)) continue
      for (const line of v) {
        const n = normalizeAnswer(String(line ?? ''))
        if (n) set.add(n)
      }
    }
  }
  return [...set]
}

// 이 응시 언어로 자동채점을 해도 되나 — **자동채점의 안전장치다.**
//
// ⛔ 합집합만 보고 채점하면 안 된다. 일본어로 출제된 문항인데 일본어 허용답안이 아직 없으면,
//    응시자는 일본어로 답을 쓰는데 목록엔 한국어·영어뿐이라 **맞은 답이 오답으로 확정된다.**
//    (자동채점은 되돌릴 기회 없이 그대로 굳는다 — 예전에 koAttempt 로 통째로 막아뒀던 그 사고다.)
//    번역이 없으면 채점하지 말고 pending 으로 넘겨 사람이 본다.
// ⚠️ 한국어 응시는 원문 자체가 그 언어라 언제나 준비된 것으로 본다.
export function answerLangReady(answerKeyI18n: unknown, lang: string): boolean {
  if (!lang || lang === 'ko') return true
  const v = (answerKeyI18n as Record<string, unknown> | null | undefined)?.[lang]
  return Array.isArray(v) && v.some((x) => String(x ?? '').trim())
}

// 제출 답안이 합집합(원문+번역본) 중 하나와 정규화 정확일치하면 정답.
// 합집합이 비면 false → 호출측이 수동검수(pending)로 폴백한다(matchShort 와 같은 규칙).
export function matchShortPool(
  submitted: string | null | undefined,
  answerKey: string | null | undefined,
  answerKeyI18n: unknown,
): boolean {
  const accepted = acceptedAnswerPool(answerKey, answerKeyI18n)
  if (accepted.length === 0) return false
  const s = normalizeAnswer(submitted)
  if (!s) return false
  return accepted.includes(s)
}
