/* ---------- Якість стратегії: витрати, ринкові режими, стабільність ----------
   Та сама конфігурація проганяється кілька разів:
   - з витратами бектесту (комісії біржі, funding, прослизання стопу);
   - без витрат — валовий результат, щоб побачити, скільки забирають витрати;
   - з подвоєними витратами: комісії ×2, ще 0,1 % прослизання на кожне ринкове виконання (вхід, стоп, трейлінг),
     прослизання стопу щонайменше 0,2 %, funding ×2;
   - окремо на вікнах (30 днів, для коротких періодів — 7 днів), кожне вікно — новий бот із нуля.
     Вікно класифікується за ринком: ріст / падіння / бічний (зміна ціни за вікно) і висока / звичайна волатильність;
   - окремо на першій і другій половині періоду (чи не зникає перевага з часом).
   Висновок: стабільна / сумнівна / нестабільна / збиткова / мало угод, з переліком причин. */
const QREG={up:'ріст',dn:'падіння',fl:'бічний'};
const median=a=>{const b=[...a].sort((x,y)=>x-y),n=b.length;return n?n%2?b[n>>1]:(b[n/2-1]+b[n/2])/2:0};
/* ринок на відрізку свічок: зміна ціни, денна волатильність, режим (поріг тренду ±8 % за 30 днів, масштаб √часу) */
function qMarket(A,tf,W){const r=[];for(let i=1;i<A.length;i++)r.push(Math.log(A[i].c/A[i-1].c));const m=r.reduce((a,x)=>a+x,0)/(r.length||1),
sd=Math.sqrt(r.reduce((a,x)=>a+(x-m)**2,0)/(r.length||1)),vol=sd*Math.sqrt(24/tf),ret=A.length?A[A.length-1].c/A[0].o-1:0,thr=.08*Math.sqrt(W/720);
return{ret,vol,reg:ret>thr?'up':ret<-thr?'dn':'fl'}}
/* A — свічки таймфрейму бота, e — сигнали входу для них, k — скільки останніх свічок аналізувати */
function qualityA(A,e,g,dep,k=A.length){normG(g);const tf=g.tf||1,off=A.length-k,cs=A.slice(off),es=e.slice(off),hrs=k*tf;
const R=(gg,a=0,b=cs.length)=>summ(run(cs.slice(a,b),es.slice(a,b),gg,(off+a)*tf,0,dep),dep);
const base=R(g),gross=R({...g,ftk:0,fmk:0,slip:0,frx:0}),hard=R({...g,ftk:g.ftk*2+.001,fmk:g.fmk*2,slip:Math.max(.002,(g.slip||0)*2),frx:2});
const cost=gross.pnl-base.pnl,costShare=gross.pnl>0?cost/gross.pnl:null;
/* вікна */
const W=hrs>=2160?720:hrs>=336?168:0,wn=W?Math.round(W/tf):0,wins=[];
if(wn>=10)for(let a=cs.length-Math.floor(cs.length/wn)*wn;a+wn<=cs.length;a+=wn){const s=R(g,a,a+wn),mk=qMarket(cs.slice(a,a+wn),tf,W);wins.push({t:cs[a].t,n:s.n,pnl:s.pnl,roi:s.roi,liq:s.liq,...mk})}
const vm=median(wins.map(w=>w.vol));wins.forEach(w=>w.hv=w.vol>vm*1.25);
const act=wins.filter(w=>w.n>0||Math.abs(w.pnl)>1e-9),pos=act.filter(w=>w.pnl>0).length,posShare=act.length?pos/act.length:null,
tot=act.reduce((a,w)=>a+w.pnl,0),best=act.length?Math.max(...act.map(w=>w.pnl)):0,conc=tot>0&&act.length>=4?best/tot:null;
const reg={};for(const w of wins){const o=reg[w.reg]||(reg[w.reg]={n:0,pos:0,pnl:0,tr:0});o.n++;o.pnl+=w.pnl;o.tr+=w.n;if(w.pnl>0)o.pos++}
const hv=wins.filter(w=>w.hv),lv=wins.filter(w=>!w.hv),vol={hi:{n:hv.length,pnl:hv.reduce((a,w)=>a+w.pnl,0)},lo:{n:lv.length,pnl:lv.reduce((a,w)=>a+w.pnl,0)}};
/* половини періоду: дохідність за 30 днів */
const hm=cs.length>>1,h1=R(g,0,hm),h2=R(g,hm),m30=s=>s.roi/(hm*tf/720),h1m=m30(h1),h2m=m30(h2);
/* причини */
const F=[],add=(t,sev)=>F.push({t,sev});
if(base.liq)add(`Ліквідацій: ${base.liq}`,1);
/* частка витрат окремою причиною не є: якщо витрати забирають понад половину валового прибутку, подвоєні вже дають збиток */
if(base.pnl>0&&hard.pnl<=0)add('Збиткова при подвоєних витратах (комісії, прослизання, funding)',1);
if(posShare!=null&&act.length>=3&&posShare<.5)add(`Прибуткових лише ${pos} з ${act.length} вікон`,1);
if(conc!=null&&conc>.6)add(`${Math.round(conc*100)} % прибутку дало одне вікно`,0);
for(const[r,o]of Object.entries(reg))if(o.n>=2&&o.tr>0&&o.pnl<0)add(`Збиткова на ринку «${QREG[r]}» (${o.n} вікон, ${o.pnl.toFixed(2).replace('-','−')} USDT)`,0);
if(h1.n>=3&&h2.n>=1&&h1m>0&&h2m<=0)add('Друга половина періоду збиткова: перевага зникає',1);
const verdict=base.pnl<=0?'збиткова':base.n<10?'мало угод':F.some(x=>x.sev)?'нестабільна':F.length?'сумнівна':'стабільна';
return{base,gross,hard,cost,costShare,W,wins,act:act.length,pos,posShare,conc,reg,vol,h1,h2,h1m,h2m,flags:F,verdict,hrs}}
function quality(g,per,dep){normG(g);const A=aggC(hist(dk(g)),g.tf||1);return qualityA(A,entry(A,g),g,dep,Math.min(A.length,Math.floor(per/(g.tf||1))))}
/* walk-forward підбору для пари з тими самими таймфреймом, напрямком і плечем; mine — ці параметри на тестових вікнах */
function qualityWF(g,ex,per,o={folds:6,ns:4}){normG(g);const c={pair:g.pair,ex,fut:g.fut,per,amt:g.base*ladder(g),tf:g.tf||1,dr:g.d,lev:g.lev||1},w=wfo(c,o);if(!w)return null;
const tS=w.F[0].trE,A=aggC(hist(dk(g)),g.tf||1),e=entry(A,g),j0=lbT(A,tS),dep=g.base*ladder(g),s=summ(run(A.slice(j0),e.slice(j0),g,0,0,dep),dep);
return{...w,mine:s.roi,dep}}
