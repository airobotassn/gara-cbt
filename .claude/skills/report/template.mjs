// 단일 HTML 리포트 — 이미지 base64 내장이라 파일 하나로 메신저 전송 가능. 단순하게.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const LANGS = { ko: '🇰🇷', en: '🇬🇧', ja: '🇯🇵', zh: '🇨🇳', hi: '🇮🇳', vi: '🇻🇳' }

function img(shot, label) {
  if (!shot) return ''
  const inner = shot.ok
    ? `<img src="${shot.dataUri}" alt="">`
    : `<div class="err">촬영 실패: ${esc(shot.error || '')}</div>`
  return `<figure class="shot">${label ? `<figcaption>${esc(label)}</figcaption>` : ''}${inner}</figure>`
}

function card(s, r, i) {
  const tags = [
    `<span class="tag">${LANGS[s.lang || 'ko']} ${(s.lang || 'ko').toUpperCase()}</span>`,
    s.theme === 'dark' ? `<span class="tag">🌙 다크</span>` : '',
    s.device === 'mobile' ? `<span class="tag">📱 모바일</span>` : '',
  ].filter(Boolean).join('')
  const phone = s.device === 'mobile' ? ' phone' : ''
  const imgs = img(r.after)
  return `
  <section class="card">
    <div class="head"><span class="num">${i + 1}</span>
      <div><h2>${esc(s.title)}</h2><p>${esc(s.desc || '')}</p>
      <div class="tags">${tags}</div></div>
    </div>
    <div class="imgs${phone}">${imgs}</div>
  </section>`
}

export function buildReport({ meta, dateStr, screens, results }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)} — ${esc(meta.project)}</title>
<style>
  :root{--brand:#8900ff;--ink:#1a1320;--muted:#6b6478;--bg:#f6f4fb;--card:#fff;--line:#e9e4f2}
  @media(prefers-color-scheme:dark){:root{--ink:#ece8f5;--muted:#a59fb5;--bg:#15101d;--card:#1f1830;--line:#322745}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:880px;margin:0 auto;padding:32px 20px 80px}
  header.top{border-bottom:2px solid var(--line);padding-bottom:18px;margin-bottom:26px}
  header.top .kicker{color:var(--brand);font-weight:700;font-size:13px}
  header.top h1{margin:6px 0 4px;font-size:28px}
  header.top .date{color:var(--muted);font-size:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:24px}
  .head{display:flex;gap:12px;align-items:flex-start;margin-bottom:14px}
  .num{flex:none;width:30px;height:30px;border-radius:50%;background:var(--brand);color:#fff;font-weight:800;display:grid;place-items:center}
  .head h2{margin:0 0 3px;font-size:19px}
  .head p{margin:0 0 8px;color:var(--muted)}
  .tags{display:flex;gap:6px;flex-wrap:wrap}
  .tag{font-size:12px;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:2px 9px}
  .imgs{display:grid;gap:14px}
  .shot{margin:0}
  .shot figcaption{font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px}
  .shot img{width:100%;display:block;border:1px solid var(--line);border-radius:10px}
  .imgs.phone .shot img{width:auto;max-width:360px;margin:0 auto}
  .err{padding:20px;background:#fff3f3;color:#a40000;border-radius:10px;font-size:14px}
  footer{color:var(--muted);font-size:13px;text-align:center;margin-top:36px}
</style></head><body><div class="wrap">
<header class="top">
  <div class="kicker">${esc(meta.project)}</div>
  <h1>${esc(meta.title)}</h1>
  <div class="date">${esc(dateStr)}</div>
</header>
${screens.map((s, i) => card(s, results[i], i)).join('\n')}
<footer>Playwright 자동 촬영 · report 스킬</footer>
</div></body></html>`
}
