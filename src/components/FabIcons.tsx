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

// 맨 위로(scroll-to-top) 버튼용 위쪽 화살표
export function ChevronUpIcon(p: IcoProps) {
  return (
    <Ico {...p}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
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
