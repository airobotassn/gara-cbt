/* 문구는 전부 사전(i18n.js 의 order.*)에서 온다 — 사전에 없으면 아래 한국어로 떨어진다.
   주문 문구는 order.lv{n}.name|who|say|paint, 카드는 order.lv{n}.c{i}. ⚠️ 한국어는 이 파일이 원본이다(사전의 ko 사본은 안 쓴다). */
const T=(k,v)=>window.MGI18N?MGI18N.t(k,v):k;
const KO=()=>!window.MGI18N||MGI18N.lang==='ko';
function TX(key,fallback){ if(KO()) return fallback; const v=T(key); return v===key?fallback:v; }

/* ================= CARI mascot (기존 게임과 동일 자산) ================= */
function charSVG(suit,o={}){
  const [body,shade,ear]=suit; const isCari=o.cari, dir=o.dir||0, shock=o.shock;
  const gid='c'+shade.slice(1)+(isCari?'m':'')+(shock?'k':'')+(dir+1)+Math.random().toString(36).slice(2,6);
  const ex=dir*2.2;
  const eyes = shock
    ? `<path d="M22.5 25.5 l5.5 5 M28 25.5 l-5.5 5" stroke="#8fd0ff" stroke-width="2.3" stroke-linecap="round"/>
       <path d="M36 25.5 l5.5 5 M41.5 25.5 l-5.5 5" stroke="#8fd0ff" stroke-width="2.3" stroke-linecap="round"/>`
    : `<ellipse cx="${25.5+ex}" cy="27" rx="3.7" ry="4.8" fill="#d3ecff"/>
       <ellipse cx="${38.5+ex}" cy="27" rx="3.7" ry="4.8" fill="#d3ecff"/>
       <ellipse cx="${24.6+ex}" cy="25.2" rx="1.15" ry="1.5" fill="#fff"/>
       <ellipse cx="${37.6+ex}" cy="25.2" rx="1.15" ry="1.5" fill="#fff"/>`;
  const mouth = shock
    ? `<ellipse cx="32" cy="35.5" rx="2.8" ry="3.4" fill="#2b5f8c"/>`
    : `<path d="M28.8 34 q3.2 2.8 6.4 0" stroke="#7fc4ff" stroke-width="1.7" fill="none" stroke-linecap="round"/>`;
  const antenna = isCari ? `
    <path d="M32 10 v-4.4" stroke="#7fa8d8" stroke-width="1.7" stroke-linecap="round"/>
    <circle cx="32" cy="3.8" r="3" fill="#5b90ff"/>
    <ellipse cx="32" cy="3.8" rx="5.7" ry="1.9" fill="none" stroke="#9cc0ff" stroke-width="1.2" transform="rotate(-18 32 3.8)"/>` : '';
  const badge = isCari ? `
    <rect x="24" y="45" width="16" height="8.5" rx="3" fill="#fdfbf5" stroke="${shade}" stroke-width=".9"/>
    <text x="32" y="51.3" font-size="5.4" font-weight="900" text-anchor="middle" fill="#8fb0e2" font-family="system-ui,sans-serif">CARI</text>` : '';
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width:74px;height:74px">
    <defs><radialGradient id="${gid}" cx="38%" cy="26%" r="80%">
      <stop offset="0" stop-color="#fff" stop-opacity=".62"/>
      <stop offset="42%" stop-color="${body}"/><stop offset="100%" stop-color="${shade}"/>
    </radialGradient></defs>
    <ellipse cx="32" cy="58.5" rx="16" ry="3.4" fill="rgba(0,0,0,.32)"/>
    ${antenna}
    <circle cx="12.8" cy="15.5" r="8.6" fill="${body}" stroke="${shade}" stroke-width="1.2"/>
    <circle cx="51.2" cy="15.5" r="8.6" fill="${body}" stroke="${shade}" stroke-width="1.2"/>
    <circle cx="12.8" cy="15.5" r="4.6" fill="${ear}"/><circle cx="51.2" cy="15.5" r="4.6" fill="${ear}"/>
    <path d="M32 8 C46.5 8 54 17.5 54 30 C54 38 52.4 43 50.4 47.4 C49.6 53.6 45 57 32 57
             C19 57 14.4 53.6 13.6 47.4 C11.6 43 10 38 10 30 C10 17.5 17.5 8 32 8 Z"
          fill="url(#${gid})" stroke="${shade}" stroke-width="1.3"/>
    <ellipse cx="32" cy="28" rx="15.2" ry="14.2" fill="#141a2b"/>
    <ellipse cx="26" cy="19.5" rx="6.4" ry="3.4" fill="#fff" opacity=".13"/>
    ${eyes}${mouth}${badge}</svg>`;
}
const CARI_SUIT=['#f4efe4','#cfc6b4','#9fb6de'];

/* ===================== 조립 로봇 =====================
   spec = {base:'none|wheel|leg|track', arms:0|1|2|4, hand:'none|grip|suction', head:'plain|cam|many',
           light:'none|lamp', battery:'normal|big', size:'small|normal|huge', color:'#rrggbb'}
   ⚠️ 도면과 완성품을 **같은 함수**로 그린다. 두 벌로 그리면 "도면엔 팔이 둘인데 판정은 하나" 같은 어긋남이 바로 생긴다.
      plan 모드는 선만 남긴 청사진. o.wrong = 틀린 부위 배열 — 그 부위에 붉은 테를 두른다(실패 표시).
   ⚠️ huge 는 일부러 프레임 밖으로 넘치게, small 은 작게 그린다 — 숫자가 아니라 그림으로 읽혀야 한다.
==================================================== */
function robotSVG(s,o={}){
  const plan=!!o.plan, wrong=new Set(o.wrong||[]);
  const fill = plan?'none':(s.color||'#93a0b8');
  const solid= plan?'none':'#5b6a8a';
  const line = plan?'#8fc4ff':'#5b6a8a';
  const ink  = plan?'none':'#28324c';
  const inkL = plan?'#8fc4ff':'#28324c';
  const lens = plan?'none':'#1f6dff';
  const sw   = plan?1.6:1.5;
  const g=[];
  const ring=(x,y,w,h)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="rgba(229,72,77,.12)" stroke="#e5484d" stroke-width="2.2" stroke-dasharray="4 3"/>`;

  if(!plan) g.push(`<ellipse cx="60" cy="140" rx="34" ry="4.6" fill="rgba(30,45,80,.16)"/>`);
  // 큰 배터리 = 등에 멘 팩 (몸통 뒤에 그린다)
  if(s.battery==='big'){
    g.push(`<rect x="82" y="88" width="20" height="26" rx="4" fill="${plan?'none':'#3f4a63'}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<rect x="88" y="84" width="8" height="5" rx="1.5" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<path d="M87 95 h10 M87 101 h10 M87 107 h10" stroke="${plan?'#8fc4ff':'#8fe0a8'}" stroke-width="2.2" stroke-linecap="round"/>`);
  }

  if(s.base==='wheel'){
    g.push(`<circle cx="42" cy="124" r="14" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<circle cx="42" cy="124" r="6" fill="${plan?'none':'#e8edf7'}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<circle cx="78" cy="124" r="14" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<circle cx="78" cy="124" r="6" fill="${plan?'none':'#e8edf7'}" stroke="${line}" stroke-width="${sw}"/>`);
  } else if(s.base==='leg'){
    g.push(`<rect x="40" y="104" width="12" height="26" rx="5" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<rect x="68" y="104" width="12" height="26" rx="5" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<rect x="33" y="126" width="24" height="9" rx="4.5" fill="${ink}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<rect x="63" y="126" width="24" height="9" rx="4.5" fill="${ink}" stroke="${line}" stroke-width="${sw}"/>`);
  } else if(s.base==='track'){
    g.push(`<rect x="24" y="110" width="72" height="26" rx="13" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`);
    [38,60,82].forEach(x=>g.push(`<circle cx="${x}" cy="123" r="6.5" fill="${plan?'none':'#e8edf7'}" stroke="${line}" stroke-width="${sw}"/>`));
  }

  // 손 — 집게(두 갈래) / 흡착판(둥근 컵) / 없음(뭉툭한 끝)
  const handAt=(x,y,flip)=>{
    const d=flip?-1:1;
    if(s.hand==='grip') return `<rect x="${flip?x-6:x}" y="${y-5}" width="6" height="10" rx="2" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`
      +`<path d="M${x+6*d} ${y-4} l${8*d} -6 M${x+6*d} ${y+4} l${8*d} 6" stroke="${line}" stroke-width="3" stroke-linecap="round" fill="none"/>`;
    if(s.hand==='suction') return `<rect x="${flip?x-4:x}" y="${y-3}" width="4" height="6" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`
      +`<circle cx="${x+10*d}" cy="${y}" r="7.5" fill="${plan?'none':'#c9d4ea'}" stroke="${line}" stroke-width="${sw}"/>`
      +`<circle cx="${x+10*d}" cy="${y}" r="3" fill="none" stroke="${line}" stroke-width="1.4"/>`;
    return `<rect x="${flip?x-9:x-1}" y="${y-8}" width="10" height="16" rx="4" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`;
  };
  const arm=(x,y,w,flip)=>`<rect x="${x}" y="${y}" width="${w}" height="10" rx="5" fill="${fill}" stroke="${line}" stroke-width="${sw}"/>`
    +handAt(flip?x:x+w,y+5,flip);
  if(s.arms>=1) g.push(arm(86,74,20,false));
  if(s.arms>=2) g.push(arm(14,74,20,true));
  if(s.arms>=4){
    g.push(`<g transform="rotate(-34 60 80)">${arm(86,74,18,false)}</g>`);
    g.push(`<g transform="rotate(34 60 80)">${arm(16,74,18,true)}</g>`);
  }

  g.push(`<rect x="36" y="62" width="48" height="50" rx="13" fill="${fill}" stroke="${line}" stroke-width="${sw+.1}"/>`);
  g.push(`<rect x="46" y="80" width="28" height="16" rx="5" fill="${plan?'none':'rgba(255,255,255,.5)'}" stroke="${line}" stroke-width="${plan?1:0}"/>`);
  g.push(`<rect x="55" y="52" width="10" height="10" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`);
  g.push(`<rect x="40" y="24" width="40" height="32" rx="11" fill="${fill}" stroke="${line}" stroke-width="${sw+.1}"/>`);

  if(s.head==='cam'){
    g.push(`<circle cx="60" cy="40" r="10" fill="${ink}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<circle cx="60" cy="40" r="5.4" fill="${lens}" stroke="${line}" stroke-width="${plan?1.2:0}"/>`);
    if(!plan) g.push(`<circle cx="57.6" cy="37.6" r="1.8" fill="#fff" opacity=".85"/>`);
  } else if(s.head==='many'){
    g.push(`<circle cx="60" cy="40" r="7" fill="${ink}" stroke="${line}" stroke-width="${sw}"/>`);
    [[45,32],[75,32],[45,48],[75,48],[52,26],[68,26]].forEach(([x,y])=>
      g.push(`<circle cx="${x}" cy="${y}" r="4.2" fill="${ink}" stroke="${line}" stroke-width="${sw}"/>`));
    g.push(`<path d="M46 24 v-9 M74 24 v-9" stroke="${line}" stroke-width="2.4" stroke-linecap="round"/>`);
    g.push(`<circle cx="46" cy="13" r="3.4" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<circle cx="74" cy="13" r="3.4" fill="${solid}" stroke="${line}" stroke-width="${sw}"/>`);
  } else {
    g.push(`<circle cx="52" cy="40" r="3.6" fill="${inkL}"/><circle cx="68" cy="40" r="3.6" fill="${inkL}"/>`);
  }
  // 헤드라이트 = 머리 위 램프 + 빛살
  if(s.light==='lamp'){
    const lx=s.head==='many'?60:60, ly=s.head==='many'?8:18;
    g.push(`<rect x="${lx-7}" y="${ly-6}" width="14" height="9" rx="3" fill="${plan?'none':'#ffe37a'}" stroke="${line}" stroke-width="${sw}"/>`);
    g.push(`<path d="M${lx-11} ${ly-10} l-4 -4 M${lx+11} ${ly-10} l4 -4 M${lx} ${ly-9} v-6" stroke="${plan?'#8fc4ff':'#f5c518'}" stroke-width="2" stroke-linecap="round"/>`);
  }

  // 틀린 부위 붉은 테 — 부위별 대략의 상자
  const BOX={base:[20,100,80,40],arms:[6,64,108,30],hand:[6,64,108,30],head:[36,20,48,40],light:[44,0,32,22],battery:[78,80,28,38],size:[4,4,112,140],color:[30,20,60,96]};
  wrong.forEach(k=>{ const b=BOX[k]; if(b) g.push(ring(...b)); });

  const inner=g.join('');
  const wrap = s.size==='huge' ? `<g transform="translate(60,140) scale(1.42) translate(-60,-140)">${inner}</g>`
             : s.size==='small' ? `<g transform="translate(60,140) scale(.78) translate(-60,-140)">${inner}</g>` : inner;
  return `<svg viewBox="0 0 120 148" xmlns="http://www.w3.org/2000/svg">${wrap}</svg>`;
}

