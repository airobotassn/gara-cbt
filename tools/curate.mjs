// tools/curate.mjs — 큐레이션 적재 도우미 (Gemini 미사용·무료).
//   list:  node tools/curate.mjs list <lang> "<title>"
//            → 위키 본문을 문단으로 쪼개 번호 매겨 출력(고를 후보)
//   save:  node tools/curate.mjs save <level> <axis> <lang> "<title>" "0,1,2,6,12,..."
//            → 그 번호 문단만 "원문 그대로" kb-save(embed:false). 토픽=섹션제목 자동.
//
// 핵심: 텍스트는 인덱스로만 선택 → 절대 다시 타이핑 안 함 → 원문 변형 0(할루시네이션 안전).
//       list 와 save 의 분할이 동일(결정적)하므로 번호가 일치한다.

const FN_BASE = 'https://jfvldoywvzvqhitcgalr.supabase.co/functions/v1'
const WIKI_UA = 'GARA-coldstart/1.0 (AI literacy test KB; contact tkgkd159@gmail.com)'
const SKIP_SECTION = /^(references|see also|external links|notes|citations|further reading|bibliography|sources|footnotes|works cited|gallery|external resources)$/i
const MIN = 120     // 후보로 보여줄 최소 문단 길이
const MAX_CAND = 90  // 후보 상한(너무 깊은 꼬리 섹션 방지)

// site: "en"(=en.wikipedia.org) | "en.wikibooks" | "en.wikiversity" 등. 점 있으면 그대로 .org.
function siteHost(s) { return (s && s.includes('.')) ? `${s}.org` : `${s || 'en'}.wikipedia.org` }

async function fetchWiki(site, title) {
  const u = `https://${siteHost(site)}/w/api.php?` + new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', prop: 'extracts', explaintext: '1', redirects: '1', titles: title,
  })
  const r = await fetch(u, { headers: { 'User-Agent': WIKI_UA } })
  if (!r.ok) throw new Error(`wiki HTTP ${r.status}`)
  const p = (await r.json())?.query?.pages?.[0]
  if (!p || p.missing || !p.extract) return null
  return { text: p.extract, title: p.title }
}

// 결정적 분할: 문단(≥MIN자) 후보 배열. 섹션 제목을 토픽으로 따라감. 참고문헌류 섹션 제외.
function candidates(text) {
  const lines = text.split('\n')
  let topic = '개요'
  const out = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const h = line.match(/^(={2,})\s*(.+?)\s*\1$/)
    if (h) { topic = h[2].trim(); continue }
    if (SKIP_SECTION.test(topic)) continue
    if (line.length < MIN) continue
    out.push({ text: line, topic })
    if (out.length >= MAX_CAND) break
  }
  return out
}

async function callSave(body) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`${FN_BASE}/kb-save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
      if (r.ok && !j.error) return j
      if (!/429|5\d\d|temporar|unavailable/i.test(String(j.error))) throw new Error(j.error)
    } catch (e) { if (a === 3) throw e }
    await new Promise((res) => setTimeout(res, 2000 * (a + 1)))
  }
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2)
  if (cmd === 'list') {
    const [lang, title] = a
    const w = await fetchWiki(lang, title)
    if (!w) { console.log('문서 없음(제목 확인)'); return }
    const c = candidates(w.text)
    console.log(`# ${w.title} — 후보 문단 ${c.length}개 (잡음 빼고 알짜 번호를 골라 save)`)
    c.forEach((x, i) => console.log(`[${i}] (${x.topic}) ${x.text.slice(0, 220)}${x.text.length > 220 ? '…' : ''}`))
  } else if (cmd === 'save') {
    const [level, axis, lang, title, keepCsv] = a
    const w = await fetchWiki(lang, title)
    if (!w) { console.log('문서 없음'); return }
    const c = candidates(w.text)
    const keep = (keepCsv || '').split(',').map((s) => +s.trim()).filter((n) => Number.isInteger(n) && n >= 0 && n < c.length)
    const chunks = keep.map((i) => ({ text: c[i].text, axis, topic: c[i].topic }))
    if (!chunks.length) { console.log('고른 청크 0 — 번호 확인'); return }
    const r = await callSave({
      level: +level, embed: false,
      source: { url: `https://${siteHost(lang)}/wiki/${encodeURIComponent(w.title.replace(/ /g, '_'))}`, title: w.title },
      chunks,
    })
    console.log(`[${title}→${axis}] 고른 ${chunks.length} → 저장 ${r.saved} (중복 ${r.skipped})`)
  } else if (cmd === 'search') {
    const [site, term] = a
    const u = `https://${siteHost(site)}/w/api.php?` + new URLSearchParams({
      action: 'query', list: 'search', srsearch: term, srlimit: '20', srnamespace: '0', format: 'json', formatversion: '2',
    })
    const r = await fetch(u, { headers: { 'User-Agent': WIKI_UA } })
    const hits = (await r.json())?.query?.search ?? []
    console.log(`# "${term}" @ ${siteHost(site)} — ${hits.length}건`)
    hits.forEach((h) => console.log(`- ${h.title}  (${h.wordcount}단어)`))
  } else {
    console.log('사용: search <site> "<term>" | list <site> "<title>" | save <level> <axis> <site> "<title>" "0,1,2,..."\n  site: en | en.wikibooks | en.wikiversity ...')
  }
}
main().catch((e) => { console.error('오류:', e.message); process.exit(1) })
