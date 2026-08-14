// 방(미니룸) 프론트 공용 — 타입 + 가구 그림 매핑.
//
// ⚠️ 슬롯 목록과 좌표는 **여기 없다.** 서버(_shared/room.ts)가 layout 으로 통째로 내려주고
//    화면은 그걸 인라인 style 로 얹는다. 여기에 좌표표를 복제하면 동기화 페어가 하나 더 생긴다.

export type Surface = 'floor' | 'wall'

export interface RoomSlot {
  key: string
  surface: Surface
  x: number // % — 무대(.stage-zone) 기준, 슬롯 박스 왼쪽
  y: number // % — 슬롯 박스 위쪽
}

/** {슬롯키: part_key}. 빈 슬롯은 키 자체가 없다. */
export type RoomSlots = Record<string, string>

export interface RoomData {
  slots: RoomSlots
  layout: RoomSlot[]
}

// 가구 그림 — **아직 그림이 없어서 이모지다**(2026-08-14: CSS 방으로 구조부터).
//   그림이 생기면 여기 값을 <img src> 로 바꾸면 되고, DB(shop_catalog)·서버·슬롯 좌표는 안 바뀐다.
//   ⚠️ 새 가구를 DB 에 넣으면 여기에도 한 줄 추가할 것 — 없으면 아래 기본 상자로 그려진다(깨지진 않는다).
const FURNITURE_ART: Record<string, string> = {
  fur_plant_01: '🪴',
  fur_lamp_01: '💡',
  fur_chair_01: '🪑',
  fur_sofa_01: '🛋️',
  fur_wardrobe_01: '🗄️',
  fur_bed_01: '🛏️',
  fur_frame_01: '🖼️',
  fur_clock_01: '🕰️',
  fur_shelf_01: '📚',
  fur_window_01: '🪟',
  fur_aquarium_01: '🐠',
  fur_neon_01: '🌈',
}

export function furnitureArt(partKey: string): string {
  return FURNITURE_ART[partKey] ?? '📦'
}

/** 방 주소. 지금 handle = uid — 서버 room 함수의 handle 해석과 짝이다(짧은 코드로 바꾸면 양쪽 한 줄씩). */
export function roomPath(handle: string): string {
  return `/room/${handle}`
}

export function roomUrl(handle: string): string {
  return `${window.location.origin}${roomPath(handle)}`
}