/* ===================== 카드 부위 =====================
   ⚠️ 색은 **부위**를 뜻한다. 절대 '좋은 말/나쁜 말'을 뜻하게 만들지 마라 — 그 순간 색이 정답표가 되고 도면을 안 본다.
      같은 부위에 정상과 함정을 섞을 것.
==================================================== */
const PART={
  move  :{label:'이동',  c:'#2f7de1'},
  arm   :{label:'팔',    c:'#12a06a'},
  head  :{label:'머리',  c:'#8257e5'},
  light :{label:'조명',  c:'#d9a400'},
  power :{label:'배터리',c:'#0f9ea8'},
  finish:{label:'마감',  c:'#e0891a'},
  whole :{label:'전체',  c:'#6b7589'}
};
const PARTNAME={base:'이동부',arms:'팔',hand:'손',head:'머리',light:'조명',battery:'배터리',color:'도장색',size:'크기'};

const GRAY='#93a0b8', YELLOW='#f5c518', BLUE='#4a86ff', RED='#e2483d', GREEN='#2bb673', PINK='#ff4fa3';
const BASE_SPEC={base:'none',arms:0,hand:'none',head:'plain',light:'none',battery:'normal',size:'normal',color:GRAY};

/*LEVELS*/

/* ===================== 상태 ===================== */
/* ⛔ 아래 둘은 서버 _shared/order-levels.ts 와 sync pair 다(tests/minigame-replay.mjs 가 대조) — 점수는 서버가 기록으로 다시 센다. */
const MAX_TRIES=3;
const KEYS=['base','arms','hand','head','light','battery','size','color'];
const $=id=>document.getElementById(id);
let LI=0,picked=new Set(),busy=false,tries=0,starsPer=[],state='pick';  // state: pick | fail | ok | over
let LOG=[], T0=0;   // 답안 기록 — 시도마다 {o:주문, c:[고른 카드 자리], t:ms} · 서버가 이걸로 깬 주문 수·별을 다시 센다
let submitted=false;
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function starStr(n){return '★'.repeat(n)+'<b>'+'☆'.repeat(3-n)+'</b>';}
function starSockets(n){let s='';for(let i=0;i<3;i++)s+='<i'+(i<n?' class="on"':'')+'></i>';return s;}
const lvText=(f)=>TX('order.lv'+(LI+1)+'.'+f, LEVELS[LI][f]||'');
const cardText=(i)=>TX('order.lv'+(LI+1)+'.c'+(i+1), LEVELS[LI].cards[i].t);
const partName=(k)=>TX('order.part.'+k, PARTNAME[k]);
const tagName=(p)=>TX('order.tag.'+p, PART[p].label);

