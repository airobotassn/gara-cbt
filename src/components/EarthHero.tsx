// 랜딩 히어로 배경 — 우주 + NASA 지구 영상.
//
// 영상 = public/earth.mp4 (1760x1760, 24fps, H.264, 21.6MB)
//   출처는 NASA SVS #30878 "Black Marble 2016 Rotating Globe" 4K 원본.
//   원본 프레임 3840x2160 안에서 구가 차지하는 건 중심(1913.5,1076.5)·반지름 855.5 뿐이고
//   나머지 80% 는 clip-path 로 어차피 잘려나가는 검은 여백이라 인코딩 단계에서 크롭했다.
//   구의 실해상도(지름 1711px)는 원본 그대로다 — 줄인 건 프레임당 디코딩 부하(8.3MP→3.1MP).
//   145초가 정확히 한 바퀴 자전이라 이음새 없이 루프된다. **길이를 자르면 대륙이 튄다.**
//
// 대기광 림(파란 테두리)을 CSS 로 안 그린다:
//   영상에 이미 진짜 대기 산란이 구워져 있다. 그 위에 CSS 로 균일한 링을 덧그리면
//   이중으로 겹쳐서 "떼운 것" 처럼 보인다(실제 대기광은 햇빛 받는 쪽만 밝다).
import { useEffect, useRef } from 'react'
import '../styles/earthhero.css'

export default function EarthHero() {
  const vid = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = vid.current
    if (!el) return
    // muted+playsInline 이라 대개 통과하지만, 막히면 poster 로 떨어지게 조용히 무시한다.
    el.play().catch(() => {})
  }, [])

  // ⚠️ prefers-reduced-motion 으로 재생을 막지 않는다.
  //   윈도우 "애니메이션 효과" 를 끈 PC 가 흔한데, 그러면 히어로가 통째로 정지 사진이 된다
  //   (실제로 이 상태로 넘겼다가 "안 돌잖아" 를 들었다).
  //   자전이 초당 2.48° 라 어지럼증을 유발하는 종류의 움직임이 아니라고 보고 항상 재생한다.

  return (
    <div className="eh" aria-hidden="true">
      <div className="eh-stars" />
      <div className="eh-stars2" />
      <div className="eh-streak" />
      <video
        ref={vid}
        className="eh-video"
        src="/earth.mp4"
        /* poster 는 영상과 같은 1760x1760 이어야 한다 — 이 <video> 는 화면에서 2500px 이상으로
           늘어나므로, 작은 포스터를 쓰면 영상이 뜨기 전까지 뿌옇게 보인다(880px 로 넣었다가 겪었다). */
        poster="/earth-poster.webp"
        muted
        loop
        autoPlay
        playsInline
        preload="auto"
      />
      <div className="eh-tint" />
      <div className="eh-shade" />

      {/* 샤픈 커널. 세기 k=1.2 → 중앙 1+4k=5.8, 상하좌우 -k. 합이 1이라 밝기가 안 변한다.
          업스케일(구 1711px → 화면 2400~3900px) 때문에 생기는 뭉개짐을 보정한다. */}
      <svg className="eh-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id="eh-sharpen">
          <feConvolveMatrix
            order="3"
            preserveAlpha="true"
            kernelMatrix="0 -1.2 0 -1.2 5.8 -1.2 0 -1.2 0"
          />
        </filter>
      </svg>
    </div>
  )
}
