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

export async function loadBoardCats(kind: 'notice' | 'faq'): Promise<BoardCat[]> {
  if (!isSupabaseConfigured) return []
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
