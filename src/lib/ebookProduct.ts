/**
 * 이북 상품 정보(2026-09-22) — 카드의 소개 아래에 붙는 "상품 유형 · 언어 · 페이지 수 · 제공 방법 · 판매자".
 *   · 관리자 폼은 EBOOK_PRODUCT_DEFAULTS 로 채워져 시작한다. 서버(ebookUpsert)는 저장 때 기본값과 같으면 null 로 접는다.
 *   · 카드는 null 이면 **사전**(6개국어)의 기본 문구를, 관리자가 고쳐 쓴 값이면 그 글을 그대로 그린다.
 *   ⚠️ 서버 `functions/admin/index.ts` 의 EBOOK_PRODUCT_DEFAULTS 와 한 벌 — 글자 하나만 달라도 기본값이 문자열로 굳어
 *      외국어 화면에서 한국어로 뜬다. 사전 키 `ebook.p_delivery_default`·`ebook.p_seller_default` 의 한국어 값과도 같아야 한다.
 */
import type { Lang } from './i18n'

export const EBOOK_PRODUCT_DEFAULTS = { type: 'Digital E-BOOK', delivery: '결제 후 웹뷰어에 열람', seller: '글로벌AI로봇협회' } as const
/** 제공 언어 코드의 순서 = 카드에 나열되는 순서(한국어 먼저). */
export const EBOOK_PRODUCT_LANGS: Lang[] = ['ko', 'en', 'ja', 'zh', 'hi', 'vi']

export interface EbookProduct {
  type: string | null
  langs: string[] | null
  pages: number | null
  delivery: string | null
  seller: string | null
}
