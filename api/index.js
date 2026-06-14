// api/index.js — Magic Calculator с Upstash Redis

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'magic2024';
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

// ── Redis helpers ─────────────────────────────────────────────────────────────
async function redisCmd(...args) {
  const res = await fetch(`${REDIS_URL}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const data = await res.json();
  return data.result;
}

async function getClients() {
  const raw = await redisCmd('GET', 'clients');
  return raw ? JSON.parse(raw) : {};
}

async function saveClients(clients) {
  await redisCmd('SET', 'clients', JSON.stringify(clients));
}

function randomToken() {
  return Math.random().toString(36).slice(2, 10) +
         Math.random().toString(36).slice(2, 10);
}

function html(content) {
  return `<!DOCTYPE html><html lang="ru"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Magic Calculator</title>
<style>
  body { background:#111; color:#fff; font-family:-apple-system,sans-serif;
         display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0; }
  .box { background:#1c1c1e; border-radius:16px; padding:32px; max-width:400px; width:90%; }
  h2   { margin:0 0 20px; font-size:20px; }
  input { width:100%; padding:12px; border-radius:8px; border:1px solid #333;
          background:#2c2c2e; color:#fff; font-size:16px; box-sizing:border-box; margin-bottom:12px; }
  button { width:100%; padding:12px; border-radius:8px; border:none;
           background:#ff9f0a; color:#fff; font-size:16px; cursor:pointer; }
  button:hover { background:#e8900a; }
  table { width:100%; border-collapse:collapse; margin-top:16px; font-size:14px; }
  th,td { padding:8px 6px; text-align:left; border-bottom:1px solid #2c2c2e; word-break:break-all; }
  th { color:#636366; font-weight:normal; }
  .badge-ok  { color:#30d158; }
  .badge-off { color:#ff453a; }
  .btn-small { width:auto; padding:4px 10px; font-size:12px; background:#333; border-radius:6px; cursor:pointer; border:none; color:#fff; }
  .btn-red   { background:#ff453a; }
  a { color:#ff9f0a; }
  .copy { cursor:pointer; font-size:11px; color:#636366; margin-left:6px; }
</style></head><body>${content}</body></html>`;
}

module.exports = async (req, res) => {
  const url  = new URL(req.url, `https://${req.headers.host}`);
  const path = url.pathname;

  // ── ADMIN: вход ───────────────────────────────────────────────────────────
  if (path === '/admin') {
    if (req.method === 'POST') {
      let body = '';
      await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
      const pass = new URLSearchParams(body).get('password');
      if (pass !== ADMIN_PASSWORD) {
        return res.end(html(`<div class="box">
          <h2>🔐 Неверный пароль</h2>
          <a href="/admin">← Назад</a>
        </div>`));
      }
      res.setHeader('Set-Cookie', `admin_session=${ADMIN_PASSWORD}; Path=/; HttpOnly`);
      res.setHeader('Location', '/admin/dashboard');
      res.statusCode = 302;
      return res.end();
    }
    return res.end(html(`<div class="box">
      <h2>🎩 Вход в панель управления</h2>
      <form method="POST" action="/admin">
        <input type="password" name="password" placeholder="Пароль" autofocus>
        <button type="submit">Войти</button>
      </form>
    </div>`));
  }

  // ── Проверка авторизации ───────────────────────────────────────────────────
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => { const [k,...v]=c.trim().split('='); return [k,v.join('=')]; })
  );
  const isAdmin = cookies['admin_session'] === ADMIN_PASSWORD;

  // ── ADMIN: дашборд ────────────────────────────────────────────────────────
  if (path === '/admin/dashboard') {
    if (!isAdmin) { res.setHeader('Location', '/admin'); res.statusCode = 302; return res.end(); }
    const clients = await getClients();
    const rows = Object.entries(clients).map(([token, c]) => {
      const link = `https://${req.headers.host}/?token=${token}`;
      const status = c.active ? `<span class="badge-ok">✅ активна</span>` : `<span class="badge-off">🚫 отозвана</span>`;
      const lastSeen = c.lastSeen ? new Date(c.lastSeen).toLocaleString('ru') : 'не открывали';
      return `<tr>
        <td>${c.name}</td>
        <td><code style="font-size:11px">${token}</code>
          <span class="copy" onclick="navigator.clipboard.writeText('${link}');this.textContent='✓'">📋</span>
        </td>
        <td>${c.visits}</td>
        <td>${lastSeen}</td>
        <td>${status}</td>
        <td>
          <form method="POST" action="/admin/toggle" style="display:inline">
            <input type="hidden" name="token" value="${token}">
            <button class="${c.active ? 'btn-small btn-red' : 'btn-small'}">${c.active ? 'Отозвать' : 'Включить'}</button>
          </form>
          <form method="POST" action="/admin/delete" style="display:inline;margin-left:4px">
            <input type="hidden" name="token" value="${token}">
            <button class="btn-small btn-red">Удалить</button>
          </form>
        </td>
      </tr>`;
    }).join('');
    return res.end(html(`<div class="box" style="max-width:820px">
      <h2>🎩 Панель управления</h2>
      <form method="POST" action="/admin/create" style="display:flex;gap:8px;margin-bottom:16px">
        <input style="margin:0" type="text" name="name" placeholder="Имя клиента" required>
        <button style="width:auto;padding:12px 20px">+ Создать ссылку</button>
      </form>
      <table>
        <tr><th>Клиент</th><th>Токен</th><th>Визиты</th><th>Последний вход</th><th>Статус</th><th>Действия</th></tr>
        ${rows || '<tr><td colspan="6" style="color:#636366;text-align:center">Клиентов пока нет</td></tr>'}
      </table>
    </div>`));
  }

  // ── ADMIN: создать ────────────────────────────────────────────────────────
  if (path === '/admin/create' && req.method === 'POST') {
    if (!isAdmin) { res.statusCode = 403; return res.end(); }
    let body = '';
    await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
    const name = new URLSearchParams(body).get('name') || 'Клиент';
    const token = randomToken();
    const clients = await getClients();
    clients[token] = { name, visits: 0, active: true, lastSeen: null, created: Date.now() };
    await saveClients(clients);
    res.setHeader('Location', '/admin/dashboard');
    res.statusCode = 302;
    return res.end();
  }

  // ── ADMIN: toggle ─────────────────────────────────────────────────────────
  if (path === '/admin/toggle' && req.method === 'POST') {
    if (!isAdmin) { res.statusCode = 403; return res.end(); }
    let body = '';
    await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
    const token = new URLSearchParams(body).get('token');
    const clients = await getClients();
    if (clients[token]) clients[token].active = !clients[token].active;
    await saveClients(clients);
    res.setHeader('Location', '/admin/dashboard');
    res.statusCode = 302;
    return res.end();
  }

  // ── ADMIN: delete ─────────────────────────────────────────────────────────
  if (path === '/admin/delete' && req.method === 'POST') {
    if (!isAdmin) { res.statusCode = 403; return res.end(); }
    let body = '';
    await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
    const token = new URLSearchParams(body).get('token');
    const clients = await getClients();
    delete clients[token];
    await saveClients(clients);
    res.setHeader('Location', '/admin/dashboard');
    res.statusCode = 302;
    return res.end();
  }

  // ── Manifest PWA (токен зашит в start_url) ────────────────────────────────
  if (path === '/manifest.json') {
    const t = url.searchParams.get('token');
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      name: 'Калькулятор', short_name: 'Калькулятор',
      start_url: '/?token=' + t,
      display: 'standalone',
      background_color: '#000000', theme_color: '#000000',
      icons: [{ src: '/apple-icon.png', sizes: '192x192', type: 'image/svg+xml' }]
    }));
  }

  // ── Иконка для PWA ───────────────────────────────────────────────────────
  if (path === '/icon.png' || path === '/apple-icon.png') {
    const buf = Buffer.from('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', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(buf);
  }

  // ── Проверка токена ───────────────────────────────────────────────────────
  const token = url.searchParams.get('token');
  const clients = await getClients();

  if (!token || !clients[token] || !clients[token].active) {
    res.statusCode = 403;
    return res.end(html(`<div class="box" style="text-align:center">
      <div style="font-size:48px;margin-bottom:16px">🚫</div>
      <h2>Доступ запрещён</h2>
      <p style="color:#636366">Ссылка недействительна или была отозвана</p>
    </div>`));
  }

  // Считаем визит
  clients[token].visits++;
  clients[token].lastSeen = Date.now();
  await saveClients(clients);

  // ── Калькулятор ───────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(`<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Калькулятор">
<meta name="theme-color" content="#000000">
<link rel="manifest" href="/manifest.json?token=${token}">
<link rel="apple-touch-icon" href="/apple-icon.png">
<title>Калькулятор</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { width:100%; height:100%; background:#000; overflow:hidden;
    font-family:-apple-system,'SF Pro Display','Helvetica Neue',sans-serif; }
  .calculator {
    width:100%; height:100%; height:100dvh; background:#000;
    display:flex; flex-direction:column; justify-content:flex-end;
    padding:0 0 max(env(safe-area-inset-bottom,34px),34px) 0;
  }
  .display {
    padding:0 24px 12px 24px; text-align:right;
    display:flex; flex-direction:column; justify-content:flex-end; flex:1;
  }
  .history { font-size:14px; color:#636366; margin-bottom:4px;
    white-space:nowrap; overflow-x:auto; text-align:right;
    scrollbar-width:none; -ms-overflow-style:none; }
  .history::-webkit-scrollbar { display:none; }
  .expression { font-size:18px; color:#888; min-height:22px; margin-bottom:4px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .result { font-weight:300; color:#fff; line-height:1;
    overflow:hidden; white-space:nowrap; transition:font-size 0.1s; font-size:72px; }
  .buttons { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; padding:0 12px; }
  .btn { border:none; border-radius:50%; font-size:30px; font-weight:400; cursor:pointer;
    aspect-ratio:1; display:flex; align-items:center; justify-content:center;
    transition:filter 0.08s; user-select:none; -webkit-user-select:none; }
  .btn:active { filter:brightness(1.5); }
  .btn.gray   { background:#a5a5a5; color:#000; }
  .btn.dark   { background:#333333; color:#fff; }
  .btn.orange { background:#ff9f0a; color:#fff; }
  .btn.orange.active-op { background:#fff; color:#ff9f0a; }
  .btn.zero { grid-column:span 2; border-radius:50px; justify-content:flex-start;
    padding-left:28px; aspect-ratio:unset;
    height:calc((100vw - 24px - 36px) / 4); max-height:85px; }
</style>
</head>
<body>
<div class="calculator">
  <div class="display">
    <div class="history"    id="history"></div>
    <div class="expression" id="expression"></div>
    <div class="result"     id="result">0</div>
  </div>
  <div class="buttons">
    <button class="btn gray"   id="btnAC" onclick="pressAC()">AC</button>
    <button class="btn gray"   onclick="pressPlusMinus()">+/-</button>
    <button class="btn gray"   id="btnPct" onclick="pressPercent()"><span id="pctText">%</span></button>
    <button class="btn orange" id="opDiv" onclick="pressOp('÷')">÷</button>
    <button class="btn dark" id="key7" onclick="pressNum('7')">7</button>
    <button class="btn dark" id="key8" onclick="pressNum('8')">8</button>
    <button class="btn dark" id="key9" onclick="pressNum('9')">9</button>
    <button class="btn orange" id="opMul" onclick="pressOp('×')">×</button>
    <button class="btn dark" id="key4" onclick="pressNum('4')">4</button>
    <button class="btn dark" id="key5" onclick="pressNum('5')">5</button>
    <button class="btn dark" id="key6" onclick="pressNum('6')">6</button>
    <button class="btn orange" id="opSub" onclick="pressOp('−')">−</button>
    <button class="btn dark" id="key1" onclick="pressNum('1')">1</button>
    <button class="btn dark" id="key2" onclick="pressNum('2')">2</button>
    <button class="btn dark" id="key3" onclick="pressNum('3')">3</button>
    <button class="btn orange" id="opAdd" onclick="pressOp('+')">+</button>
    <button class="btn dark zero" id="key0" onclick="pressNum('0')">0</button>
    <button class="btn dark" onclick="pressDot()">.</button>
    <button class="btn orange" onclick="pressEquals()">=</button>
  </div>
</div>
<script>
// ── Обычный калькулятор ───────────────────────────────────────────────────────
let current='0', op1=null, pendOp=null, fresh=true, historyParts=[];

// ── Магия ─────────────────────────────────────────────────────────────────────
// phase: 0=обычный 1=год1×машина 2=после1= 3=год2 4=после2= 5=зритель тыкает
let mPhase=0, mTarget=0, mRes1=0, mRes2=0;
let xDigits=[], xIdx=0, xShown='';

function buildTarget(){
  const t=new Date(Date.now()+60000);
  const p=n=>String(n).padStart(2,'0');
  const yy=String(t.getFullYear()).slice(-2); // только 2 последние цифры года
  return parseInt(p(t.getHours())+p(t.getMinutes())+p(t.getDate())+p(t.getMonth()+1)+yy,10);
}

function showDot(n){
  clearDots();
  const el=document.getElementById('key'+n);
  if(!el)return;
  const dot=document.createElement('span');
  dot.id='keydot'+n;
  dot.style.cssText='position:absolute;bottom:5px;left:50%;transform:translateX(-50%);'+
    'width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,0.75);pointer-events:none;';
  el.style.position='relative';
  el.appendChild(dot);
}
function clearDots(){for(let i=0;i<=9;i++){const d=document.getElementById('keydot'+i);if(d)d.remove();}}

// ── Дисплей ───────────────────────────────────────────────────────────────────
const _cv=document.createElement('canvas');
const _cx=_cv.getContext('2d');
function setDisplay(val){
  current=String(val);
  const el=document.getElementById('result');
  el.textContent=current;
  const maxW=(window.innerWidth||375)-48;
  const sizes=[72,64,56,48,40,34,28,22,18,15];
  let chosen=15;
  for(const s of sizes){
    _cx.font='300 '+s+'px -apple-system,sans-serif';
    if(_cx.measureText(current).width<=maxW){chosen=s;break;}
  }
  el.style.fontSize=chosen+'px';
  el.style.letterSpacing=chosen>=40?'-2px':chosen>=28?'-1px':'0px';
}
function setExpr(v){document.getElementById('expression').textContent=v;}
function setHistory(v){document.getElementById('history').textContent=v;}
function renderHistory(){
  const h=historyParts.join(' ').replace(/^= /,'');
  setHistory(h);
  const el=document.getElementById('history');
  el.scrollLeft=el.scrollWidth;
}
function setActiveOp(op){
  ['opDiv','opMul','opSub','opAdd'].forEach(id=>document.getElementById(id).classList.remove('active-op'));
  const map={'÷':'opDiv','×':'opMul','−':'opSub','+':'opAdd'};
  if(op&&map[op])document.getElementById(map[op]).classList.add('active-op');
}

// ── AC ────────────────────────────────────────────────────────────────────────
function pressAC(){
  current='0';op1=null;pendOp=null;fresh=true;
  mPhase=0;mTarget=0;mRes1=0;mRes2=0;
  xDigits=[];xIdx=0;xShown='';historyParts=[];
  setDisplay('0');setExpr('');setHistory('');setActiveOp(null);
  document.getElementById('btnAC').textContent='AC';
  document.getElementById('pctText').innerHTML='%';
  clearDots();
}

// ── % → активация ─────────────────────────────────────────────────────────────
function pressPercent(){
  if(mPhase>0)return;
  pressAC();
  mTarget=buildTarget();
  mPhase=1;
  document.getElementById('pctText').innerHTML='%<span style="font-size:6px;vertical-align:sub;opacity:0.6">•</span>';
}

// ── Цифры ─────────────────────────────────────────────────────────────────────
function pressNum(n){
  document.getElementById('btnAC').textContent='C';
  if(mPhase===5){
    if(xIdx<xDigits.length){
      xShown+=xDigits[xIdx];xIdx++;
      setDisplay(xShown);
      historyParts[historyParts.length-1]=xShown;
      renderHistory();
      setExpr('+ '+xShown);
    }
    return;
  }
  setActiveOp(null);
  if(fresh){current=n;fresh=false;}
  else{if(current.length>=9)return;current=(current==='0')?n:current+n;}
  setDisplay(current);
}
function pressDot(){
  if(mPhase===5)return;
  document.getElementById('btnAC').textContent='C';
  if(fresh){current='0.';fresh=false;}
  else if(!current.includes('.'))current+='.';
  setDisplay(current);
}
function pressPlusMinus(){
  if(mPhase===5)return;
  if(current==='0')return;
  current=current.startsWith('-')?current.slice(1):'-'+current;
  setDisplay(current);
}

// ── Операторы ─────────────────────────────────────────────────────────────────
function pressOp(op){
  if(mPhase===5)return;
  setActiveOp(op);
  const val=parseFloat(current)||0;

  if(mPhase===2&&op==='+'){
    // После шага 1: готовим сложение с годом2
    pendOp='+';fresh=true;
    setExpr(fmt(mRes1)+' +');
    mPhase=3;
    return;
  }
  if(mPhase===4&&op==='+'){
    // После шага 2: зритель тыкает
    const x=mTarget-mRes2;
    xDigits=String(Math.abs(x)).split('');
    if(x<0)xDigits.unshift('-');
    xIdx=0;xShown='';
    const dc=xDigits.filter(d=>d!=='-').length;
    showDot(dc);
    mPhase=5;fresh=true;
    historyParts.push('');renderHistory();
    setExpr(fmt(mRes2)+' +');
    return;
  }

  // Обычный режим
  if(op1!==null&&!fresh){
    const res=doCalc(op1,pendOp,val);
    setDisplay(fmt(res));setExpr(fmt(res)+' '+op);op1=res;
  } else {
    op1=val;setExpr(fmt(val)+' '+op);
  }
  pendOp=op;fresh=true;
}

// ── Равно ─────────────────────────────────────────────────────────────────────
function pressEquals(){
  if(mPhase===5){
    historyParts[historyParts.length-1]=xShown;
    setHistory(historyParts.join(' ')+' =');
    setDisplay(String(mTarget));setExpr('');setActiveOp(null);
    mPhase=0;fresh=true;
    document.getElementById('pctText').innerHTML='%';
    clearDots();
    return;
  }
  if(pendOp===null)return;
  const val=parseFloat(current);

  if(mPhase===1){
    const res=doCalc(op1,pendOp,val);
    setExpr(fmt(op1)+' '+pendOp+' '+fmt(val)+' =');
    setDisplay(fmt(res));setActiveOp(null);
    mRes1=res;mPhase=2;op1=res;pendOp=null;fresh=true;
    historyParts=[fmt(res)];renderHistory();
    return;
  }
  if(mPhase===3){
    const res=mRes1+val;
    setExpr(fmt(mRes1)+' + '+fmt(val)+' =');
    setDisplay(fmt(res));setActiveOp(null);
    mRes2=res;mPhase=4;op1=res;pendOp=null;fresh=true;
    historyParts=[fmt(mRes1)+' + '+fmt(val)+' = '+fmt(res)];renderHistory();
    return;
  }

  const res=doCalc(op1,pendOp,val);
  setExpr(fmt(op1)+' '+pendOp+' '+fmt(val)+' =');
  setDisplay(fmt(res));setActiveOp(null);
  op1=null;pendOp=null;fresh=true;
}

// ── Арифметика ────────────────────────────────────────────────────────────────
function doCalc(a,op,b){
  if(op==='+')return a+b;
  if(op==='−')return a-b;
  if(op==='×')return a*b;
  if(op==='÷')return b!==0?a/b:0;
  return b;
}
function fmt(n){
  if(!isFinite(n))return '0';
  if(Number.isInteger(n))return fmtInt(n);
  const r=parseFloat(n.toFixed(4));
  const parts=String(r).split('.');
  return fmtInt(parseInt(parts[0]))+','+parts[1];
}
function fmtInt(n){
  const s=String(Math.abs(n));
  let out='';
  for(let i=0;i<s.length;i++){if(i>0&&(s.length-i)%3===0)out+=' ';out+=s[i];}
  return n<0?'-'+out:out;
}
</script>
</body>
</html>`);
};
