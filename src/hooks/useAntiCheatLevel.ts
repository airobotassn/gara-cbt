import { useEffect, useRef, useState } from 'react'
import { MAX_VIOLATIONS } from '../lib/testConfigLevel'

interface Options {
  enabled: boolean
  onLimitReached: () => void // 위반 누적 한계 도달 시(무효 처리)
}

/** 위반 1건. 제출·무효 시 서버로 보내 test_attempts.violations 에 쌓인다(관리자 상세의 원천). */
export interface ViolationLog {
  at: string // ISO
  reason: string // 'tab' | 'blur' | 'fs'
}

interface AntiCheatState {
  violations: number
  lastWarning: string | null
  /** 누적 내역. 렌더에 안 쓰이고 제출 시점에 그대로 실어보내기만 해서 state 가 아니라 ref 다. */
  logRef: React.RefObject<ViolationLog[]>
  enterFullscreen: () => Promise<void>
}

// 1층: 우클릭/복사/드래그/선택 차단
// 2층: 전체화면 진입 + 탭/창 이탈 감지 → 경고·카운트, MAX 도달 시 자동 제출
export function useAntiCheat({ enabled, onLimitReached }: Options): AntiCheatState {
  const [violations, setViolations] = useState(0)
  const [lastWarning, setLastWarning] = useState<string | null>(null)
  const submittedRef = useRef(false)
  const countRef = useRef(0)
  const lastAtRef = useRef(0)
  const logRef = useRef<ViolationLog[]>([])
  const onLimitRef = useRef(onLimitReached)
  onLimitRef.current = onLimitReached

  // 1층: 컨텍스트 메뉴/복사/드래그 차단
  useEffect(() => {
    if (!enabled) return
    const block = (e: Event) => e.preventDefault()
    const events = ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart']
    events.forEach((ev) => document.addEventListener(ev, block))
    return () => events.forEach((ev) => document.removeEventListener(ev, block))
  }, [enabled])

  // 2층: 이탈 감지
  useEffect(() => {
    if (!enabled) return

    // reasonKey: 'tab' | 'blur' | 'fs' (화면에서 번역). lastWarning 에는 키만 저장.
    const registerViolation = (reasonKey: string) => {
      if (submittedRef.current) return
      // 같은 이탈이 blur+visibilitychange로 2번 세지는 것 방지(600ms 디바운스)
      const now = Date.now()
      if (now - lastAtRef.current < 600) return
      lastAtRef.current = now

      countRef.current += 1
      const next = countRef.current
      logRef.current.push({ at: new Date(now).toISOString(), reason: reasonKey })
      setViolations(next)
      setLastWarning(reasonKey)
      if (next >= MAX_VIOLATIONS) {
        submittedRef.current = true
        onLimitRef.current()
      }
    }

    const onVisibility = () => {
      if (document.hidden) registerViolation('tab')
    }
    const onBlur = () => registerViolation('blur')
    const onFsChange = () => {
      if (!document.fullscreenElement) registerViolation('fs')
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('fullscreenchange', onFsChange)
    }
  }, [enabled])

  async function enterFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // 사용자가 거부하거나 미지원 — 치명적이지 않음(2층 감지는 계속 동작)
    }
  }

  return { violations, lastWarning, logRef, enterFullscreen }
}
