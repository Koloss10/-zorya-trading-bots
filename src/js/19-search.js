/* ---------- Пошук (кнопка-лупа у верхній панелі, клавіша «/») ----------
   Шукає одразу: розділи й налаштування, мої боти (пара, напрямок, таймфрейм), пари ринку, записи Вікі
   (індикатори, фільтри, параметри, готові стратегії). Enter — перший результат, Esc — закрити. */
const SRX=[['Тема оформлення','set'],['Звук і сповіщення','set'],['Telegram-сповіщення','set'],['Назва та логотип','set'],['Дані: експорт і скидання','set'],
['Ліміти ризику','pf'],['Тестнет: API-ключі біржі','pf'],['Акаунт: вхід і вихід','pf'],['Аварійна зупинка всіх ботів','bots'],['Вікі','wiki']];
/* інші назви полів для пошуку (укр. і англ. написання) */
const SRA={fr:'трейлінг трейлинг trailing',ft:'тейк профіт тейк-профіт take profit тп',fl:'стоп лос стоп-лосс stop loss сл',flv:'leverage кредитне плече',fb:'сума маржа ордер',fo:'докупівлі усереднення dca',fm:'мартингейл martingale',fs:'крок сітки step',ftf:'таймфрейм timeframe свічка',fdr:'long short лонг шорт',fmk:'спот ф\'ючерси futures spot',fbe:'беззбиток breakeven',fs1:'частковий тейк multi-tp',fc:'пауза cooldown',fk:'збіг сигналів'};
const SR={q:'',items:[]};
const srN=s=>String(s).toLowerCase().replace(/ё/g,'е');
function srFind(q){const n=srN(q.trim());if(!n)return[];const m=s=>srN(s).includes(n),o=[];
const sec=[...MENU.filter(([k])=>k!=='adm'||CLOUD.adm).map(([k,l])=>[l,k]),...SRX].filter(([l])=>m(l)).slice(0,6);
if(sec.length)o.push(['Розділи',sec.map(([l,k])=>({t:l,s:'',go:()=>go(k)}))]);
const B=bots.filter(x=>m(x.g.pair)||m(x.g.pair.replace('/',''))||m(dir(x.g))||m(x.g.name||'')).slice(0,6);
if(B.length)o.push(['Мої боти',B.map(x=>({t:x.g.pair,s:`${dir(x.g)} · ${tfl(x.g.tf)} · ${x.on?'працює':'пауза'}`,go:()=>srBot(x)}))]);
const P=PK.filter(p=>m(p)||m(p.replace('/',''))).slice(0,6);
if(P.length)o.push(['Пари на ринку',P.map(p=>({t:p,s:'графік і ціна',go:()=>{MKP=p;go('mk')}}))]);
const H=(typeof HM!=='undefined'?Object.values(HM):[]).filter(h=>hqHas(h[0])),nm=h=>m(h[1])||m(SRA[h[0]]||''),
W=[...H.filter(nm),...H.filter(h=>!nm(h)&&m(h[2]))].slice(0,8).map(h=>({t:h[1],s:h[2],go:()=>wikiGo(h[0])}));
if(typeof STR!=='undefined')STR.forEach((s,i)=>{if(W.length<10&&m(s[0]))W.push({t:s[0],s:'готова стратегія',go:()=>wikiGo('st'+i)})});
if(W.length)o.push(['Вікі',W]);return o}
function srBot(x){const q=$('#bq');if(q)q.value='';go('bots');setTimeout(()=>{const c=$(`#bl2 [data-bot="${x.id}"]`)||$(`#bl [data-bot="${x.id}"]`);if(!c)return;c.scrollIntoView({block:'center'});c.classList.add('flash');setTimeout(()=>c.classList.remove('flash'),1600)},60)}
function srR(){const el=$('#srr');if(!el)return;const G=srFind(SR.q);SR.items=G.flatMap(g=>g[1]);let i=0;
el.innerHTML=!SR.q.trim()?'<p class="mu">Шукайте розділ, свого бота, пару (наприклад, ETH) або що означає індикатор чи фільтр (RSI, трейлінг, плече).</p>'
:G.length?G.map(([h,L])=>`<h3>${esc(h)}</h3>`+L.map(r=>`<button class="b sri" data-sri="${i++}"><b>${esc(r.t)}</b>${r.s?`<span class="mu">${esc(r.s)}</span>`:''}</button>`).join('')).join('')
:'<p class="mu">Нічого не знайдено.</p>'}
function srOpen(o){const p=$('#srp');if(!p)return;p.hidden=$('#srbg').hidden=!o;$('#sbtn').setAttribute('aria-expanded',!!o);
if(o){mnu(0);const i=$('#srq');i.value=SR.q;srR();setTimeout(()=>{i.focus();i.select()},20)}}
function srPick(n){const r=SR.items[n];if(!r)return;srOpen(0);r.go()}
$('#sbtn').onclick=()=>srOpen($('#srp').hidden);$('#srbg').onclick=()=>srOpen(0);$('#srx').onclick=()=>srOpen(0);
$('#srq').oninput=e=>{SR.q=e.target.value;srR()};
$('#srq').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();srPick(0)}};
$('#srr').onclick=e=>{const b=e.target.closest('[data-sri]');if(b)srPick(+b.dataset.sri)};
addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#srp').hidden){srOpen(0);$('#sbtn').focus();return}
if(e.key==='/'&&$('#srp').hidden&&!/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'')&&!(document.activeElement||{}).isContentEditable){e.preventDefault();srOpen(1)}});