/** 카드 → 스펙. 정상 카드를 먼저, 함정이 그 위를 덮는다("좋은 지시를 넣어도 나쁜 지시 하나가 결과를 가져간다"). 팔이 없으면 손도 없다. */
function buildSpec(cards,pick){
  const spec={...BASE_SPEC};
  const ch=[...pick].sort((a,b)=>a-b).map(i=>cards[i]);
  ch.filter(c=>!c.bad).forEach(c=>Object.assign(spec,c.set));
  ch.filter(c=>c.bad).forEach(c=>Object.assign(spec,c.set));
  if(spec.arms===0) spec.hand='none';
  return spec;
}
function wrongKeys(spec,goal){ return KEYS.filter(k=>spec[k]!==goal[k]); }

function renderCount(){
  const n=picked.size;
  $('cntEl').textContent=T('order.count',{n});
  $('cntEl').className='cnt'+(n?'':' zero');
}
function setSendLabel(){
  const b=$('sendBtn');
  b.textContent = state==='pick' ? T('order.send')
    : state==='fail' ? T('order.retry')
    : state==='ok' ? (LI+1>=LEVELS.length ? T('order.result') : T('order.next'))
    : T('order.result');
  b.disabled=false;
  $('quitBtn').classList.toggle('hidden', state!=='ok' || LI+1>=LEVELS.length);
}

