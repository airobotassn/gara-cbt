import { useEffect, useState } from 'react'

// 부정행위 차단(브라우저 JS). ⚠️ 운영 보안의 본체는 SEB(OS 레벨)다 — 이 훅들은 우회 가능하므로
// SEB 가 강제되지 않는 화면(모의응시·개발/데모)용 보조 + 약한 defense-in-depth 로만 본다.
// 입력차단(useInputGuard)과 이탈감지(useLeaveGuard)는 성격이 달라 분리한다:
//   · 입력차단  = SEB 와 기능 중복(SEB 안에선 사실상 불필요)
//   · 이탈감지  = SEB 안에선 탭/앱 전환 자체가 막혀 거의 안 쌓임 → SEB 밖에서만 의미

interface Options {
  enabled: boolean
}

async function clearClipboard() {
  try {
    await navigator.clipboard?.writeText?.('')
  } catch {
    /* 권한 없음 — 무시 */
  }
}

// ① 입력 차단 — 우클릭/복사/잘라내기/붙여넣기/드래그/선택 + 개발자도구/저장/인쇄/소스보기 단축키,
//    PrintScreen 시 클립보드 비우고 잠깐 화면 가림. 반환 masked = 캡처키 순간 가림 여부.
export function useInputGuard({ enabled }: Options): { masked: boolean } {
  const [masked, setMasked] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const stop = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const flashMask = () => {
      clearClipboard()
      setMasked(true)
      window.setTimeout(() => setMasked(false), 1200)
    }
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if (k === 'PrintScreen') {
        flashMask()
        e.preventDefault()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (k === 'F12') {
        e.preventDefault()
        return
      }
      // 개발자도구(Ctrl/Cmd+Shift+I/J/C)
      if (mod && e.shiftKey && ['i', 'j', 'c'].includes(k.toLowerCase())) {
        e.preventDefault()
        return
      }
      // 소스보기(U)/저장(S)/인쇄(P)/복사(C)/잘라내기(X)/전체선택(A)/붙여넣기(V)
      if (mod && ['u', 's', 'p', 'c', 'x', 'a', 'v'].includes(k.toLowerCase())) {
        e.preventDefault()
        return
      }
    }
    // PrintScreen 은 keydown 이 아니라 keyup 에서만 잡히는 경우가 많음 → 둘 다 처리
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') flashMask()
    }
    const evs = ['contextmenu', 'copy', 'cut', 'paste', 'dragstart', 'selectstart']
    evs.forEach((ev) => document.addEventListener(ev, stop, true))
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('keyup', onKeyUp, true)
    return () => {
      evs.forEach((ev) => document.removeEventListener(ev, stop, true))
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('keyup', onKeyUp, true)
    }
  }, [enabled])

  return { masked }
}

// ② 이탈 감지 — visibilitychange/blur/focus. 이탈 시 화면 가림. 반환 masked = 이탈 중 가림 여부.
//    (부정행위 차단의 본체는 SEB(OS 레벨). 위반 횟수 집계는 제거 — SEB가 이탈 자체를 막음.)
export function useLeaveGuard({ enabled }: Options): { masked: boolean } {
  const [masked, setMasked] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const onVisibility = () => setMasked(document.hidden)
    const onBlur = () => setMasked(true)
    const onFocus = () => setMasked(false)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled])

  return { masked }
}

// 전체화면 진입 — 상태 없는 헬퍼. 추후 모의고사(비-SEB)에서 전체화면 강제용으로 직접 호출.
export async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
    }
  } catch {
    /* 거부/미지원 — 치명적 아님 */
  }
}
