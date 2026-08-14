import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
const ROOT='C:/Users/User/gara-cbt/public', OUT=process.argv[2]
await mkdir(OUT,{recursive:true})
const MIME={'.html':'text/html','.js':'text/javascript','.png':'image/png','.webp':'image/webp'}
const srv=createServer(async(req,res)=>{const p=decodeURIComponent(req.url.split('?')[0])
 try{const b=await readFile(join(ROOT,p));res.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream'});res.end(b)}catch{res.writeHead(404);res.end('')}})
await new Promise(r=>srv.listen(4371,r))
const br=await chromium.launch()
// (1) 지금 화면의 콘솔 윗부분
const ctx=await br.newContext({viewport:{width:430,height:760},deviceScaleFactor:3}); const pg=await ctx.newPage()
await pg.goto('http://localhost:4371/games/build-cari.html?lang=ko',{waitUntil:'load'}); await pg.waitForTimeout(1400)
const box=await pg.locator('.intro-console').boundingBox()
await pg.screenshot({path:`${OUT}/top-now.png`,clip:{x:box.x-6,y:box.y-6,width:box.width+12,height:box.height*0.22}})
await ctx.close()
// (2) 원본 아트 윗부분
const ctx2=await br.newContext({viewport:{width:700,height:400},deviceScaleFactor:2}); const pg2=await ctx2.newPage()
await pg2.goto('http://localhost:4371/games/build-cari.html')
await pg2.evaluate(()=>{document.documentElement.innerHTML='<body style="margin:0;background:#22242c"><img id=i src="/games/build-cari-intro-v11.webp" style="width:600px;display:block;margin:6px auto"></body>'})
await pg2.waitForTimeout(700)
await pg2.screenshot({path:`${OUT}/top-art.png`,clip:{x:44,y:0,width:612,height:210}})
await ctx2.close()
await br.close();srv.close();console.log('ok')
