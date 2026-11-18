/* ---------- анімація фону тем (canvas#bgfx) і заставка ---------- */
/* Кожна тема має свій ефект. Малюється ~30 кадрів/с, пауза у прихованій вкладці,
   вимикається перемикачем «Анімація фону» (SET.anim) або системним «зменшити рух». */
const FX={c:null,x:null,w:0,h:0,dpr:1,raf:0,last:0,st:null,k:''};
const fxRM=()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){return false}};
const fxRnd=(a,b)=>a+Math.random()*(b-a);
const fxA=(c,a)=>{c=String(c).trim();if(c[0]==='#'){let h=c.slice(1);if(h.length===3)h=h.split('').map(x=>x+x).join('');const n=parseInt(h.slice(0,6),16);return`rgba(${n>>16&255},${n>>8&255},${n&255},${a})`}return c};
function fxSize(){const c=FX.c;if(!c)return;FX.dpr=Math.min(1.5,window.devicePixelRatio||1);FX.w=innerWidth;FX.h=innerHeight;c.width=Math.round(FX.w*FX.dpr);c.height=Math.round(FX.h*FX.dpr);FX.x.setTransform(FX.dpr,0,0,FX.dpr,0,0);FX.st=null}
/* ефекти: init(w,h,T) → стан; draw(ctx,s,w,h,T,t) */
const FXE={
matrix:{init:(w,h)=>{const f=15,n=Math.ceil(w/f);return{f,y:Array.from({length:n},()=>fxRnd(-h,0)/f),v:Array.from({length:n},()=>fxRnd(.35,1))}},
 draw:(x,s,w,h,T)=>{x.fillStyle=fxA(getComputedStyle(document.documentElement).getPropertyValue('--bg')||'#000',.16);x.fillRect(0,0,w,h);x.font=`${s.f-1}px 'JetBrains Mono',monospace`;const ch='01アイウエオカキクケコサシスセソタチツテトナニ₿$Ξ<>{}=+';
  for(let i=0;i<s.y.length;i++){const y=s.y[i]*s.f;x.fillStyle=fxA(T.ac,.95);x.fillText(ch[Math.random()*ch.length|0],i*s.f,y);x.fillStyle=fxA(T.ac2,.5);x.fillText(ch[Math.random()*ch.length|0],i*s.f,y-s.f);s.y[i]+=s.v[i];if(y>h&&Math.random()>.975)s.y[i]=fxRnd(-20,0)}},trail:1},
tech:{init:(w,h)=>({p:Array.from({length:Math.min(70,w*h/16000|0)},()=>({x:fxRnd(0,w),y:fxRnd(0,h),vx:fxRnd(-.25,.25),vy:fxRnd(-.4,-.1),r:fxRnd(.6,1.8)}))}),
 draw:(x,s,w,h,T)=>{for(const p of s.p){p.x+=p.vx;p.y+=p.vy;if(p.y<-5){p.y=h+5;p.x=fxRnd(0,w)}if(p.x<-5)p.x=w+5;if(p.x>w+5)p.x=-5;x.fillStyle=fxA(T.ac,.55);x.fillRect(p.x,p.y,p.r*1.6,p.r*1.6)}
  for(let i=0;i<s.p.length;i+=7){const p=s.p[i];x.strokeStyle=fxA(T.ac2,.25);x.beginPath();x.moveTo(p.x,p.y);x.lineTo(p.x+14,p.y);x.stroke()}}},
cyber:{init:()=>({y:0,g:[]}),
 draw:(x,s,w,h,T,t)=>{s.y=(s.y+2.2)%h;const gr=x.createLinearGradient(0,s.y-60,0,s.y);gr.addColorStop(0,fxA(T.ac,0));gr.addColorStop(1,fxA(T.ac,.16));x.fillStyle=gr;x.fillRect(0,s.y-60,w,60);
  x.strokeStyle=fxA(T.ac2,.05);for(let y=0;y<h;y+=4){x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}
  if(Math.random()<.08)s.g.push({x:fxRnd(0,w),y:fxRnd(0,h),w:fxRnd(20,140),h:fxRnd(2,10),l:fxRnd(4,12),c:Math.random()<.5?T.ac:T.ac2});
  s.g=s.g.filter(g=>g.l-->0);for(const g of s.g){x.fillStyle=fxA(g.c,.35);x.fillRect(g.x,g.y,g.w,g.h)}}},
midnight:{init:(w,h)=>({s:Array.from({length:Math.min(140,w*h/7000|0)},()=>({x:fxRnd(0,w),y:fxRnd(0,h),r:fxRnd(.4,1.4),p:fxRnd(0,6.3)})),m:null}),
 draw:(x,s,w,h,T,t)=>{for(const p of s.s){const a=.35+.35*Math.sin(t/900+p.p);x.fillStyle=fxA(T.tx,a);x.beginPath();x.arc(p.x,p.y,p.r,0,7);x.fill()}
  if(!s.m&&Math.random()<.006)s.m={x:fxRnd(w*.2,w),y:fxRnd(0,h*.4),l:1};if(s.m){const m=s.m,gr=x.createLinearGradient(m.x,m.y,m.x+90,m.y-45);gr.addColorStop(0,fxA(T.ac,.9));gr.addColorStop(1,fxA(T.ac,0));x.strokeStyle=gr;x.lineWidth=1.6;x.beginPath();x.moveTo(m.x,m.y);x.lineTo(m.x+90,m.y-45);x.stroke();x.lineWidth=1;m.x-=9;m.y+=4.5;m.l-=.02;if(m.l<=0||m.x<-100)s.m=null}}},
quantum:{init:(w,h)=>({p:Array.from({length:Math.min(55,w*h/18000|0)},()=>({x:fxRnd(0,w),y:fxRnd(0,h),vx:fxRnd(-.3,.3),vy:fxRnd(-.3,.3)}))}),
 draw:(x,s,w,h,T)=>{const P=s.p,D=130;for(const p of P){p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>w)p.vx*=-1;if(p.y<0||p.y>h)p.vy*=-1}
  for(let i=0;i<P.length;i++)for(let j=i+1;j<P.length;j++){const dx=P[i].x-P[j].x,dy=P[i].y-P[j].y,d=Math.hypot(dx,dy);if(d<D){x.strokeStyle=fxA(T.ac,.22*(1-d/D));x.beginPath();x.moveTo(P[i].x,P[i].y);x.lineTo(P[j].x,P[j].y);x.stroke()}}
  for(const p of P){x.fillStyle=fxA(T.ac2,.8);x.beginPath();x.arc(p.x,p.y,1.6,0,7);x.fill()}}},