function loadLevel(){
  const L=LEVELS[LI];
  picked=new Set(); busy=false; tries=0; state='pick';
  $('ordNum').textContent=LI+1;
  $('ordName').textContent=lvText('name');
  $('custWho').textContent=lvText('who');
  $('custSay').textContent=lvText('say');
  $('starEl').innerHTML=starSockets(3);
  $('goalBot').innerHTML=robotSVG(L.goal,{plan:true});
  // 색·크기 칩 — 4장(nochip)부터는 안 준다: 색·크기는 손님 말에서 읽어야 한다
  if(L.paint&&!L.nochip){ $('paintChip').classList.remove('hidden');
    $('paintDot').style.background=L.goal.color; $('paintTxt').textContent=lvText('paint'); }
  else $('paintChip').classList.add('hidden');
  $('sizeChip').classList.toggle('hidden', L.goal.size==='normal'||!!L.nochip);
  $('sizeTxt').textContent = L.goal.size==='small' ? T('order.size_small') : T('order.size_huge');
  $('madeBot').className='bot';
  $('madeBot').innerHTML='<p class="empty">'+T('order.empty')+'</p>';
  $('verdict').className='verdict'; $('diffRow').innerHTML='';
  document.querySelector('.stage').classList.add('pick');
  $('tray').innerHTML=L.cards.map((c,i)=>{
    const P=PART[c.p];
    return `<button class="pc" data-i="${i}"><span class="bar" style="background:${P.c}"></span>`+
      `<span class="in"><span class="tag" style="background:${P.c}">${esc(tagName(c.p))}</span>`+
      `<span class="txt">${esc(cardText(i))}</span><span class="chk">✓</span></span></button>`;
  }).join('');
  $('tray').querySelectorAll('.pc').forEach(b=>{
    b.onclick=()=>{ if(busy||state==='ok'||state==='over') return;
      const i=+b.dataset.i;
      if(picked.has(i)) picked.delete(i); else picked.add(i);
      b.classList.toggle('on',picked.has(i));
      renderCount();
      if(state==='fail'){ state='pick'; clearVerdict(); }   // 다시 고르기 시작하면 도장은 치운다
    };
  });
  renderCount();
  setSendLabel();
  document.querySelector('.scroll').scrollTop=0;
}
function clearVerdict(){
  $('verdict').className='verdict'; $('diffRow').innerHTML='';
  const made=$('madeBot'); if(made.dataset.spec){ made.innerHTML=robotSVG(JSON.parse(made.dataset.spec)); made.className='bot'; }
  setSendLabel();
}

