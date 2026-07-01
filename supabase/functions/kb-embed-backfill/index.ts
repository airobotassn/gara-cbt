// kb-embed-backfill: kb_chunks 중 embedding 이 NULL 인 행들을 임베딩으로 채운다.
//   콜드스타트를 embed:false(무료)로 적재한 뒤, 임베딩 할당량이 생겼을 때 호출해 벡터를 백필.
//   · 호출당 limit 개씩 처리(기본 200) → 리밋 안에서 여러 번 나눠 돌릴 수 있음(구동기는 tools/backfill.mjs).
//   · service role 로 update. 임베딩 모델/차원/taskType 은 kb-save 와 동일해야 유사도 비교가 맞다.
//   · 단일 파일(_shared 미사용) → 대시보드 배포 가능. --no-verify-jwt.
//
// 요청(POST): { limit?: number }   응답: { embedded, remaining, done, notes }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-passcode',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY_TEST_GENERATE') || Deno.env.get('GEMINI_API_KEY')
const PASSCODE = Deno.env.get('KB_PASSCODE')
const EMBED_MODEL = 'gemini-embedding-001'  // kb-save 와 동일
const EMBED_DIM = 768
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

// 본문들 → 임베딩(배치 100). kb-save 의 embedAll 과 동일 설정(RETRIEVAL_DOCUMENT). 실패 시 throw.
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
            content: { parts: [{ text: t.slice(0, 6000) }] },
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EMBED_DIM,
          })),
        }),
      },
    )
    if (!res.ok) throw new Error(`임베딩 ${res.status}: ${(await res.text()).slice(0, 160)}`)
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

    const body = await req.json().catch(() => ({}))
    const limit = Math.min(Math.max(+body?.limit || 200, 1), 500)

    // 남은(embedding null) 청크 가져오기
    const { data: rows, error } = await supabase.from('kb_chunks').select('id,text').is('embedding', null).limit(limit)
    if (error) return json({ error: `조회 실패: ${error.message}` }, 500)
    if (!rows?.length) return json({ embedded: 0, remaining: 0, done: true, notes: ['임베딩할 청크 없음(이미 다 됨)'] })

    // 임베딩(할당량 막히면 우아하게 멈춤)
    let embeddings: number[][]
    try { embeddings = await embedAll(rows.map((r: { text: string }) => r.text)) }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const quota = /429|quota|billing|exceeded|plan/i.test(msg)
      return json({ embedded: 0, done: false, notes: [quota ? `할당량 소진 — 회복 후 다시: ${msg}` : `임베딩 실패: ${msg}`] }, quota ? 200 : 500)
    }

    // 행별 update(배치 병렬)
    let done = 0
    for (let i = 0; i < rows.length; i += 20) {
      const slice = rows.slice(i, i + 20)
      await Promise.all(slice.map((r: { id: string }, k: number) => {
        const emb = embeddings[i + k]
        if (!emb || !emb.length) return Promise.resolve()
        return supabase.from('kb_chunks').update({ embedding: emb }).eq('id', r.id).then(() => { done++ })
      }))
    }

    // 남은 수 집계
    const { count } = await supabase.from('kb_chunks').select('id', { count: 'exact', head: true }).is('embedding', null)
    const remaining = count ?? 0
    return json({ embedded: done, remaining, done: remaining === 0, notes: [] })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
