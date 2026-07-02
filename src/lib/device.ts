// 데스크톱 OS 감지 — SEB 설치본(Windows .exe / macOS .dmg)을 알맞게 내려주기 위함
export function getDesktopOS(): 'windows' | 'mac' | 'other' {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent || ''
  const plat = (navigator as unknown as { platform?: string }).platform || ''
  if (/Win/i.test(ua) || /Win/i.test(plat)) return 'windows'
  if (/Mac/i.test(ua) || /Mac/i.test(plat)) return 'mac'
  return 'other'
}

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
