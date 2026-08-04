// 공유 카드 모달 — 허브 HUD 의 "공유" 버튼이 연다.
// 미리보기 = 실제 출력 캔버스를 CSS 로 축소한 것(별도 DOM 미리보기를 두지 않아 보이는 대로 나간다).
// 마크업은 hub.css 의 .hub-modal-* 를 그대로 쓴다 → 반드시 .hub 하위에서 렌더할 것.
import { useEffect, useRef, useState } from 'react'
import {
  renderShareCard, canvasToBlob, cardFileName, downloadBlob, shareBlob, copyBlob,
  CARD_W, CARD_H, type ShareCardData,
} from '../lib/shareCard'

export default function ShareCardModal({
  data,
  onClose,
  title = '내 카드 공유',
  // 남의 카드(랭킹 TOP10 클릭)는 보기 전용 — 저장·공유·복사 버튼을 감춘다.
  // 남의 이미지를 내가 받아서 뿌리는 건 자연스럽지 않고, 게임들도 남의 프로필은 보기만 한다.
  readOnly = false,
}: {
  data: ShareCardData
  onClose: () => void
  title?: string
  readOnly?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.share
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard && typeof ClipboardItem !== 'undefined'

  // 값이 바뀌면 다시 그린다. data 는 호출부에서 매 렌더 새로 만드는 객체라 그대로 의존성에 넣으면 무한 루프 →
  // 직렬화 키로 비교한다(국가·지역 순위가 모달을 연 뒤 늦게 도착해도 그때 카드가 갱신되도록).
  // setState 는 프라미스 콜백에서만(허브 컨벤션).
  const dataKey = JSON.stringify(data)
  useEffect(() => {
    let alive = true
    const cv = canvasRef.current
    if (!cv) return
    renderShareCard(cv, data)
      .then(() => { if (alive) setState('ready') })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey])

  function flash(msg: string) {
    setNote(msg)
    window.setTimeout(() => setNote((cur) => (cur === msg ? null : cur)), 2200)
  }
  async function withBlob(fn: (b: Blob) => Promise<void>) {
    const cv = canvasRef.current
    if (!cv || state !== 'ready' || busy) return
    try {
      setBusy(true)
      await fn(await canvasToBlob(cv))
    } catch {
      flash('이미지를 만들지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  const file = cardFileName(data.name)
  const doShare = () => withBlob(async (b) => {
    // 공유 시트 미지원/거부 → 저장으로 폴백(빈손으로 끝나지 않게)
    if (!(await shareBlob(b, file, 'CARIS WORLD ARENA'))) { downloadBlob(b, file); flash('이미지를 저장했어요') }
  })
  const doSave = () => withBlob(async (b) => { downloadBlob(b, file); flash('이미지를 저장했어요') })
  const doCopy = () => withBlob(async (b) => { flash(await copyBlob(b) ? '클립보드에 복사했어요' : '복사를 지원하지 않는 브라우저예요') })

  return (
    // sc-host = 허브 밖(/ranking)에서도 스타일이 먹도록 토큰을 공급하는 클래스(hub.css)
    <div className="hub-modal-backdrop sc-host" onClick={onClose}>
      <div className="hub-modal share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hub-modal-head">
          <h3>{title}</h3>
          <button className="hub-modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="hub-modal-body">
          <div className={`share-preview ${state === 'ready' ? 'is-ready' : ''}`} style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}>
            <canvas ref={canvasRef} className="share-canvas" />
            {state === 'loading' && <div className="share-preview-msg">카드 만드는 중…</div>}
            {state === 'error' && <div className="share-preview-msg">카드를 만들지 못했어요</div>}
          </div>

          {!readOnly && (
            <div className="share-actions">
              {canShareFiles && (
                <button className="pbtn share-btn share-btn-primary" onClick={doShare} disabled={state !== 'ready' || busy}>공유하기</button>
              )}
              <button className={`pbtn share-btn${canShareFiles ? '' : ' share-btn-primary'}`} onClick={doSave} disabled={state !== 'ready' || busy}>이미지 저장</button>
              {canCopy && (
                <button className="pbtn share-btn" onClick={doCopy} disabled={state !== 'ready' || busy}>이미지 복사</button>
              )}
            </div>
          )}
          {note && <p className="share-note">{note}</p>}
          <p className="hub-modal-help">
            {readOnly
              ? '지금 순위·티어 기준으로 만든 카드예요.'
              : '카드는 지금 순위·티어 기준이에요. 응시하면 다시 만들어서 공유할 수 있어요.'}
          </p>
        </div>
      </div>
    </div>
  )
}
