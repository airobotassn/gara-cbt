// CBT 는 PC 에서만 응시 허용 → 모바일/태블릿 감지
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const mobileUA =
    /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|BlackBerry|webOS|Windows Phone|Mobile/i.test(ua)
  // iPadOS 13+ : 데스크톱 UA 로 위장 + 멀티터치 → 보조 판별
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1
  // 터치 위주 + 좁은 화면(휴대폰 폭)
  const coarse =
    typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches
  const narrow = typeof window !== 'undefined' && window.innerWidth < 900
  return mobileUA || iPadOS || (coarse && narrow)
}
