// 방(미니룸) 렌더러 — /hub(내 방)와 /room/:handle(남의 방)이 **같은 그림**을 쓴다.
//
// 왜 컴포넌트로 뺐나: 두 화면이 각자 그리면 내 방과 남이 보는 내 방이 서로 달라진다.
// 그 차이는 배치를 바꿔봐야 드러나서 제일 늦게 발견된다.
//
// 좌표는 props.layout(서버가 준 것)만 쓴다 — 여기에 슬롯표를 두지 않는다.
import type { ReactNode } from 'react'
import { furnitureArt, type RoomSlot, type RoomSlots } from '../lib/room'

export default function RoomView({
  layout,
  slots,
  name,
  badge,
  editing = false,
  activeSlot = null,
  onSlotClick,
}: {
  layout: RoomSlot[]
  slots: RoomSlots
  name: string
  badge?: ReactNode
  /** 꾸미기 모드 — 빈 슬롯이 눌리는 자리로 보인다. 남의 방에서는 항상 false. */
  editing?: boolean
  activeSlot?: string | null
  onSlotClick?: (slotKey: string) => void
}) {
  return (
    <div className={`room${editing ? ' is-editing' : ''}`}>
      {/* 벽·바닥은 아직 그림이 아니라 CSS 두 면이다(2026-08-14: 구조부터).
          ⚠️ 나중에 벽지를 상품으로 팔면 이 두 면이 갈아끼우는 자리가 된다 —
             그래서 슬롯 좌표는 처음부터 배경 그림과 무관하게 잡혀 있다. */}
      <div className="room-wall" aria-hidden="true" />
      <div className="room-floor" aria-hidden="true" />

      {layout.map((s) => {
        const part = slots[s.key] ?? null
        // 꾸미기 모드가 아니면 빈 슬롯은 아예 안 그린다 — 남의 방에 점선 상자가 뜨면 사고처럼 보인다.
        if (!part && !editing) return null
        const style = { left: `${s.x}%`, top: `${s.y}%` }
        const inner = part
          ? <span className="rm-art">{furnitureArt(part)}</span>
          : <span className="rm-plus">+</span>
        const cls = `rm-slot${part ? ' has' : ''}${activeSlot === s.key ? ' on' : ''}`
        return editing ? (
          <button
            key={s.key}
            type="button"
            className={cls}
            data-surface={s.surface}
            style={style}
            onClick={() => onSlotClick?.(s.key)}
          >
            {inner}
          </button>
        ) : (
          <div key={s.key} className={cls} data-surface={s.surface} style={style} aria-hidden="true">
            {inner}
          </div>
        )
      })}

      <div className="stage">
        <div className="pedestal" />
        <img className="hero-char" src="/hub-char.png" alt="CARI" />
        <div className="nameplate"><b>{name}</b> {badge}</div>
      </div>
    </div>
  )
}
