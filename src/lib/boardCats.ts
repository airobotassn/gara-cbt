// 게시판 분류(board_categories) — 공개 화면(/notice · /faq)이 읽는 목록.
//   관리자가 만든 그대로다(관리 화면 = Admin.tsx 의 BoardCatModal, 서버 = admin 함수의 boardCat*).
//
// ⛔ **분류가 지워진 글은 공개 화면에서 안 보인다.** 글은 지워지지 않고 category 값(고아 키)을 그대로
//    달고 남아 있으며, 관리자 목록의 '미분류' 에서 다시 지정하면 돌아온다. 그래서 목록 조회는
//    "지금 있는 분류"로 걸러야 한다 — 안 걸면 지운 분류의 글이 이름 없이 계속 노출된다.
// ⚠️ RLS 는 select 만 열려 있다(누구나 읽기). 쓰기는 admin 함수(service role) 전용이다.
import { supabase, isSupabaseConfigured } from './supabase'

export interface BoardCat {
  key: string
  /** { ko, en, ja, zh, hi, vi } — 한국어만 입력받아 서버가 자동 번역해 채운다. */
  label: Record<string, string>
  /** FAQ 사이드바 아이콘(Material Symbols). 공지는 안 쓴다. */
  icon: string
}

// 분류 목록을 5분간 재사용한다. 공지 목록 → 글 상세 → FAQ → 다시 공지 를 오갈 때마다
// 같은 목록을 새로 받던 것을 없앤다(관리자가 몇 달에 한 번 건드리는 데이터다).
//
// ⚠️ **영구 캐시로 만들지 말 것.** 공개 목록은 "지금 있는 분류"로 글을 거른다(위 ⛔ 참고) —
//    관리자가 분류를 새로 만들고 거기에 긴급 공지를 올리면, 옛 목록을 든 브라우저는 그 분류를
//    몰라서 **그 공지를 필터로 걸러내 아예 못 본다.** 5분은 그 창을 좁히려고 정한 값이다.
// ⚠️ 진행 중 요청(inflight)을 공유한다 — 한 화면이 목록과 사이드바에서 동시에 부를 수 있다.
const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; rows: BoardCat[] }>()
const inflight = new Map<string, Promise<BoardCat[]>>()

export async function loadBoardCats(kind: 'notice' | 'faq'): Promise<BoardCat[]> {
  if (!isSupabaseConfigured) return []
  const hit = cache.get(kind)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows
  const pending = inflight.get(kind)
  if (pending) return pending
  const p = fetchBoardCats(kind)
    .then((rows) => {
      cache.set(kind, { at: Date.now(), rows })
      return rows
    })
    .finally(() => inflight.delete(kind))
  inflight.set(kind, p)
  return p
}

async function fetchBoardCats(kind: 'notice' | 'faq'): Promise<BoardCat[]> {
  const { data } = await supabase
    .from('board_categories')
    .select('key, label_i18n, icon')
    .eq('kind', kind)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
  return ((data as { key: string; label_i18n: Record<string, string> | null; icon: string | null }[] | null) ?? []).map(
    (r) => ({ key: r.key, label: r.label_i18n ?? {}, icon: r.icon ?? '' }),
  )
}

/** 화면 언어 이름 → 없으면 한국어 → 그것도 없으면 키. 번역이 아직 안 붙은 분류도 뭐라도 보이게 한다. */
export function catName(c: BoardCat | undefined, lang: string): string {
  if (!c) return ''
  return c.label[lang] || c.label.ko || c.key
}
