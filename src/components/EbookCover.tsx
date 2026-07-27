// 이북 표지 — 등록된 표지 이미지가 있으면 그걸, 없으면 제목으로 만든 그라데이션 표지를 그린다.
//   스토어(/ebooks)·마이페이지 서재가 공유. 비율은 책 표지 관례(2:3).
//
// 선명도: 표지 원본은 1500px대인데 썸네일 칸이 작으면 글자가 뭉갠다. 그래서
//   (1) 칸을 충분히 크게 잡고(호출부), (2) Supabase Storage 이미지 변환으로
//   **표시 크기의 2배**를 받아 고밀도 화면에서도 또렷하게 한다(전송량도 줄어든다).
const HUES = [212, 258, 190, 340, 24, 152]

/** 공개 스토리지 URL → 변환 URL(width=표시폭×2). 변환 대상이 아니면 원본 그대로. */
function sharpen(url: string, cssWidth?: number): string {
  const MARK = '/storage/v1/object/public/'
  if (!cssWidth || !url.includes(MARK) || url.includes('?')) return url
  return `${url.replace(MARK, '/storage/v1/render/image/public/')}?width=${Math.round(cssWidth * 2)}&resize=contain&quality=90`
}

function hueOf(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]
}

export default function EbookCover({
  title,
  coverUrl,
  className = '',
  width,
}: {
  title: string
  coverUrl?: string | null
  className?: string
  /** 화면에 그려지는 폭(css px). 이미지 변환 해상도 계산에 쓴다 — 없으면 원본을 그대로 받는다. */
  width?: number
}) {
  if (coverUrl) {
    return (
      <div className={`relative aspect-[2/3] rounded-xl overflow-hidden border border-outline-variant/40 bg-surface-container-low ${className}`}>
        <img
          src={sharpen(coverUrl, width)}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
        />
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
