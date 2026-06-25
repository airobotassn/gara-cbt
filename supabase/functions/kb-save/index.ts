// kb-save: 검토·수정한 청크들을 지식 저장소(kb_chunks)에 저장한다. (자동 아님 — 버튼으로 호출)
//   각 청크 본문을 임베딩(gemini-embedding-001, 768)해서 같이 적재.
//   · service role 로 insert(SUPABASE_SERVICE_ROLE_KEY). 임베딩 키는 GEMINI_API_KEY_TEST_GENERATE.
//   · 단일 파일(_shared 미사용) → 대시보드 배포 가능. --no-verify-jwt 로 배포(내부 도구가 호출).
//
// 요청(POST): { level, source?:{url,title}, chunks:[{text, axis, topic}] }
// 응답: { saved:int }  (실패 시 { error })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-passcode',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY_TEST_GENERATE') || Deno.env.get('GEMINI_API_KEY')
const PASSCODE = Deno.env.get('KB_PASSCODE')
const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_DIM = 768
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

interface InChunk { text: string; axis?: string; topic?: string }

// 청크 본문들 → 임베딩 벡터들. (배치 100개씩, 본문은 토큰상한 고려해 자름)
async function embedAll(texts: string[]): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100)
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: batch.map((t) => ({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text: t.slice(0, 6000) }] }, // 2048토큰 상한 안전 여유
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EMBED_DIM,
          })),
        }),
      },
    )
    if (!res.ok) throw new Error(`임베딩 실패 ${res.status}: ${(await res.text()).slice(0, 160)}`)
    const j = await res.json()
    for (const e of j?.embeddings ?? []) out.push((e?.values as number[]) ?? [])
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY_TEST_GENERATE 미설정' }, 500)
    if (PASSCODE && req.headers.get('x-passcode') !== PASSCODE) return json({ error: '암호가 올바르지 않습니다.' }, 401)

    const body = await req.json()
    const level = Number.isFinite(+body?.level) && +body.level >= 1 && +body.level <= 7 ? +body.level : null
    const src = body?.source ?? {}
    const chunks: InChunk[] = Array.isArray(body?.chunks)
      ? body.chunks.filter((c: InChunk) => c && typeof c.text === 'string' && c.text.trim())
      : []
    if (!chunks.length) return json({ error: '저장할 청크가 없습니다.' }, 400)
    if (chunks.length > 500) return json({ error: '한 번에 최대 500개까지.' }, 400)

    // embed:false → 임베딩 없이 본문만 적재(콜드스타트 무료 경로). 임베딩은 나중에 백필.
    //   생성(kb-generate)은 레벨/축으로 청크를 뽑으므로 임베딩 없이도 동작. 임베딩은 중복검사·유사도검색용.
    const doEmbed = body?.embed !== false
    const mkRow = (c: InChunk, emb: number[] | null) => ({
      level,
      axis: (c.axis ?? '').trim() || null,
      topic: (c.topic ?? '').trim() || null,
      text: c.text,
      embedding: emb,
      source_url: typeof src?.url === 'string' ? src.url : null,
      source_title: typeof src?.title === 'string' ? src.title : null,
    })

    const rows: Record<string, unknown>[] = []
    let skipped = 0

    if (doEmbed) {
      const embeddings = await embedAll(chunks.map((c) => c.text))
      const DEDUP = 0.92 // 같은 레벨 안에서 비슷한 청크면 건너뜀(유사도)
      for (let i = 0; i < chunks.length; i++) {
        const emb = embeddings[i]
        if (emb && emb.length) {
          const { data: near } = await supabase.rpc('match_kb_chunks', {
            query_embedding: emb, p_level: level, p_axis: null, match_count: 1,
          })
          if (Array.isArray(near) && near[0] && near[0].similarity >= DEDUP) { skipped++; continue }
        }
        rows.push(mkRow(chunks[i], emb ?? null))
      }
    } else {
      // 무료 경로: 같은 레벨 내 "동일 본문"만 중복 처리(재실행 안전), embedding=null
      const { data: existing } = await supabase.from('kb_chunks').select('text').eq('level', level)
      const seen = new Set((existing ?? []).map((r: { text: string }) => r.text))
      for (const c of chunks) {
        if (seen.has(c.text)) { skipped++; continue }
        seen.add(c.text)
        rows.push(mkRow(c, null))
      }
    }

    if (rows.length) {
      const { error } = await supabase.from('kb_chunks').insert(rows)
      if (error) return json({ error: `저장 실패: ${error.message}` }, 500)
    }
    return json({ saved: rows.length, skipped })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
