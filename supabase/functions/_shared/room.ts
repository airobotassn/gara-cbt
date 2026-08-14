// 방(미니룸) 슬롯 레이아웃 — **좌표까지 포함한 단일 출처**.
//
// ⚠️ 프론트에 같은 표를 두지 않는다. 서버가 슬롯 목록과 %좌표를 통째로 내려주고,
//    프론트는 그걸 인라인 style 로 얹기만 한다. 예전 시상대처럼 CSS 에 좌표를 박으면
//    "서버엔 있는데 화면엔 안 그려지는 슬롯" 이 생기고, 슬롯을 늘릴 때마다 두 곳을 고쳐야 한다.
//
// 좌표계 = 무대(.stage-zone) 기준 %. 원점은 좌상단, 슬롯 박스의 **왼쪽 위** 모서리다.
//   지금 방은 그림이 아니라 CSS 로 그린 벽/바닥이라 이 값들이 곧 디자인이다.
//   ⚠️ 나중에 방 배경을 그림으로 갈면 **알파로 실측해서 이 표를 다시 맞춰야 한다**
//     (CLAUDE.md '그림이 먼저, 코드가 나중'). 그때도 고칠 곳은 여기 하나다.
//
// 안전 영역 — 왜 슬롯이 세 곳을 비켜 가나 (셋 다 실제로 부딪혀 보고 잡은 값이다)
//   · 오른쪽 ~16% = 오른쪽 레일(.rail-r, 출석·뽑기·상점·칭호·초대)이 absolute 로 무대 위를 덮는다.
//   · 왼쪽 위 ~30%×25% = 방 조작 버튼(.room-acts, 꾸미기·방 링크). 여기에 벽 슬롯을 두면
//     버튼이 액자를 그대로 깔고 앉는다(2026-08-14 스크린샷에서 잡음) → 벽 슬롯은 x 33/58 로 밀었다.
//   · 가운데 38~62% = CARI 가 서 있는 자리. 여기 가구를 놓으면 캐릭터에 가린다.

export type Surface = 'floor' | 'wall'

export interface RoomSlot {
  key: string
  surface: Surface
  x: number // % — 슬롯 박스 왼쪽
  y: number // % — 슬롯 박스 위쪽
}

// 벽 2칸 + 바닥 3칸. 면(面)만 구분하고 그 안에서는 뭘 놓든 자유다
// (슬롯마다 품목을 잠그면 상점이 슬롯 수만큼 쪼개져 고를 재미가 없어진다 — 2026-08-14 결정).
export const ROOM_LAYOUT: RoomSlot[] = [
  { key: 'wall:1', surface: 'wall', x: 33, y: 8 },
  { key: 'wall:2', surface: 'wall', x: 58, y: 8 },
  { key: 'floor:1', surface: 'floor', x: 3, y: 58 },
  { key: 'floor:2', surface: 'floor', x: 20, y: 64 },
  { key: 'floor:3', surface: 'floor', x: 63, y: 58 },
]

const SLOT_BY_KEY = new Map(ROOM_LAYOUT.map((s) => [s.key, s]))

export type RoomSlots = Record<string, string>

/** 슬롯 맵에서 알 수 없는 키·빈 값을 걷어낸다. 저장된 값이 낡았을 때(슬롯을 줄였을 때) 화면이 깨지지 않게. */
export function sanitizeSlots(raw: unknown): RoomSlots {
  const out: RoomSlots = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!SLOT_BY_KEY.has(k)) continue
    if (typeof v !== 'string' || !v) continue
    out[k] = v
  }
  return out
}

export interface FurnitureRow {
  part_key: string
  surface: Surface
}

/**
 * 배치 검증. 통과하면 정리된 슬롯 맵을, 아니면 에러 코드를 준다.
 *
 * ⚠️ 검증은 두 가지를 본다 — **소유**와 **면**.
 *   · 소유를 안 보면 아무나 아무 가구나 꽂는다(방은 공개라 남들이 그걸 본다).
 *   · 면을 안 보면 벽시계가 바닥에 눕고 소파가 벽에 붙는다. 그림이 들어오면 바로 깨진다.
 */
export function validateSlots(
  raw: unknown,
  owned: Set<string>,
  furniture: Map<string, Surface>,
): { ok: true; slots: RoomSlots } | { ok: false; error: string } {
  const slots = sanitizeSlots(raw)
  for (const [slotKey, partKey] of Object.entries(slots)) {
    const slot = SLOT_BY_KEY.get(slotKey)!
    if (!owned.has(partKey)) return { ok: false, error: 'not_owned' }
    const surface = furniture.get(partKey)
    if (!surface) return { ok: false, error: 'not_furniture' }
    if (surface !== slot.surface) return { ok: false, error: 'wrong_surface' }
  }
  return { ok: true, slots }
}