aurora:{init:()=>({}),
 draw:(x,s,w,h,T,t)=>{x.globalCompositeOperation='lighter';[[T.ac,.0006,.30,.12],[T.ac2,.0004,.42,.10],[T.up,.0005,.22,.07]].forEach(([c,sp,yy,a],k)=>{x.beginPath();x.moveTo(0,h);for(let X=0;X<=w;X+=16){const y=h*yy+Math.sin(X/180+t*sp*3+k)*40+Math.sin(X/70+t*sp*5)*14;x.lineTo(X,y)}x.lineTo(w,h);x.closePath();const gr=x.createLinearGradient(0,h*yy-60,0,h*yy+260);gr.addColorStop(0,fxA(c,a));gr.addColorStop(1,fxA(c,0));x.fillStyle=gr;x.fill()});x.globalCompositeOperation='source-over'}},
synth:{init:()=>({o:0}),
 draw:(x,s,w,h,T,t)=>{const hz=h*.62;s.o=(s.o+.6)%40;const sx=w/2,sy=hz-70,R=Math.min(110,w*.22);const gr=x.createLinearGradient(0,sy-R,0,sy+R);gr.addColorStop(0,fxA(T.ac2,.55));gr.addColorStop(1,fxA(T.ac,.35));x.fillStyle=gr;x.beginPath();x.arc(sx,sy,R,Math.PI,0);x.fill();
  x.fillStyle=fxA(getComputedStyle(document.documentElement).getPropertyValue('--bg')||'#000',1);for(let i=0;i<5;i++){const yy=sy-R*.55+i*R*.14;x.fillRect(sx-R,yy,R*2,2+i*1.2)}
  x.strokeStyle=fxA(T.ac,.35);for(let i=0;i<14;i++){const z=(i*40+s.o)/560,y=hz+(h-hz)*z*z;x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}
  for(let i=-12;i<=12;i++){x.beginPath();x.moveTo(sx+i*20,hz);x.lineTo(sx+i*w*.18,h);x.stroke()}}},
