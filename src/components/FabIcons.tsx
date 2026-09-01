// FAB 패널 전용 선(line) 아이콘 세트 — 컬러 이모지 대신 currentColor 스트로크 SVG.
// 다크/라이트 테마에 자동으로 맞춰지고(색=currentColor), 톤은 로그아웃 아이콘과 통일.
import type { SVGProps } from 'react'

type IcoProps = { size?: number } & SVGProps<SVGSVGElement>

// 공통 래퍼: 24 그리드, 얇은 라운드 스트로크.
function Ico({ size = 20, children, ...rest }: IcoProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function HomeIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9.5" />
    </Ico>
  )
}

// 맨 위로(scroll-to-top) 버튼용 꺾쇠 — 줄기 없는 `^` 하나다(2026-09-01 지시).
// 줄기를 빼면 위쪽으로 쏠려 보이므로 꺾쇠를 세로 가운데(9~15)로 내려 앉힌다.
export function ChevronUpIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <path d="m6 15 6-6 6 6" />
    </Ico>
  )
}

// 이북(전자책) — 펼친 책
export function BookIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <path d="M12 6.5C10.6 5.2 8.7 4.5 6.5 4.5H4v13h2.5c2.2 0 4.1.7 5.5 2" />
      <path d="M12 6.5c1.4-1.3 3.3-2 5.5-2H20v13h-2.5c-2.2 0-4.1.7-5.5 2" />
      <path d="M12 6.5v13" />
    </Ico>
  )
}

export function ExamIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h5" />
    </Ico>
  )
}

export function CalendarIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M8 2.5v4M16 2.5v4M3 9.5h18" />
    </Ico>
  )
}

export function TargetIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </Ico>
  )
}

export function InfoIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </Ico>
  )
}

export function UserIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Ico>
  )
}

export function SunIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Ico>
  )
}

export function MoonIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Ico>
  )
}

// WORLD ARENA 항목용. 대륙 실루엣이라 "지구(Earth)"로 읽힌다 —
// 위경선 지구본인 GlobeIcon 은 "언어" 라벨이 쓰고 있어 뜻이 겹치지 않게 분리.
export function EarthIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M20.5 14.5H17a2 2 0 0 0-2 2v3.6" />
      <path d="M7.5 3.9V5a3 3 0 0 0 3 3 2 2 0 0 1 2 2 2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 1 2-2h2.6" />
      <path d="M11 20.9V18a2 2 0 0 0-2-2 2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H3.1" />
    </Ico>
  )
}

// "언어" 라벨용 위경선 지구본.
export function GlobeIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.4 3.8 5.6 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3z" />
    </Ico>
  )
}

export function ToolIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <path d="M14.6 6.3a3.8 3.8 0 0 0-5 5L4 16.9 7.1 20l5.6-5.6a3.8 3.8 0 0 0 5-5l-2.5 2.5-2.5-2.5z" />
    </Ico>
  )
}

export function MoreIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </Ico>
  )
}

export function PencilIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Ico>
  )
}

export function CameraIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <path d="M3 8h3l2-2.5h8L18 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </Ico>
  )
}

/**
 * 1:1 문의 '새 답변' 알림 종 — 옛 빨간 점을 대신한다(2026-08-12 요청).
 * FAB 배지와 마이페이지 문의 탭 옆 **두 곳이 같은 그림·같은 색**을 쓴다.
 * ⚠️ 여기만 채움(fill) 아이콘이다 — 이 세트의 선(stroke) 아이콘 규격으로 그리면
 *    배지 크기에서 속이 비어 보여 '알림'이 아니라 작은 그림으로 읽힌다.
 * 색(노랑)과 윤곽선은 CSS 의 `.alert-bell`(fab.css)이 잡는다 — 여기서 색을 박지 말 것.
 */
export function BellIcon({ size = 20, ...rest }: IcoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
      <path d="M12 2.2a1.5 1.5 0 0 1 1.5 1.5v.6a6.2 6.2 0 0 1 4.6 6v3l1.3 2.2a1 1 0 0 1-.86 1.5H5.46a1 1 0 0 1-.86-1.5L5.9 13.3v-3a6.2 6.2 0 0 1 4.6-6v-.6A1.5 1.5 0 0 1 12 2.2Z" />
      <path d="M9.5 19.3h5a2.5 2.5 0 0 1-5 0Z" />
    </svg>
  )
}
