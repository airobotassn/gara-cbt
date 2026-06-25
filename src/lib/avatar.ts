// 캐릭터 이미지 업로드 유틸 — 클라에서 정사각 센터크롭 + 256px 리사이즈 후 Supabase Storage 업로드.
//   저장 경로: avatars/<uid>/avatar_<ts>.webp  (RLS: 폴더 첫 칸 = 본인 uid)
//   avatar_url 에는 'img:<public-url>?v=<ts>' 로 기록(캐시 무력화).
import { supabase } from './supabase'

// 귀여운 파스텔 8색(젬 기본 팔레트)
export const GEM_COLORS = [
  '#7cc6ff',
  '#ffb0c4',
  '#9be5b3',
  '#ffd36e',
  '#c3b1ff',
  '#7fded0',
  '#ff9d8a',
  '#b8c2ff',
]

export function colorForSeed(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return GEM_COLORS[h % GEM_COLORS.length]
}

// avatar_url 해석: 'img:<url>'=업로드 이미지 · 'gem:#hex'=젬 · 그 외/NULL=시드 젬(구글 URL 등은 무시).
export type AvatarSpec =
  | { kind: 'image'; url: string }
  | { kind: 'gem'; color: string }

export function parseAvatar(
  avatarUrl: string | null | undefined,
  seed: string,
): AvatarSpec {
  if (avatarUrl?.startsWith('img:')) return { kind: 'image', url: avatarUrl.slice(4) }
  if (avatarUrl?.startsWith('gem:')) return { kind: 'gem', color: avatarUrl.slice(4) }
  return { kind: 'gem', color: colorForSeed(seed) }
}

const OUT = 256 // 출력 한 변(px)
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024 // 3MB (버킷 제한과 일치)

// 파일 → 256x256 정사각 webp Blob (브라우저 캔버스).
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2
  const canvas = document.createElement('canvas')
  canvas.width = OUT
  canvas.height = OUT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unsupported')
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, OUT, OUT)
  bitmap.close?.()
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('encode failed'))),
      'image/webp',
      0.9,
    ),
  )
}

// 업로드 후 avatar_url 에 넣을 값('img:...')을 반환.
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드할 수 있어요.')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('이미지는 3MB 이하만 가능해요.')

  const blob = await toSquareWebp(file)
  const ts = Date.now()
  const path = `${userId}/avatar_${ts}.webp`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { contentType: 'image/webp', upsert: true })
  if (error) throw error

  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return `img:${data.publicUrl}?v=${ts}`
}
