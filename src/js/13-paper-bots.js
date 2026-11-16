/* ---------- paper-боти ---------- */
let bots=[],uid=0;
/* Paper-бот торгує лише з моменту запуску (t0). Стан не вигадується з минулого: після перезавантаження
   він детерміновано відтворюється прогоном закритих свічок від t0 з урахуванням пауз (sp — інтервали роботи). */
const clk=p=>{const H=DT[p];return Math.max(Date.now(),H&&H.length?H[H.length-1].t+36e5:0)};
const actAt=(x,t)=>(x.sp||[]).some(([a,b])=>t>a&&(b==null||t<=b));
function advance(x,live){const g=x.g,tf=g.tf||1,H=D[dk(g)];if(!H||!H.length)return;const A=aggC(H,tf),W=tfMs(tf);if(!A.length)return;
if(A[0].t>x.t0)x.trunc=1;let i=A.length;while(i>0&&A[i-1].t+W>x.lt)i--;if(i>=A.length)return;const e=entry(A,g);
for(;i<A.length;i++){const c=A[i],ct=c.t+W;x.lt=ct;if(!actAt(x,ct))continue;const n0=x.b.tr.length,p0=x.b.pos,o0=p0?p0.n:0,c0=p0?p0.cost:0;
x.b.step(Math.floor(c.t/W),c,e[i]);const v=x.b.eqv(c);x.pk=Math.max(x.pk,v);x.dd=Math.min(x.dd,v-x.pk);if(!live)continue;const t=x.b.tr,p=x.b.pos;
if(t.length>n0){const l=t[t.length-1];notify(l.sl||l.liq?'sl':'close',x,{pnl:l.pnl,liq:l.liq});tnMirror(x,'close')}else if(!p0&&p){notify('open',x,{price:c.c});tnMirror(x,'open',p.cost)}else if(p0&&p&&p.n>o0){notify('dca',x,{price:p.last,n:p.n});tnMirror(x,'dca',p.cost-c0)}}}
function mk(g,ex,on=true,m={}){g=normG({...DEF,...g});const t0=+m.t0||clk(dk(g)),sp=Array.isArray(m.sp)?m.sp:on?[[t0,null]]:[];
const x={id:++uid,g,ex,on,b:new Bot(g),pk:0,dd:0,t0,lt:t0,sp,tn:!!m.tn&&!!g.fut};advance(x,0);bots.push(x);return x}
function setOn(x,on){if(!!x.on===!!on)return;const t=clk(dk(x.g));x.on=!!on;if(on)x.sp.push([t,null]);else{const l=x.sp[x.sp.length-1];if(l&&l[1]==null)l[1]=t}}
const bv=x=>x.b.eqv(lastC(dk(x.g)));
let BOOT=0,KEEP=[];const sloc=()=>{if(BOOT)sv('zorya3',bots.map(({g,ex,on,rid,pid,t0,sp,tn})=>({g,ex,on,rid,pid,t0,sp,tn})).concat(KEEP))},sbots=()=>{sloc();cloudQ()};
function bcard(x){const p=x.b.pos,v=bv(x),s=x.b.tr,w=s.filter(t=>t.pnl>0).length;
return`<div class="bc ${x.on?'on':'off'}" data-bot="${x.id}"><div class="bh"><b>${x.g.pair}</b><span class="mu">${dir(x.g)} · ${tfl(x.g.tf)} · ${x.g.lev}× · ${x.ex} · з ${tm(x.t0)}</span><span class="st" style="margin-left:auto">${x.on?'Працює':'Пауза'}</span></div>${!s.length&&!p?`<p class="mu" style="margin:0">Paper-бот торгує з моменту запуску: сигнал перевіряється після закриття кожної свічки ${tfl(x.g.tf)}. Минулі результати стратегії дивіться в бектесті.</p>`:''}${x.trunc?'<p class="mu" style="margin:0">Історії бракує, щоб відтворити бота з самого запуску: показано з найранішої доступної свічки.</p>':''}
<div class="bm"><div>PnL з відкритою<b class="${cls(v)}">${f(v)}</b></div><div>Угод / win<b>${s.length} / ${s.length?Math.round(w/s.length*100):0}%</b></div><div>Позиція<b>${p?p.n+' з '+x.g.orders+' орд.':'немає'}</b></div><div>Просадка<b class="${cls(x.dd)}">${f(x.dd,0)}</b></div></div>
<div class="ac"><button class="b sm ${x.on?'':'p'}" data-a="t" data-id="${x.id}">${x.on?'Пауза':'Запустити'}</button><button class="b sm" data-a="g" data-id="${x.id}">Графік</button><button class="b sm" data-a="j" data-id="${x.id}">Угоди</button><button class="b sm" data-a="c" data-id="${x.id}">Клон</button>${x.g.fut&&CLOUD.u&&TN.c?`<button class="b sm tg" data-a="tn" data-id="${x.id}" aria-pressed="${!!x.tn}" title="Дублювати угоди бота ордерами на тестнеті Binance Futures">${x.tn?'Тестнет: увімк.':'Тестнет'}</button>`:''}<button class="b sm d" data-a="x" data-id="${x.id}">Видалити</button></div><div class="gr" id="gr${x.id}" hidden></div><div class="gr" id="jr${x.id}" hidden></div></div>`}
function lstTo(el,list){if(!el)return;const on=list.filter(x=>x.on),off=list.filter(x=>!x.on);el.innerHTML=list.length?(on.length?`<h3>Працюють · ${on.length}</h3>`+on.map(bcard).join(''):'')+(off.length?`<h3>На паузі · ${off.length}</h3>`+off.map(bcard).join(''):''):'<p class="mu">Ботів ще немає. Запустіть топового бота, скористайтеся Авто-майстром або створіть свого.</p>'}
function lst(){lstTo($('#bl'),bots);const q=($('#bq')&&$('#bq').value||'').trim().toUpperCase();lstTo($('#bl2'),q?bots.filter(x=>x.g.pair.includes(q)):bots);upd()}
const jrn=x=>x.b.tr.length?x.b.tr.slice(-10).reverse().map(t=>`<div class="tr"><span>${tm(t.ts)}, ордерів ${t.n}${t.liq?', ліквідація':t.sl?', SL':''}</span><span class="mono ${cls(t.pnl)}">${f(t.pnl)}</span></div>`).join(''):'<p class="mu">Угод ще немає.</p>';
function upd(){let pnl=0,all=[];
bots.forEach(x=>{const v=bv(x);pnl+=v;all.push(...x.b.tr);const c=$$(`[data-bot="${x.id}"]`);for(const el of c){const p=x.b.pos,s=x.b.tr,w=s.filter(t=>t.pnl>0).length,b=el.querySelectorAll('.bm b');if(b.length>=4){b[0].textContent=f(v);b[0].className=cls(v);b[1].textContent=`${s.length} / ${s.length?Math.round(w/s.length*100):0}%`;b[2].textContent=p?p.n+' з '+x.g.orders+' орд.':'немає';b[3].textContent=f(x.dd,0)}}
const j=$('#jr'+x.id);if(j&&!j.hidden)j.innerHTML=jrn(x)});
all.sort((a,b)=>a.i-b.i);let e=0;const cur=all.map(t=>e+=t.pnl);if($('#ch'))$('#ch').innerHTML=chart(cur);
hero(pnl,cur);$$('.chv').forEach(c=>{if(c.offsetParent)c._d()});if($('#v-st')&&!$('#v-st').hidden)sta()}
function hero(pnl,cur){const h=$('#hero');if(!h)return;const inv=bots.reduce((a,x)=>a+x.g.base*ladder(x.g),0);
if(VARIANT===2)h.innerHTML=`<div class="card hero"><div class="mu">Капітал у ботах</div><div class="big">${n2(inv,0)} <span class="mu" style="font-size:14px">USDT</span></div><div class="row" style="gap:16px"><span>PnL всього <b class="mono ${cls(pnl)}">${f(pnl)}</b></span><span>Ботів <b class="mono">${bots.filter(x=>x.on).length}/${bots.length}</b></span></div><div style="margin-top:10px">${chart(cur,120)}</div><div class="row" style="margin-top:12px"><button class="b p" id="h-aw">Авто-майстер</button><button class="b" id="h-nb">Новий бот</button><button class="b" id="h-mk">Ринок</button></div></div>`;
else h.innerHTML='';const a=$('#h-aw'),b=$('#h-nb'),c=$('#h-mk');if(a)a.onclick=()=>go('aw');if(b)b.onclick=()=>go('bd');if(c)c.onclick=()=>go('mk')}
function chart(v,H=200){if(v.length<2)return'<p class="mu">Недостатньо угод для графіка.</p>';const W=640,mn=Math.min(0,...v),mx=Math.max(0,...v),sp=(mx-mn)||1,Y=y=>(H-8-(y-mn)/sp*(H-16)).toFixed(1),P=v.map((y,i)=>(i/(v.length-1)*W).toFixed(1)+' '+Y(y));
return`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Крива капіталу" preserveAspectRatio="none" style="height:${H>150?'auto':H+'px'}"><path d="M0 ${Y(0)}H${W}" stroke="var(--ln)"/><path d="M${P.join('L')}V${H}H0Z" fill="var(--ac)" fill-opacity=".12"/><path d="M${P.join('L')}" fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`}
function stepBots(k){bots.filter(x=>dk(x.g)===k&&x.on).forEach(x=>advance(x,1))}
/* демо: нова синтетична свічка кожні 1,5 с */
function tick(){for(const k of Object.keys(DT)){const cs=DT[k];const c=nextC(PAIRS[pairOf(k)],Math.random);c.t=cs[cs.length-1].t+H1;cs.push(c);stepBots(k)}upd()}
/* live: опитування біржі, нові закриті свічки й поточна ціна */
let polling=0;async function poll(){if(polling||MD.mode!=='live'||document.hidden)return;polling=1;try{const W=new Set(bots.filter(x=>x.on).map(x=>dk(x.g)));$$('.chv').forEach(c=>{if(c.offsetParent&&c._d){const v=c===$('#gv')?$('#gv')._k:null;if(v)W.add(v)}});
$$('.gr').forEach(g=>{if(!g.hidden){const b=g.closest('[data-bot]');if(b){const x=bots.find(y=>y.id===+b.dataset.bot);if(x)W.add(dk(x.g))}}});let ch=0;
for(const p of W){if(!DT[p])continue;try{const a=await kl(p,{lim:3}),H=DT[p],now=Date.now();for(const c of a){if(c.t+H1<=now){if(c.t>H[H.length-1].t){if(isF(p)&&c.t%(8*H1)===0)try{await frLoad(pairOf(p))}catch(e){}H.push(c);stepBots(p);ch=1}}else{MD.live[p]=c;ch=1}}}catch(e){}}
if(ch)upd();const mc=$('#mkc');if(CUR==='mk'&&mc._poll)await mc._poll().catch(()=>{})}finally{polling=0}}
function botClick(e){const t=e.target.closest('button');if(!t||!t.dataset.a)return;const x=bots.find(b=>b.id===+t.dataset.id),a=t.dataset.a;if(!x)return;
if(a==='g'){const g=t.closest('.bc').querySelector('.gr');g.hidden=!g.hidden;if(!g.hidden&&!g._d)lwChart(g,()=>({pair:x.g.pair,key:dk(x.g),tf:x.g.tf,lv:()=>lines(x.g,x.b.pos,dk(x.g)),mk:()=>tradeMarks(x.b.tr,x.b.pos,x.g)}),'mini');else if(!g.hidden)g._d();return}
if(a==='j'){const j=t.closest('.bc').querySelectorAll('.gr')[1];j.hidden=!j.hidden;j.innerHTML=jrn(x);return}
if(a==='c'){fill(x.g,x.ex);go('bd');return}
if(a==='tn'){x.tn=!x.tn;sbots();lst();toast(x.tn?'Угоди бота '+x.g.pair+' дублюватимуться на тестнеті (поки застосунок відкритий)':'Тестнет для бота вимкнено');return}
if(a==='x'){if(!confirm('Видалити бота '+ttl(x)+'?'))return;bots=bots.filter(b=>b!==x)}else setOn(x,!x.on);sbots();lst()}
$('#bl').onclick=botClick;$('#bl2').onclick=botClick;
const killAll=()=>{if(!confirm('Поставити всіх ботів на паузу?'))return;bots.forEach(x=>setOn(x,false));sbots();lst();FEED.unshift({t:now(),m:'Аварійна зупинка: усі боти на паузі'});sv('zfeed',FEED);feedR()};
$('#ks').onclick=killAll;$('#ks2').onclick=killAll;$('#nb2').onclick=()=>go('bd');$('#bq').oninput=lst;

