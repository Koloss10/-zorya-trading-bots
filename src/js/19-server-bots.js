/* ---------- Боти на сервері 24/7 ----------
   Бот із позначкою «Сервер 24/7» (config._srv) торгує на сервері: Edge Function `runner` кожні 5 хвилин
   проганяє той самий рушій і зберігає стан у bot_state, події — у bot_events. Браузер лише показує цей стан
   і не дублює угод та сповіщень такого бота. */
let SRV={busy:0,seen:new Set(),t:null};
function srvToggle(x){if(!CLOUD.u)return toast('Увійдіть в акаунт, щоб запустити бота на сервері.');if(!x.rid){cloudQ();return toast('Зачекайте кілька секунд: бот ще синхронізується з хмарою.')}
x.srv=!x.srv;x.srvEx=TN.ex||'bybit';if(!x.srv){x.srvSt=0;x.srvAt=null}sbots();lst();
toast(x.srv?'Бот '+x.g.pair+' переходить на сервер (до 5 хвилин). Сервер торгує з цього моменту, навіть коли застосунок закритий.':'Бот '+x.g.pair+' знову працює лише в браузері.')}
async function srvLoad(){if(!SB||!CLOUD.u||SRV.busy)return;const L=bots.filter(x=>x.srv&&x.rid);if(!L.length)return;SRV.busy=1;try{
const ids=L.map(x=>x.rid),s=await SB.from('bot_state').select('bot_id,state,updated_at').in('bot_id',ids);
if(!s.error)for(const r of s.data||[]){const x=L.find(y=>y.rid===r.bot_id),st=r.state||{};if(!x||!st.b)continue;
const b=new Bot(x.g);b.pos=st.b.pos||null;b.tr=Array.isArray(st.b.tr)?st.b.tr:[];b.cd=st.b.cd||0;b.cum=st.b.cum||0;x.b=b;x.pk=st.pk||0;x.dd=st.dd||0;x.lt=st.lt||x.lt;x.srvSt=1;x.srvAt=Date.parse(r.updated_at)}
const e=await SB.from('bot_events').select('id,bot_id,level,message,created_at').in('bot_id',ids).order('created_at',{ascending:false}).limit(30);
if(!e.error){let add=0;for(const r of (e.data||[]).slice().reverse()){if(SRV.seen.has(r.id))continue;SRV.seen.add(r.id);FEED.unshift({t:new Date(r.created_at).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}),m:'☁ '+r.message});add++}
if(add){FEED=FEED.slice(0,60);sv('zfeed',FEED);feedR()}}
lst();upd()}catch(er){}finally{SRV.busy=0}}
const srvLine=x=>x.srv?`<p class="mu" style="margin:0">☁ Працює на сервері 24/7${x.srvSt&&x.srvAt?' · оновлено '+tm(x.srvAt):' · сервер підхопить бота протягом 5 хвилин'}${x.tn?' · угоди дублюються на '+((x.srvEx||'bybit')==='bybit'?'Bybit Demo':'Binance Testnet'):''}</p>`:'';
setInterval(()=>{if(!document.hidden)srvLoad()},60000);
