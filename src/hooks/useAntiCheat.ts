import { useEffect, useRef, useState } from 'react'

interface Options {
  enabled: boolean
}

interface ExamGuardState {
  violations: number // 화면 이탈 누적(관리자 참고용 — 자동 무효 아님)
  masked: boolean // 이탈/캡처 시도 시 화면 가림(캡처 무력화)
  enterFullscreen: () => Promise<void>
}

async function clearClipboard() {
  try {
    await navigator.clipboard?.writeText?.('')
  } catch {
    /* 권한 없음 — 무시 */
  }
}

// CBT 부정행위 차단 — 레벨테스트의 "3회 경고 후 무효" 대신 "완전 차단" 지향.
//  1) 우클릭/복사/잘라내기/붙여넣기/드래그/선택 차단
//  2) PrintScreen·캡처/개발자도구/소스보기/저장/인쇄 단축키 차단(+ 클립보드 무력화)
//  3) 화면 이탈(탭전환/blur)·전체화면 해제는 OS 캡처를 완전히 못 막으므로
//     화면을 가려 캡처를 무력화하고 횟수만 기록(관리자에 전달). 자동 무효는 없음.
export function useExamGuard({ enabled }: Options): ExamGuardState {
  const [violations, setViolations] = useState(0)
  const [masked, setMasked] = useState(false)
  const lastAtRef = useRef(0)

  // 1·2층: 입력/복사/단축키 차단
  useEffect(() => {
    if (!enabled) return
    const stop = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      // 캡처 키: 클립보드 비우고 잠깐 가림
      if (k === 'PrintScreen') {
        clearClipboard()
        setMasked(true)
        window.setTimeout(() => setMasked(false), 1200)
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
      if (e.key === 'PrintScreen') {
        clearClipboard()
        setMasked(true)
        window.setTimeout(() => setMasked(false), 1200)
      }
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

  // 3층: 이탈 감지 → 가림 + 횟수 기록
  useEffect(() => {
    if (!enabled) return
    const bump = () => {
      const now = Date.now()
      if (now - lastAtRef.current < 600) return // blur+visibility 중복 방지
      lastAtRef.current = now
      setViolations((v) => v + 1)
    }
    const onVisibility = () => {
      if (document.hidden) {
        setMasked(true)
        bump()
      } else {
        setMasked(false)
      }
    }
    const onBlur = () => {
      setMasked(true)
      bump()
    }
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

  async function enterFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      /* 거부/미지원 — 치명적 아님 */
    }
  }

  return { violations, masked, enterFullscreen }
}
