// 카와이 젬 마스코트(자체 SVG) — 동그란 눈 + 미소 + 파스텔 + 두꺼운 외곽선.
// 외부 서비스/스토리지 없이 색만 바꿔 사용.
import { parseAvatar } from '../lib/avatar'

const DARK = '#2b2d42'
const HEX = '50,7 89,28.5 89,71.5 50,93 11,71.5 11,28.5'

export default function GemAvatar({
  color,
  size = 44,
}: {
  color: string
  size?: number
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      style={{ display: 'block' }}
    >
      {/* 몸통(둥근 육각 젬) */}
      <polygon
        points={HEX}
        fill={color}
        stroke={DARK}
        strokeWidth={6}
        strokeLinejoin="round"
      />
      {/* 상단 컷 면 하이라이트 */}
      <polygon points="50,7 89,28.5 50,50 11,28.5" fill="#fff" opacity="0.2" />
      {/* 광택 */}
      <ellipse
        cx="36"
        cy="29"
        rx="11"
        ry="5.5"
        fill="#fff"
        opacity="0.55"
        transform="rotate(-20 36 29)"
      />
      {/* 볼터치 */}
      <ellipse cx="31" cy="61" rx="6" ry="4" fill="#ff6f91" opacity="0.5" />
      <ellipse cx="69" cy="61" rx="6" ry="4" fill="#ff6f91" opacity="0.5" />
      {/* 눈 */}
      <circle cx="39" cy="54" r="5" fill={DARK} />
      <circle cx="61" cy="54" r="5" fill={DARK} />
      <circle cx="41" cy="52" r="1.6" fill="#fff" />
      <circle cx="63" cy="52" r="1.6" fill="#fff" />
      {/* 미소 */}
      <path
        d="M43 64 Q50 71 57 64"
        fill="none"
        stroke={DARK}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
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
  return <GemAvatar color={spec.color} size={size} />
}
