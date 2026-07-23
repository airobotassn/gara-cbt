// 이북 표지 — 등록된 표지 이미지가 있으면 그걸, 없으면 제목으로 만든 그라데이션 표지를 그린다.
//   스토어(/ebooks)·마이페이지 서재가 공유. 비율은 책 표지 관례(2:3).
const HUES = [212, 258, 190, 340, 24, 152]

function hueOf(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]
}

export default function EbookCover({
  title,
  coverUrl,
  className = '',
}: {
  title: string
  coverUrl?: string | null
  className?: string
}) {
  if (coverUrl) {
    return (
      <div className={`relative aspect-[2/3] rounded-xl overflow-hidden border border-outline-variant/40 bg-surface-container-low ${className}`}>
        <img src={coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      </div>
    )
  }
  const hue = hueOf(title)
  return (
    <div
      className={`relative aspect-[2/3] rounded-xl overflow-hidden border border-outline-variant/40 flex items-end p-3 ${className}`}
      style={{ background: `linear-gradient(150deg, hsl(${hue} 62% 52%), hsl(${(hue + 28) % 360} 58% 34%))` }}
      aria-hidden="true"
    >
      <span className="font-title-md text-[13px] leading-tight font-bold text-white/95 line-clamp-4 break-keep drop-shadow">{title}</span>
    </div>
  )
}