ocean:{init:(w,h)=>({b:Array.from({length:Math.min(40,w/14|0)},()=>({x:fxRnd(0,w),y:fxRnd(0,h),r:fxRnd(1.5,5),v:fxRnd(.3,1),p:fxRnd(0,6)}))}),
 draw:(x,s,w,h,T,t)=>{for(let i=0;i<4;i++){const X=w*(.15+i*.25)+Math.sin(t/3000+i)*40,gr=x.createLinearGradient(X,0,X+120,h);gr.addColorStop(0,fxA(T.ac,.08));gr.addColorStop(1,fxA(T.ac,0));x.fillStyle=gr;x.beginPath();x.moveTo(X-30,0);x.lineTo(X+50,0);x.lineTo(X+200,h);x.lineTo(X+60,h);x.fill()}
  for(const b of s.b){b.y-=b.v;b.p+=.03;if(b.y<-10){b.y=h+10;b.x=fxRnd(0,w)}x.strokeStyle=fxA(T.ac2,.45);x.beginPath();x.arc(b.x+Math.sin(b.p)*6,b.y,b.r,0,7);x.stroke()}}},
magma:{init:(w,h)=>({e:Array.from({length:Math.min(60,w/9|0)},()=>({x:fxRnd(0,w),y:fxRnd(0,h),r:fxRnd(.8,2.6),v:fxRnd(.4,1.4),l:fxRnd(.3,1)}))}),
 draw:(x,s,w,h,T,t)=>{const gr=x.createLinearGradient(0,h*.7,0,h);gr.addColorStop(0,fxA(T.ac,0));gr.addColorStop(1,fxA(T.ac,.12+.04*Math.sin(t/700)));x.fillStyle=gr;x.fillRect(0,h*.7,w,h*.3);
  x.globalCompositeOperation='lighter';for(const e of s.e){e.y-=e.v;e.x+=Math.sin((e.y+t/20)/40)*.4;e.l-=.003;if(e.y<-10||e.l<=0){e.y=h+5;e.x=fxRnd(0,w);e.l=fxRnd(.5,1)}x.fillStyle=fxA(e.r>1.8?T.ac2:T.ac,.75*e.l);x.beginPath();x.arc(e.x,e.y,e.r,0,7);x.fill()}x.globalCompositeOperation='source-over'}},
light:{init:(w,h)=>({b:Array.from({length:12},()=>({x:fxRnd(0,w),y:fxRnd(0,h),r:fxRnd(40,120),vx:fxRnd(-.2,.2),vy:fxRnd(-.15,.15),k:Math.random()<.5}))}),
 draw:(x,s,w,h,T)=>{for(const b of s.b){b.x+=b.vx;b.y+=b.vy;if(b.x<-b.r)b.x=w+b.r;if(b.x>w+b.r)b.x=-b.r;if(b.y<-b.r)b.y=h+b.r;if(b.y>h+b.r)b.y=-b.r;const g=x.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r);g.addColorStop(0,fxA(b.k?T.ac:T.ac2,.10));g.addColorStop(1,fxA(b.k?T.ac:T.ac2,0));x.fillStyle=g;x.beginPath();x.arc(b.x,b.y,b.r,0,7);x.fill()}}}};
function fxLoop(t){FX.raf=requestAnimationFrame(fxLoop);if(document.hidden||t-FX.last<33)return;FX.last=t;const e=FXE[FX.k];if(!e)return;const x=FX.x,T=TH();if(!FX.st)FX.st=e.init(FX.w,FX.h,T);if(!e.trail)x.clearRect(0,0,FX.w,FX.h);e.draw(x,FX.st,FX.w,FX.h,T,t)}
/* увімкнути/вимкнути анімацію під поточну тему (викликається з applyTheme і перемикача) */
function fxApply(){const on=SET.anim!==0&&!fxRM()&&!!FXE[SET.theme],r=document.documentElement;
 if(!FX.c){FX.c=document.getElementById('bgfx');if(!FX.c)return;FX.x=FX.c.getContext('2d');if(!FX.x)return;addEventListener('resize',()=>{if(FX.raf)fxSize()})}
 cancelAnimationFrame(FX.raf);FX.raf=0;FX.x.setTransform(1,0,0,1,0,0);FX.x.clearRect(0,0,FX.c.width,FX.c.height);
 r.classList.toggle('fx-on',on);if(!on)return;FX.k=SET.theme;fxSize();FX.raf=requestAnimationFrame(fxLoop)}
/* заставка: прибрати після завантаження даних, не раніше ніж за 1,6 с від старту */
const SPL={t0:performance.now(),done:0};
function splashHide(){const s=document.getElementById('splash');if(SPL.done||!s)return;SPL.done=1;s.classList.add('out');setTimeout(()=>s.remove(),650)}
function splashEnd(){const wait=Math.max(0,1600-(performance.now()-SPL.t0));setTimeout(splashHide,wait)}
(()=>{const s=document.getElementById('splash');if(!s)return;if(SET.splash===0||fxRM()){s.remove();SPL.done=1;return}s.addEventListener('click',splashHide);setTimeout(splashHide,6000)})();
