/* ---------- Walk-forward: перевірка самого процесу підбору ----------
   Період ділиться на кроки. На кожному кроці параметри підбираються на вікні навчання (1/3 періоду),
   а найкраща конфігурація перевіряється на наступному вікні, якого підбір не бачив; потім усе зсувається.
   Тестові вікна йдуть одне за одним без перекриття й разом покривають останні 2/3 періоду. */
const minN=c=>{const F=fltOf({pair:c.pair,fut:c.fut});return F&&F.minN||5};
function sampleG(R,g0,c,LV){const orders=3+(R()*6|0),mult=pick(R,[1,1.1,1.2,1.3,1.5,1.7]),lev=pick(R,LV),U=ladder({orders,mult}),mnN=minN(c),base=c.amt>0?c.amt/U:Math.max(10,Math.ceil(mnN/(c.fut===0?1:lev)*1.05));if(base<5||base*(c.fut===0?1:lev)<mnN)return null;
return{g:{...g0,orders,mult,lev,base,step:pick(R,[.008,.012,.016,.022,.03]),smul:pick(R,[1,1.2,1.5]),tp:pick(R,[.005,.008,.012,.018]),sl:pick(R,[.04,.06,.08,.1]),trail:pick(R,[0,.005,.01])},dep:c.amt>0?c.amt:2*base*U}}
/* найкраща конфігурація на вікні [tS, tE): використовуються лише свічки, що закрились до tE */
function searchWin(c,tS,tE,salt,o={}){const H=hist(dk(c)),R=rng((c.amt|0)*7+c.pair.length*7919+salt*101+13),mxL=c.fut===0?1:maxLev(c.pair,c.ex),LV=c.lev?[Math.min(c.lev,mxL)]:[1,2,3].filter(x=>x<=mxL);let top=null;
for(const tf of c.tf?[c.tf]:[1,4,12,24,168]){const A=aggC(H,tf),W=tfMs(tf),i0=lbT(A,tS);let i1=i0;while(i1<A.length&&A[i1].t+W<=tE)i1++;if(i1-i0<60)continue;
for(const[name,sg,kk]of STR)for(const d of c.dr?[c.dr]:[1,-1]){if(d<0&&c.fut===0)continue;const g0=normG({...DEF,pair:c.pair,ex:c.ex,sg,k:kk,d,tf,rm:pick(R,[30,35,40]),fut:c.fut,name}),e=entry(A,g0);
for(let j=0;j<(o.ns||8);j++){const q=sampleG(R,g0,c,LV);if(!q)continue;const Rn=run(A.slice(i0,i1),e.slice(i0,i1),q.g,0,0,q.dep),s=summ(Rn,q.dep);if(s.n<(o.mn||5))continue;
const sc=s.roi+2*s.ddp-(s.liq?500:0)-(s.broke?500:0);if(!top||sc>top.sc)top={g:q.g,dep:q.dep,sc,s}}}}return top}
/* межі кроків walk-forward */
function wfPlan(c,o={}){const H=hist(dk(c));if(!H.length)return null;const folds=o.folds||8,end=H[H.length-1].t+H1,start=Math.max(H[0].t,end-c.per*H1),span=Math.floor((end-start)/H1),trH=Math.floor(span/3),teH=Math.floor((span-trH)/folds);
if(teH<24)return null;const P=[];for(let f=0;f<folds;f++){const trS=start+f*teH*H1,trE=trS+trH*H1,teE=f===folds-1?end:trE+teH*H1;P.push({f,trS,trE,teE})}return{P,trH,teH,folds}}
/* один крок: підбір на навчанні, перевірка на тесті */
function wfFold(c,p,o={}){const b=searchWin(c,p.trS,p.trE,p.f,o);if(!b)return{...p,none:1,pnl:0,roi:0,n:0,dd:0,ddp:0};
const H=hist(dk(c)),g=b.g,A=aggC(H,g.tf),W=tfMs(g.tf),j0=lbT(A,p.trE);let j1=j0;while(j1<A.length&&A[j1].t+W<=p.teE)j1++;
const e=entry(A,g),s=summ(run(A.slice(j0,j1),e.slice(j0,j1),g,0,0,b.dep),b.dep);
return{...p,g,dep:b.dep,is:{roi:b.s.roi,n:b.s.n,ddp:b.s.ddp},pnl:s.pnl,roi:s.roi,n:s.n,dd:s.dd,ddp:s.ddp,liq:s.liq}}
/* підсумок: частка прибуткових тестів, сумарна дохідність тестів, WFE = темп тестів / темп навчання */
function wfSum(F,plan){const D2=F.filter(x=>!x.none),n=D2.length,pos=D2.filter(x=>x.pnl>0).length,oos=D2.reduce((a,x)=>a+x.roi,0);
const hrs=x=>(x.teE-x.trE)/H1,isR=n?D2.reduce((a,x)=>a+x.is.roi,0)/n/plan.trH:0,ooR=n?D2.reduce((a,x)=>a+x.roi/hrs(x),0)/n:0,wfe=isR>0?ooR/isR:null;
const worst=n?Math.min(...D2.map(x=>x.roi)):0,liq=D2.reduce((a,x)=>a+(x.liq||0),0);
const verdict=n<3?'мало':oos>0&&pos/n>=.6&&wfe!=null&&wfe>=.5&&!liq?'стабільна':oos<=0||pos/n<.4?'нестабільна':'сумнівна';
return{F,n,pos,folds:F.length,oos,wfe,worst,liq,verdict,trH:plan.trH,teH:plan.teH}}
function wfo(c,o={}){const plan=wfPlan(c,o);if(!plan)return null;return wfSum(plan.P.map(p=>wfFold(c,p,o)),plan)}


