// 티어 엠블렘 — 이미지(public/emblems/<tier>.webp, 256px 투명 배경).
// 예전 SVG 엠블렘(TierEmblem.tsx)은 iron~master 7단계용이었는데, 티어가 5단계(브론즈~다이아)로
// 정리되면서 이 이미지가 단일 출처가 된다.
import type { Tier } from '../lib/scoring'

export default function TierBadge({
  tier,
  size = 48,
  dim = false,
  alt = '',
}: {
  tier: Tier
  size?: number
  dim?: boolean // 내 티어가 아닌 것 = 흑백+반투명
  alt?: string
}) {
  return (
    <img
      src={`/emblems/${tier}.webp`}
      width={size}
      height={size}
      alt={alt}
      loading="lazy"
      draggable={false}
      style={{
        display: 'block',
        width: size,
        height: size,
        filter: dim ? 'grayscale(1)' : undefined,
        opacity: dim ? 0.38 : 1,
      }}
    />
  )
}