/* ===================== 시키기 ===================== */
function send(){
  if(busy) return;
  busy=true; tries++; $('sendBtn').disabled=true;
  document.querySelector('.stage').classList.remove('pick');
  $('starEl').innerHTML=starSockets(Math.max(1,4-tries));
  const L=LEVELS[LI], spec=buildSpec(L.cards,picked);
  const wrong=wrongKeys(spec,L.goal);
  const ok=wrong.length===0;
  LOG.push({o:LI,c:[...picked].sort((a,b)=>a-b),t:Math.max(0,Math.round(performance.now()-T0))});

  const made=$('madeBot');
  made.className='bot'; made.dataset.spec=JSON.stringify(spec);
  made.innerHTML='<p class="empty">'+T('order.making')+'</p>';
  setTimeout(()=>{
    made.innerHTML=robotSVG(spec,{wrong:ok?[]:wrong});
    made.className='bot build';
    setTimeout(()=>{
      const v=$('verdict');
      if(ok){
        const st=Math.max(1,4-tries);
        starsPer[LI]=st;
        $('starEl').innerHTML=starSockets(st);
        v.className='verdict on pass'; $('vTtl').textContent=T('order.v_ok'); $('vSub').innerHTML=starStr(st);
        state='ok';
      } else {
        made.className=(spec.base==='none')?'bot fall':'bot wob';
        $('diffRow').innerHTML=wrong.map(k=>`<span>${esc(partName(k))}</span>`).join('');
        if(tries>=MAX_TRIES){ v.className='verdict on over'; $('vTtl').textContent=T('order.v_gone'); $('vSub').textContent=''; state='over'; }
        else { v.className='verdict on fail'; $('vTtl').textContent=T('order.v_no'); $('vSub').textContent=T('order.tries_left',{n:MAX_TRIES-tries}); state='fail';
               $('starEl').innerHTML=starSockets(Math.max(1,3-tries)); }
      }
      busy=false; setSendLabel();
    },600);
  },500);
}

