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
<link rel="apple-touch-icon" href="/apple-icon.png">
<meta name="theme-color" content="#000000">
<link rel="manifest" href="/manifest.json?token=${token}">
<title>Калькулятор</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { width:100%; height:100%; background:#000; overflow:hidden;
    font-family:-apple-system,'SF Pro Display','Helvetica Neue',sans-serif; }
  .calculator {
    width:100%; height:100%; height:100dvh; background:#000;
    display:flex; flex-direction:column; justify-content:flex-end;
    padding:0 0 max(env(safe-area-inset-bottom,34px), 34px) 0;
  }
  .display {
    padding:0 24px 12px 24px; text-align:right;
    display:flex; flex-direction:column; justify-content:flex-end;
    flex:1;
  }
  .history { font-size:14px; color:#636366; margin-bottom:4px;
    white-space:nowrap; overflow-x:auto; text-align:right;
    scrollbar-width:none; -ms-overflow-style:none; }
  .history::-webkit-scrollbar { display:none; }
  .expression { font-size:18px; color:#888; min-height:22px; margin-bottom:4px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .result { font-weight:300; color:#fff; line-height:1;
    letter-spacing:-2px; overflow:hidden; white-space:nowrap;
    transition:font-size 0.15s;
    font-size:72px; width:100%; text-align:right; }
  .buttons { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; padding:0 12px 0 12px; }
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
  @keyframes pulse {
    0%   { box-shadow:0 0 0 0 rgba(255,159,10,0.8); }
    70%  { box-shadow:0 0 0 18px rgba(255,159,10,0); }
    100% { box-shadow:0 0 0 0 rgba(255,159,10,0); }
  }
  .pulse-anim { animation:pulse 0.5s ease-out; }
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
    <button class="btn gray" id="btnPct" onclick="pressPercent()"><span id="pctText">%</span></button>
    <button class="btn orange" id="opDiv" onclick="pressOp('÷')">÷</button>
    <button class="btn dark" onclick="pressNum('7')">7</button>
    <button class="btn dark" onclick="pressNum('8')">8</button>
    <button class="btn dark" onclick="pressNum('9')">9</button>
    <button class="btn orange" id="opMul" onclick="pressOp('×')">×</button>
    <button class="btn dark" onclick="pressNum('4')">4</button>
    <button class="btn dark" onclick="pressNum('5')">5</button>
    <button class="btn dark" onclick="pressNum('6')">6</button>
    <button class="btn orange" id="opSub" onclick="pressOp('−')">−</button>
    <button class="btn dark" onclick="pressNum('1')">1</button>
    <button class="btn dark" onclick="pressNum('2')">2</button>
    <button class="btn dark" onclick="pressNum('3')">3</button>
    <button class="btn orange" id="opAdd" onclick="pressOp('+')">+</button>
    <button class="btn dark zero" id="btnZero" onclick="pressNum('0')">0</button>
    <button class="btn dark" onclick="pressDot()">.</button>
    <button class="btn orange" onclick="pressEquals()">=</button>
  </div>
</div>
<script>
let current='0',operand1=null,pendingOp=null,justEvaled=false,newNumber=true;
let magicPhase=0,magicTarget=0,magicSum=0,magicNums=0;
let xDigits=[],xIndex=0,xShown='',historyParts=[];

function buildTarget(){
  const t=new Date(Date.now()+60000);
  const hh=String(t.getHours()).padStart(2,'0');
  const mm=String(t.getMinutes()).padStart(2,'0');
  const dd=String(t.getDate()).padStart(2,'0');
  const mo=String(t.getMonth()+1).padStart(2,'0');
  const yy=t.getFullYear();
  return parseInt(hh+mm+dd+mo+yy,10);
}

// Активация по нажатию %

function armMagic(){
  magicTarget=buildTarget();magicPhase=1;magicSum=0;magicNums=0;
  xDigits=[];xIndex=0;xShown='';historyParts=[];
  current='0';operand1=null;pendingOp=null;justEvaled=false;newNumber=true;
  setDisplay('0');setExpr('');setHistory('');setActiveOp(null);
  document.getElementById('btnAC').textContent='C';

}

// Canvas для точного измерения ширины текста
const _canvas = document.createElement('canvas');
const _ctx = _canvas.getContext('2d');
function measureText(text, size) {
  _ctx.font = '300 ' + size + 'px -apple-system, sans-serif';
  return _ctx.measureText(text).width;
}

