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
    const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAE70lEQVR4nO2cW27bQBAE5SAXNHyLHCi3MHxE50OIIUjs5eyTQ3bVr6Ft77o4kgWy376/v28AW/w6+heAvCAHSJADJMgBEuQACXKABDlAghwgQQ6QIAdIkAMkyAES5AAJcoAEOUCCHCBBDpAgB0iQAyTIARLkAAlygOT3qIU+Pz/Vjz4+PkalkL7B3zf5oz9dz528dT63UjiXV4aflHN6yYlXmixpl6PqaB4ZckzO6XVaPFKpSONnjubT6Xwt6e1m1L+2enIM2N5/Gi4j5/QuLZ6IjZC6yTHwdBpWc04faUZ4tQo5xp5O7ZrO6YPNCK8ZlWPG6cRXdk6fYkZsZb4EA0lIjnmXTmR95/SJYyOw/r4cs0+nnOKcPt2MvRTeVkCyI8eaS0dlOacvGhvFLCYHSJADJCU5Vs7V10Tn9KXvKTqRyQES5AAJcoAEOUCCHCBBDpAgB0iQAyQlOVY8c6ETndM7nzdpYSuRyQES5ADJjhwrp+trlnP60ncWkcXkAMm+HGsuIJXinL5oeOiU0OSYfUbl9Z3Tp/tRXJ+3FZBE5Zh3AUVWdk6fODz2Vq6YHDPOKL6mc/oUPwJr1r2tjD2j2tWc0wf7EVutsbyl8xbLzoN2Tu+9vbRGssYPpD077L8EndO7Rkjla+kEO2t66k6wJ5z7/GgTBDv4EgwkyAGSYQ3G7+/v6kdfX1+jUkjfIO1njsK5vDL8pJzTU/+3UnU0jww5Juf07A3GzafT+VrSUzcYD9jefxouI+f07A3GA0+nYTXn9OwNxmNPp3ZN5/TsDcYzTie+snM6DcaQkZAc8y6dyPrO6dkbjGefTjnFOZ0GY8jLjhxrLh2V5ZxOgzGkBjlAUpJj5Vx9TXROp8EYsoMcIEEOkCAHSJADJMgBEuQACXKApCTHimcudKJzOg3GkB3kAMmOHCun62uWczoNxpCafTnWXEAqxTn9HA3Gs8+ovL5zOg3GkJSoHPMuoMjKzunnaDCecUbxNZ3Tz9FgPPaMaldzTj9Tg3HnLZadB+2cfoIG454d9l+CzulnajB2buWiEyyKc58fbYJgB1+CgQQ5QEKD8enT837mcP5/gf9WJM4dwjQYl3DuEKbBWOLcIUyDcQnnDmEajEs4dwjTYFzCuUOYBmOAZ2gwTp1Og3EpxTmdBmPICw3GSdNpMIbUIAdIaDDOmE6DMWQHOUCCHCBBDpAgB0iQAyTIARLkAAkNxhnTaTCG7CAHSGgwTppOgzGkhgbjvOk0GO+v75xOgzEkpeJZ2fX3vywgOBgm7T06libd+5O8wfhYaDAuc2SD8bHQYLxLS3nLBd5fev7SPg3GdXJcQItHav9O9HNILmbGrXJH9HNIrmfGneC+6OeQXNWMO7u7o58D4JksFQzHUtgj/RwSBzPubO6Ufg6AbXI9SH0sT/uln4PJARLkAImUw+095c7PrunnuDE5oABygAQ5QIIcIEEOkCAHSJADJMgBEinHlW40j/Oza/o5bkwOKIAcIMlV+3QsT/uln4PJAZJEzT7HsrlT+jl2cPCjsEf6OQA2SNHscyy7u5u3/dDK84bHqH6Oq/oR3Bf9HDtcz4+qHdHPEeICt5fSzxGh5QPp2UdI5+/f8/IBR9czQipf2zI5fjjdCBmrddX2x19RVSOkSakuOX5IbsnsUVfY/oopW7Ck75PKGDngkvAlGEj+AfxOpspFcA1qAAAAAElFTkSuQmCC', 'base64');
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
