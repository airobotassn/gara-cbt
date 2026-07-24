// 카와이 젬 마스코트(자체 SVG) — 동그란 눈 + 미소 + 파스텔 + 두꺼운 외곽선.
// 외부 서비스/스토리지 없이 색만 바꿔 사용.
import { parseAvatar, colorForSeed } from '../lib/avatar'

const DARK = '#2b2d42'
const HEX = '50,7 89,28.5 89,71.5 50,93 11,71.5 11,28.5'

// 젬 SVG 문자열(자립형 — 외부 이미지/폰트 참조 없음).
// 컴포넌트와 공유 카드(lib/shareCard.ts)가 같은 마크업을 쓴다(둘이 어긋나지 않게 단일 출처).
// eslint-disable-next-line react-refresh/only-export-components
export function gemSvgMarkup(color: string, size: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">` +
    /* 몸통(둥근 육각 젬) */
    `<polygon points="${HEX}" fill="${color}" stroke="${DARK}" stroke-width="6" stroke-linejoin="round"/>` +
    /* 상단 컷 면 하이라이트 */
    `<polygon points="50,7 89,28.5 50,50 11,28.5" fill="#fff" opacity="0.2"/>` +
    /* 광택 */
    `<ellipse cx="36" cy="29" rx="11" ry="5.5" fill="#fff" opacity="0.55" transform="rotate(-20 36 29)"/>` +
    /* 볼터치 */
    `<ellipse cx="31" cy="61" rx="6" ry="4" fill="#ff6f91" opacity="0.5"/>` +
    `<ellipse cx="69" cy="61" rx="6" ry="4" fill="#ff6f91" opacity="0.5"/>` +
    /* 눈 */
    `<circle cx="39" cy="54" r="5" fill="${DARK}"/><circle cx="61" cy="54" r="5" fill="${DARK}"/>` +
    `<circle cx="41" cy="52" r="1.6" fill="#fff"/><circle cx="63" cy="52" r="1.6" fill="#fff"/>` +
    /* 미소 */
    `<path d="M43 64 Q50 71 57 64" fill="none" stroke="${DARK}" stroke-width="3" stroke-linecap="round"/>` +
    `</svg>`
  )
}

export default function GemAvatar({
  color,
  size = 44,
}: {
  color: string
  size?: number
}) {
  return (
    <span
      style={{ display: 'block', lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: gemSvgMarkup(color, size) }}
    />
  )
}

// 어디서나 같은 규칙으로 그리는 공용 아바타(업로드 이미지면 원형 img, 아니면 젬).
// (젬 색·시드·avatar_url 해석 헬퍼는 lib/avatar.ts)
export function Avatar({
  avatarUrl,
  seed = 'guest',
  size = 44,
}: {
  avatarUrl?: string | null
  seed?: string
  size?: number
}) {
  const spec = parseAvatar(avatarUrl, seed)
  if (spec.kind === 'image') {
    return (
      <img
        src={spec.url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    )
  }
  if (spec.kind === 'mascot') {
    // 전신 마스코트(비정사각) → 원형 안에 contain 으로 전체가 보이게, 연한 배경으로 여백 정리.
    return (
      <img
        src={spec.url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'contain',
          background: '#eef1f6',
          display: 'block',
        }}
      />
    )
  }
  if (spec.kind === 'character') {
    // Phase-2 캐릭터(장착 파츠) 풀 렌더는 이후 슬라이스(user_characters/user_cosmetics)에서.
    // 지금은 char: 를 캐릭터 id 로 시드한 플레이스홀더 젬 + 소형 캐릭터 배지 점으로 안전 폴백 → 절대 blank 안 됨.
    return (
      <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
        <GemAvatar color={colorForSeed(spec.id)} size={size} />
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: Math.max(6, Math.round(size * 0.22)),
            height: Math.max(6, Math.round(size * 0.22)),
            borderRadius: '50%',
            background: '#2b2d42',
            border: '1.5px solid #fff',
            boxSizing: 'border-box',
          }}
        />
      </span>
    )
  }
  return <GemAvatar color={spec.color} size={size} />
}
