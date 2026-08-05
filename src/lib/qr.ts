import qrcode from 'qrcode-generator'

// QR 코드를 모듈(격자) 정보로 반환 — 인증서 SVG 안에 <rect> 로 직접 인라인(벡터, 인쇄 선명).
//   text: 인코딩할 문자열(진위확인 URL)
//   ecc:  오차정정 레벨(기본 M — 인쇄/스캔 균형)
export function qrMatrix(text: string, ecc: 'L' | 'M' | 'Q' | 'H' = 'M') {
  const qr = qrcode(0, ecc) // typeNumber 0 = 데이터 길이에 맞춰 자동
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  const dark: [number, number][] = []
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) dark.push([r, c])
    }
  }
  return { count, dark }
}
