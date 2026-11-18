/* ---------- Відгук: учасник бета-тесту пише відгук прямо з Orbix ----------
   Запис у таблицю feedback (RLS: лише свої; тригер ставить автора й статус, не більше 20 на добу).
   Адмін бачить усі відгуки в розділі «Адмін» з ID автора, без пошти. */
const FB={from:'ov',kind:'bug',busy:0,mine:null,msg:''};
const FBK={bug:'Помилка',idea:'Ідея',other:'Інше'};
const VNAME={ov:'Головна',bots:'Мої боти',mk:'Ринок',aw:'Авто-майстер',bd:'Конструктор',bs:'Бектести',jr:'Журнал угод',st:'Статистика',mon:'Моніторинг',sx:'Стрес-тест',set:'Налаштування',pf:'Профіль',adm:'Адмін',help:'Довідка'};
async function fbMine(){if(!SB||!CLOUD.u)return;try{const r=await SB.from('feedback').select('id,kind,body,status,created_at').order('created_at',{ascending:false}).limit(5);if(!r.error)FB.mine=r.data||[]}catch(e){}if(CUR==='fb')fbR()}
function fbR(){const el=$('#fbx');if(!el)return;
if(!CLOUD.u){el.innerHTML='<div class="card"><h2>Відгук</h2><p class="mu" style="margin-bottom:12px">Увійдіть в акаунт, щоб надіслати відгук: так ми знатимемо ваш ID і зможемо відповісти.</p><button class="b p" id="fbin">Увійти</button></div>';$('#fbin').onclick=()=>{go('pf');pfTab('a',1)};return}
const keep=$('#fbt')?$('#fbt').value:'';
el.innerHTML=`<div class="card"><h2>Відгук</h2><p class="mu" style="margin-bottom:12px">Що зламалось, що незручно або що додати. Ваш ID${CLOUD.no?' #'+String(CLOUD.no).padStart(4,'0'):''} і розділ додаються самі, пошта — ні.</p>
<div class="pft" role="radiogroup" aria-label="Тип відгуку">${Object.entries(FBK).map(([k,l])=>`<button class="b sm tg" data-fk="${k}" aria-pressed="${FB.kind===k}">${l}</button>`).join('')}</div>
<label>Текст<textarea id="fbt" rows="6" maxlength="2000" placeholder="${FB.kind==='bug'?'Що ви робили, що сталося і що мало статися…':FB.kind==='idea'?'Що варто додати чи змінити…':'Ваш відгук…'}"></textarea></label>
<div class="row" style="justify-content:space-between;align-items:center;margin:6px 0 12px"><span class="mu" style="font-size:12px">Розділ: ${esc(VNAME[FB.from]||FB.from)}</span><span class="mu mono" id="fbc" style="font-size:12px">0 / 2000</span></div>
<button class="b p" id="fbs"${FB.busy?' disabled':''}>${FB.busy?'Надсилаю…':'Надіслати'}</button><p class="mu" id="fbm" style="margin-top:8px">${esc(FB.msg)}</p></div>
<div class="card"><h2>Ваші відгуки</h2>${FB.mine==null?'<p class="mu">Завантажую…</p>':FB.mine.length?FB.mine.map(f=>`<div class="fbi"><div class="row" style="justify-content:space-between;gap:8px"><b>${FBK[f.kind]||f.kind}</b><span class="mu" style="font-size:12px">${new Date(f.created_at).toLocaleString('uk-UA',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · ${f.status==='done'?'розглянуто':'нове'}</span></div><p class="fbb">${esc(f.body)}</p></div>`).join(''):'<p class="mu">Ви ще не надсилали відгуків.</p>'}</div>`;
const t=$('#fbt');t.value=keep;const cnt=()=>{$('#fbc').textContent=t.value.length+' / 2000'};cnt();t.oninput=cnt;
$$('#fbx [data-fk]').forEach(b=>b.onclick=()=>{FB.kind=b.dataset.fk;fbR()});$('#fbs').onclick=fbSend}
async function fbSend(){const t=$('#fbt'),body=(t&&t.value||'').trim();if(FB.busy)return;
if(body.length<3){FB.msg='Напишіть хоча б кілька слів.';$('#fbm').textContent=FB.msg;return}
FB.busy=1;FB.msg='';fbR();$('#fbt').value=body;
try{const r=await SB.from('feedback').insert({kind:FB.kind,body:body.slice(0,2000),page:String(FB.from||'').slice(0,40)});if(r.error)throw r.error;
FB.busy=0;fbR();$('#fbt').value='';$('#fbc').textContent='0 / 2000';toast('Дякуємо! Відгук отримано');FB.mine=null;fbMine()}
catch(e){FB.busy=0;FB.msg='Не вдалося надіслати: '+(e.message||e);fbR();$('#fbt').value=body}}