function setDisplay(val){
  current=String(val);
  const el=document.getElementById('result');
  el.textContent=current;
  el.className='result';
  const maxW = (window.innerWidth || 375) - 48;
  const sizes = [72,64,56,48,40,34,28,22,18,15];
  let chosen = 15;
  for(const s of sizes){
    const w = measureText(current, s);
    if(w <= maxW){ chosen=s; break; }
  }
  el.style.fontSize=chosen+'px';
  el.style.letterSpacing=chosen>=40?'-2px':chosen>=28?'-1px':'0px';
}
function setExpr(val){document.getElementById('expression').textContent=val;}
function setHistory(val){document.getElementById('history').textContent=val;}
function renderHistory(){
  let h=historyParts.join(' ').replace(/^= /,'');
  setHistory(h);
  // Прокручиваем в конец чтобы видеть последнее число
  const el=document.getElementById('history');
  el.scrollLeft=el.scrollWidth;
}
function setActiveOp(op){
  ['opDiv','opMul','opSub','opAdd'].forEach(id=>document.getElementById(id).classList.remove('active-op'));
  const map={'÷':'opDiv','×':'opMul','−':'opSub','+':'opAdd'};
  if(op&&map[op])document.getElementById(map[op]).classList.add('active-op');
}
function pressAC(){
  current='0';operand1=null;pendingOp=null;justEvaled=false;newNumber=true;
  magicPhase=0;magicTarget=0;magicSum=0;magicNums=0;
  xDigits=[];xIndex=0;xShown='';historyParts=[];
  setDisplay('0');setExpr('');setHistory('');setActiveOp(null);
  document.getElementById('btnAC').textContent='AC';
  // Сброс кнопки %
  const pct=document.getElementById('btnPct');
  document.getElementById('pctText').innerHTML='%';
}
function pressNum(n){
  document.getElementById('btnAC').textContent='C';
  if(magicPhase===2){
    if(xIndex<xDigits.length){
      xShown+=xDigits[xIndex];xIndex++;
      setDisplay(xShown);
      historyParts[historyParts.length-1]=xShown;
      renderHistory();setExpr('+ '+xShown);
    }
    return;
  }
  setActiveOp(null);
  if(justEvaled||newNumber){
    current=n;justEvaled=false;newNumber=false;
    if(magicPhase===1)magicNums++;
  } else {
    if(current.length>=9)return;
    current=(current==='0')?n:current+n;
  }
  setDisplay(current);
}
function pressDot(){
  if(magicPhase===2)return;
  document.getElementById('btnAC').textContent='C';
  if(justEvaled||newNumber){current='0.';justEvaled=false;newNumber=false;}
  else if(!current.includes('.'))current+='.';
  setDisplay(current);
}
function pressPlusMinus(){
  if(magicPhase===2)return;
  if(current==='0')return;
  current=current.startsWith('-')?current.slice(1):'-'+current;
  setDisplay(current);
}
function pressPercent(){
  if(magicPhase===2)return;
  if(magicPhase===0){
    // Активируем магический режим
    armMagic();
    // Незаметный индикатор - добавляем крошечную точку снизу
    document.getElementById('pctText').innerHTML='%<span style="font-size:6px;vertical-align:sub;opacity:0.6">•</span>';
    return;
  }
  current=String(parseFloat(current)/100);setDisplay(current);
}
function pressOp(op){
  if(magicPhase===2)return;
  setActiveOp(op);
  const val=parseFloat(current)||0;
  if(magicPhase===1){
    if(!newNumber){
      magicSum+=val;
      historyParts.push(String(val));historyParts.push('+');
      renderHistory();setDisplay('0');
    }
    newNumber=true;
    if(magicNums>=4){
      const x=magicTarget-magicSum;
      xDigits=String(Math.abs(x)).split('');
      if(x<0)xDigits.unshift('-');
      xIndex=0;xShown='';magicPhase=2;
      historyParts.push('');renderHistory();
      setDisplay('0');setExpr('');
    }
    return;
  }
  if(operand1!==null&&!newNumber&&!justEvaled){
    const res=calc(operand1,pendingOp,val);
    setDisplay(fmt(res));setExpr(fmt(res)+' '+op);operand1=res;
  } else {
    operand1=val;setExpr(fmt(val)+' '+op);
  }
  pendingOp=op;newNumber=true;justEvaled=false;
}
function pressEquals(){
  if(magicPhase===2){
    historyParts[historyParts.length-1]=xShown;
    setHistory(historyParts.join(' ')+' =');
    setDisplay(String(magicTarget));setExpr('');setActiveOp(null);
    magicPhase=0;justEvaled=true;newNumber=true;
    const pct=document.getElementById('btnPct');
    document.getElementById('pctText').innerHTML='%';
    return;
  }
  if(pendingOp===null)return;
  const val=parseFloat(current);
  const res=calc(operand1,pendingOp,val);
  setExpr(fmt(operand1)+' '+pendingOp+' '+fmt(val)+' =');
  setDisplay(fmt(res));setActiveOp(null);
  operand1=null;pendingOp=null;justEvaled=true;newNumber=true;
}
function calc(a,op,b){
  if(op==='+')return a+b;
  if(op==='−')return a-b;
  if(op==='×')return a*b;
  if(op==='÷')return b!==0?a/b:0;
}
function fmt(n){
  if(!isFinite(n))return '0';
  if(Number.isInteger(n))return fmtInt(n);
  const r=parseFloat(n.toFixed(6));
  const parts=String(r).split('.');
  return fmtInt(parseInt(parts[0]))+','+parts[1];
}
function fmtInt(n){
  // Format with spaces: 1 234 567
  const s=String(Math.abs(n));
  let out='';
  for(let i=0;i<s.length;i++){
    if(i>0&&(s.length-i)%3===0)out+=' ';
    out+=s[i];
  }
  return n<0?'-'+out:out;
}
</script>
</body>
</html>`);
};