function submitOnce(){
  if(submitted) return; submitted=true;
  const cleared=starsPer.filter(Boolean).length;
  if(window.MGBridge) MGBridge.submit(cleared,{timed:true,log:LOG});   // 숫자는 참고값 — 서버가 log 로 다시 센다
}
function showResult(gone){
  submitOnce();
  const cleared=starsPer.filter(Boolean).length, stars=starsPer.reduce((a,b)=>a+(b||0),0), full=LEVELS.length*3;
  $('oTtl').textContent = gone ? T('order.o_gone') : (cleared>=LEVELS.length ? T('order.o_all') : T('order.o_done'));
  $('oCleared').textContent=cleared+' / '+LEVELS.length;
  $('oStars').textContent='★ '+stars;
  $('oStarLab').textContent=T('order.o_stars',{s:stars,f:full});
  $('overOv').classList.toggle('result-fail',gone);
  $('overOv').classList.remove('hidden');
}

/* ===================== 배선 ===================== */
$('sendBtn').onclick=()=>{
  if(busy) return;
  if(state==='pick') return send();
  if(state==='fail'){ state='pick'; clearVerdict(); return send(); }   // 고른 그대로 다시 시키기
  if(state==='ok'){ if(LI+1>=LEVELS.length) return showResult(false); LI++; loadLevel(); return; }
  if(state==='over') return showResult(true);
};
$('quitBtn').onclick=()=>showResult(false);
$('oAgain').onclick=()=>{ LI=0; starsPer=[]; LOG=[]; submitted=false; T0=performance.now(); $('overOv').classList.add('hidden'); $('overOv').classList.remove('result-fail'); loadLevel(); };
$('startBtn').onclick=()=>{ $('startOv').classList.add('hidden'); T0=performance.now(); LOG=[]; submitted=false; };

$('sArt').innerHTML=charSVG(CARI_SUIT,{cari:true});
loadLevel();
