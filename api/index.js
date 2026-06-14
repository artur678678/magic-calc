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

  if (path === '/admin') {
    if (req.method === 'POST') {
      let body = '';
      await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
      const pass = new URLSearchParams(body).get('password');
      if (pass !== ADMIN_PASSWORD) {
        return res.end(html(`<div class="box"><h2>🔐 Неверный пароль</h2><a href="/admin">← Назад</a></div>`));
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

  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => { const [k,...v]=c.trim().split('='); return [k,v.join('=')]; })
  );
  const isAdmin = cookies['admin_session'] === ADMIN_PASSWORD;

  if (path === '/admin/dashboard') {
    if (!isAdmin) { res.setHeader('Location', '/admin'); res.statusCode = 302; return res.end(); }
    const clients = await getClients();
    const rows = Object.entries(clients).map(([token, c]) => {
      const link = `https://${req.headers.host}/?token=${token}`;
      const status = c.active ? `<span class="badge-ok">✅ активна</span>` : `<span class="badge-off">🚫 отозвана</span>`;
      const lastSeen = c.lastSeen ? new Date(c.lastSeen).toLocaleString('ru') : 'не открывали';
      const device = c.deviceInfo
        ? `<br><span style="color:#636366;font-size:10px">${c.deviceInfo.slice(0,50)}...</span>`
        : '<br><span style="color:#636366;font-size:10px">не открывали</span>';
      return `<tr>
        <td>${c.name}</td>
        <td><code style="font-size:11px">${token}</code>
          <span class="copy" onclick="navigator.clipboard.writeText('${link}');this.textContent='✓'">📋</span>
        </td>
        <td>${c.visits}</td>
        <td>${lastSeen}${device}</td>
        <td>${status}</td>
        <td>
          <form method="POST" action="/admin/toggle" style="display:inline">
            <input type="hidden" name="token" value="${token}">
            <button class="${c.active ? 'btn-small btn-red' : 'btn-small'}">${c.active ? 'Отозвать' : 'Включить'}</button>
          </form>
          <form method="POST" action="/admin/reset" style="display:inline;margin-left:4px">
            <input type="hidden" name="token" value="${token}">
            <button class="btn-small" title="Сбросить привязку устройства">📱 Сброс</button>
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

  // ── ADMIN: сброс fingerprint ─────────────────────────────────────────────
  if (path === '/admin/reset' && req.method === 'POST') {
    if (!isAdmin) { res.statusCode = 403; return res.end(); }
    let body = '';
    await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
    const token = new URLSearchParams(body).get('token');
    const clients = await getClients();
    if (clients[token]) {
      delete clients[token].fingerprint;
      delete clients[token].deviceInfo;
    }
    await saveClients(clients);
    res.setHeader('Location', '/admin/dashboard');
    res.statusCode = 302;
    return res.end();
  }

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

  if (path === '/manifest.json') {
    const t = url.searchParams.get('token');
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      name: 'Калькулятор', short_name: 'Калькулятор',
      start_url: '/?token=' + t,
      display: 'standalone',
      background_color: '#000000', theme_color: '#000000',
      icons: [{ src: '/apple-icon.png', sizes: '192x192', type: 'image/png' }]
    }));
  }

  if (path === '/icon.png' || path === '/apple-icon.png') {
    const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAAwGUlEQVR4nO29eZwkV3Xv+T33RkRm1tq1dKv3prWvICTbDzwjQDaSsYWMrMHMB3vAfDBmLEASwyIM8uMhGeM3MFiAAQ9g4I0x6zOrnkEMMPOe4I0FCFmgXS11a+2teqm9MjPi3jN/3IjsrOrqVi+l7s7o/PWnPl2VVRlxM/IXJ889y+/I2rXrlS66KAnM8V5AF10sJbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFaLjvYBnA7fc8mF27tzB3r17aTabNJtNvPfHe1nHDaoQxzFxHFGpVFm+fJSVK1dyzTVvOd5LW3JIWWQM3vnO/40vfOGLbN++g0ajjoi0SOy9P8kJrRhjMSZckyiKsNaSJBXOOut0Xv3qV/Pe9958vJe5JOh4Qv/lX/4Fn/zkJ3nwwQfp7x9ERLDWEEUxIgKAiLS+P1mhqqjue6uzLCPLMrzPmJmZ5cILL+SGG97J9de//Tiu8ujR0YT+/d//PT73uc/T19dLT08v3ivW2v3ePGC/nwuCL3y8jGi/mYtrY63Nf/ZYaxkbGyOKIt761uv57Gf/r+O11KNGx24KL7/8pXzyk/8nK1euolbrw/tATOcc3vt5pG4nbftjZSNz8Um08Av2vd7gfhhUNb9WinOeFStW0tvbx003/RWvfe3/cpxfyZGjIwn9+tf/ms997nOcdtqp+cemQ1UXtUQFuQsYY0rrfrSTduFXARGZR2xrLc450rRJHMesW7eOW265hfe/vzN96o50OZxLAUiStLXheyaSHsjlONlRELu4hlEUMT4+zsaNGxkb2338l3fY6DgL/bKXvZRdu3ZRrVbJsqxlmZ/JfSgs82Ifxycz2q+dMYZms8nw8DD/9m//xhvf+IbjvLrDR8dZ6EZjlmq11rIo7T7hQrcDFt/0LfZ3ZUbxWr33rRu7fS9hrW25ZsXfNptN1q9fx/btY8dt3UeCjkqs3Hjju7j22utZtarWuvDGGJxzGGNaxBYRnNvnV0dRRBRFrb9pR9k2hgtRXItms9n6Poqi/X6/8AavVCrcd9/9fO1rX+Oaa958rJd9xOgoQt9999309vbMe6yw0O3fFwRfvnw5q1evJkkS4OT2m733NJtNnnjiCfbs2bOfpYb9r08URTz88MPHeqlHhY4i9GOPPUYU2QP+vohqWGs766yzGBkZodFozHNPTlaICEmScP755/Pkk0/y+OOPt278A93o1lqefPLJY7zSo0NHbQrHxoI/d6A3oCDtxo0bGRoaYmZmpkXwkx1F6n92dpZ169ZxyimnHNJeYtu27cdieUuGjiJ0o9HgYEbWOUdPTw8jIyPU6/WWq3Ey13FAuNGL/YOIMDc3x5o1a6hUKjjnDvIcYWpq8hiv9ujQUYSem2twMIMiIvT29hJFESJClmWtjeLJjMIVa7+xkyRp3fAHgohhZmbm2V7ekqKjfGiRZ05X9/T0zEu0tG8aT1a0x5kLYltrqVarTE9PH/Q5nYaOIjQIB/tQKXzConS0a533obgm7ZGg4pPsYH/faego03Uom5g4judlD0/mUN1iaL8u7fHoA6HTDEJHEfpQ0K3ZOHR0GlkPBR3mchw6ukQ+OVEqC13GGucuDg+lIvRi6BL85ELpCQ1dUp9MKBWhF7YcLXysi/KjVITuoosuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFaLjvYBnA7fc8mF27tzB3r17aTabNJtNvPfHe1nHDaoQxzFxHFGpVFm+fJSVK1dyzTVvOd5LW3JIWWQM3vnO/40vfOGLbN++g0ajjoi0SOy9P8kJrRhjMSZckyiKsNaSJBXOOut0Xv3qV/Pe9958vJe5JOh4Qv/lX/4Fn/zkJ3nwwQfp7x9ERLDWEEUxIgKAiLS+P1mhqqjue6uzLCPLMrzPmJmZ5cILL+SGG97J9de//Tiu8ujR0YT+/d//PT73uc/T19dLT08v3ivW2v3ePGC/nwuCL3y8jGi/mYtrY63Nf/ZYaxkbGyOKIt761uv57Gf/r+O11KNGx24KL7/8pXzyk/8nK1euolbrw/tATOcc3vt5pG4nbftjZSNz8Um08Av2vd7gfhhUNb9WinOeFStW0tvbx003/RWvfe3/cpxfyZGjIwn9+tf/ms997nOcdtqp+cemQ1UXtUQFuQsYY0rrfrSTduFXARGZR2xrLc450rRJHMesW7eOW265hfe/vzN96o50OZxLAUiStLXheyaSHsjlONlRELu4hlEUMT4+zsaNGxkb2338l3fY6DgL/bKXvZRdu3ZRrVbJsqxlmZ/JfSgs82Ifxycz2q+dMYZms8nw8DD/9m//xhvf+IbjvLrDR8dZ6EZjlmq11rIo7T7hQrcDFt/0LfZ3ZUbxWr33rRu7fS9hrW25ZsXfNptN1q9fx/btY8dt3UeCjkqs3Hjju7j22utZtarWuvDGGJxzGGNaxBYRnNvnV0dRRBRFrb9pR9k2hgtRXItms9n6Poqi/X6/8AavVCrcd9/9fO1rX+Oaa958rJd9xOgoQt9999309vbMe6yw0O3fFwRfvnw5q1evJkkS4OT2m733NJtNnnjiCfbs2bOfpYb9r08URTz88MPHeqlHhY4i9GOPPUYU2QP+vohqWGs766yzGBkZodFozHNPTlaICEmScP755/Pkk0/y+OOPt278A93o1lqefPLJY7zSo0NHbQrHxoI/d6A3oCDtxo0bGRoaYmZmpkXwkx1F6n92dpZ169ZxyimnHNJeYtu27cdieUuGjiJ0o9HgYEbWOUdPTw8jIyPU6/WWq3Ey13FAuNGL/YOIMDc3x5o1a6hUKjjnDvIcYWpq8hiv9ujQUYSem2twMIMiIvT29hJFESJClmWtjeLJjMIVa7+xkyRp3fAHgohhZmbm2V7ekqKjfGiRZ05X9/T0zEv0tG8aT1a0x5kLYltrqVarTE9PH/Q5nYaOIjQIB/tQKXzConS0a533obgm7ZGg4pPsYH/faego03Uom5g4judlD0/mUN1iaL8u7fHoA6HTDEJHEfpQ0K3ZOHR0GlkPBR3mchw6ukQ+OVEqC13GGucuDg+lIvRi6BL85ELpCQ1dUp9MKBWhF7YcLXysi/KjVITuoosuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFaLjvYBnA7fc8mF27tzB3r17aTabNJtNvPfHe1nHDaoQxzFxHFGpVFm+fJSVK1dyzTVvOd5LW3JIWWQM3vnO/40vfOGLbN++g0ajjoi0SOy9P8kJrRhjMSZckyiKsNaSJBXOOut0Xv3qV/Pe9958vJe5JOh4Qv/lX/4Fn/zkJ3nwwQfp7x9ERLDWEEUxIgKAiLS+P1mhqqjue6uzLCPLMrzPmJmZ5cILL+SGG97J9de//Tiu8ujR0YT+/d//PT73uc/T19dLT08v3ivW2v3ePGC/nwuCL3y8jGi/mYtrY63Nf/ZYaxkbGyOKIt761uv57Gf/r+O11KNGx24KL7/8pXzyk/8nK1euolbrw/tATOcc3vt5pG4nbftjZSNz8Um08Av2vd7gfhhUNb9WinOeFStW0tvbx003/RWvfe3/cpxfyZGjIwn9+tf/ms997nOcdtqp+cemQ1UXtUQFuQsYY0rrfrSTduFXARGZR2xrLc450rRJHMesW7eOW265hfe/vzN96o50OZxLAUiStLXheyaSHsjlONlRELu4hlEUMT4+zsaNGxkb2338l3fY6DgL/bKXvZRdu3ZRrVbJsqxlmZ/JfSgs82Ifxycz2q+dMYZms8nw8DD/9m//xhvf+IbjvLrDR8dZ6EZjlmq11rIo7T7hQrcDFt/0LfZ3ZUbxWr33rRu7fS9hrW25ZsXfNptN1q9fx/btY8dt3UeCjkqs3Hjju7j22utZtarWuvDGGJxzGGNaxBYRnNvnV0dRRBRFrb9pR9k2hgtRXItms9n6Poqi/X6/8AavVCrcd9/9fO1rX+Oaa958rJd9xOgoQt9999309vbMe6yw0O3fFwRfvnw5q1evJkkS4OT2m733NJtNnnjiCfbs2bOfpYb9r08URTz88MPHeqlHhY4i9GOPPUYU2QP+vohqWGs766yzGBkZodFozHNPTlaICEmScP755/Pkk0/y+OOPt278A93o1lqefPLJY7zSo0NHbQrHxoI/d6A3oCDtxo0bGRoaYmZmpkXwkx1F6n92dpZ169ZxyimnHNJeYtu27cdieUuGjiJ0o9HgYEbWOUdPTw8jIyPU6/WWq3Ey13FAuNGL/YOIMDc3x5o1a6hUKjjnDvIcYWpq8hiv9ujQUYSem2twMIMiIvT29hJFESJClmWtjeLJjMIVa7+xkyRp3fAHgohhZmbm2V7ekqKjfGiRZ05X9/T0zEv0tG8aT1a0x5kLYltrqVarTE9PH/Q5nYaOIjQIB/tQKXzConS0a533obgm7ZGg4pPsYH/faego03Uom5g4judlD0/mUN1iaL8u7fHoA6HTDEJHEfpQ0K3ZOHR0GlkPBR3mchw6ukQ+OVEqC13GGucuDg+lIvRi6BL85ELpCQ1dUp9MKBWhF7YcLXysi/KjVITuoosuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFaLjvYBnA7fc8mF27tzB3r17aTabNJtNvPfHe1nHDaoQxzFxHFGpVFm+fJSVK1dyzTVvOd5LW3JIWWQM3vnO/40vfOGLbN++g0ajjoi0SOy9P8kJrRhjMSZckyiKsNaSJBXOOut0Xv3qV/Pe9958vJe5JOh4Qv/lX/4Fn/zkJ3nwwQfp7x9ERLDWEEUxIgKAiLS+P1mhqqjue6uzLCPLMrzPmJmZ5cILL+SGG97J9de//Tiu8ujR0YT+/d//PT73uc/T19dLT08v3ivW2v3ePGC/nwuCL3y8jGi/mYtrY63Nf/ZYaxkbGyOKIt761uv57Gf/r+O11KNGx24KL7/8pXzyk/8nK1euolbrw/tATOcc3vt5pG4nbftjZSNz8Um08Av2vd7gfhhUNb9WinOeFStW0tvbx003/RWvfe3/cpxfyZGjIwn9+tf/ms997nOcdtqp+cemQ1UXtUQFuQsYY0rrfrSTduFXARGZR2xrLc450rRJHMesW7eOW265hfe/vzN96o50OZxLAUiStLXheyaSHsjlONlRELu4hlEUMT4+zsaNGxkb2338l3fY6DgL/bKXvZRdu3ZRrVbJsqxlmZ/JfSgs82Ifxycz2q+dMYZms8nw8DD/9m//xhvf+IbjvLrDR8dZ6EZjlmq11rIo7T7hQrcDFt/0LfZ3ZUbxWr33rRu7fS9hrW25ZsXfNptN1q9fx/btY8dt3UeCjkqs3Hjju7j22utZtarWuvDGGJxzGGNaxBYRnNvnV0dRRBRFrb9pR9k2hgtRXItms9n6Poqi/X6/8AavVCrcd9/9fO1rX+Oaa958rJd9xOgoQt9999309vbMe6yw0O3fFwRfvnw5q1evJkkS4OT2m733NJtNnnjiCfbs2bOfpYb9r08URTz88MPHeqlHhY4i9GOPPUYU2QP+vohqWGs766yzGBkZodFozHNPTlaICEmScP755/Pkk0/y+OOPt278A93o1lqefPLJY7zSo0NHbQrHxoI/d6A3oCDtxo0bGRoaYmZmpkXwkx1F6n92dpZ169ZxyimnHNJeYtu27cdieUuGjiJ0o9HgYEbWOUdPTw8jIyPU6/WWq3Ey13FAuNGL/YOIMDc3x5o1a6hUKjjnDvIcYWpq8hiv9ujQUYSem2twMIMiIvT29hJFESJClmWtjeLJjMIVa7+xkyRp3fAHgohhZmbm2V7ekqKjfGiRZ05X9/T0zEv0tG8aT1a0x5kLYltrqVarTE9PH/Q5nYaOIjQIB/tQKXzConS0a533obgm7ZGg4pPsYH/faego03Uom5g4judlD0/mUN1iaL8u7fHoA6HTDEJHEfpQ0K3ZOHR0GlkPBR3mchw6ukQ+OVEqC13GGucuDg+lIvRi6BL85ELpCQ1dUp9MKBWhF7YcLXysi/KjVITuoosuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFaLjvYBnA7fc8mF27tzB3r17aTabNJtNvPfHe1nHDaoQxzFxHFGpVFm+fJSVK1dyzTVvOd5LW3JIWWQM3vnO/40vfOGLbN++g0ajjoi0SOy9P8kJrRhjMSZckyiKsNaSJBXOOut0Xv3qV/Pe9958vJe5JOh4Qv/lX/4Fn/zkJ3nwwQfp7x9ERLDWEEUxIgKAiLS+P1mhqqjue6uzLCPLMrzPmJmZ5cILL+SGG97J9de//Tiu8ujR0YT+/d//PT73uc/T19dLT08v3ivW2v3ePGC/nwuCL3y8jGi/mYtrY63Nf/ZYaxkbGyOKIt761uv57Gf/r+O11KNGx24KL7/8pXzyk/8nK1euolbrw/tATOcc3vt5pG4nbftjZSNz8Um08Av2vd7gfhhUNb9WinOeFStW0tvbx003/RWvfe3/cpxfyZGjIwn9+tf/ms997nOcdtqp+cemQ1UXtUQFuQsYY0rrfrSTduFXARGZR2xrLc450rRJHMesW7eOW265hfe/vzN96o50OZxLAUiStLXheyaSHsjlONlRELu4hlEUMT4+zsaNGxkb2338l3fY6DgL/bKXvZRdu3ZRrVbJsqxlmZ/JfSgs82Ifxycz2q+dMYZms8nw8DD/9m//xhvf+IbjvLrDR8dZ6EZjlmq11rIo7T7hQrcDFt/0LfZ3ZUbxWr33rRu7fS9hrW25ZsXfNptN1q9fx/btY8dt3UeCjkqs3Hjju7j22utZtarWuvDGGJxzGGNaxBYRnNvnV0dRRBRFrb9pR9k2hgtRXItms9n6Poqi/X6/8AavVCrcd9/9fO1rX+Oaa958rJd9xOgoQt9999309vbMe6yw0O3fFwRfvnw5q1evJkkS4OT2m733NJtNnnjiCfbs2bOfpYb9r08URTz88MPHeqlHhY4i9GOPPUYU2QP+vohqWGs766yzGBkZodFozHNPTlaICEmScP755/Pkk0/y+OOPt278A93o1lqefPLJY7zSo0NHbQrHxoI/d6A3oCDtxo0bGRoaYmZmpkXwkx1F6n92dpZ169ZxyimnHNJeYtu27cdieUuGjiJ0o9HgYEbWOUdPTw8jIyPU6/WWq3Ey13FAuNGL/YOIMDc3x5o1a6hUKjjnDvIcYWpq8hiv9ujQUYSem2twMIMiIvT29hJFESJClmWtjeLJjMIVa7+xkyRp3fAHgohhZmbm2V7ekqKjfGiRZ05X9/T0zEv0tG8aT1a0x5kLYltrqVarTE9PH/Q5nYaOIjQIB/tQKXzConS0a533obgm7ZGg4pPsYH/faego03Uom5g4judlD0/mUN1iaL8u7fHoA6HTDEJHEfpQ0K3ZOHR0GlkPBR3mchw6ukQ+OVEqC13GGucuDg+lIvRi6BL85ELpCQ1dUp9MKBWhF7YcLXysi/KjVITuoosuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFaLjvYBnA7fc8mF27tzB3r17aTabNJtNvPfHe1nHDaoQxzFxHFGpVFm+fJSVK1dyzTVvOd5LW3JIWWQM3vnO/40vfOGLbN++g0ajjoi0SOy9P8kJrRhjMSZckyiKsNaSJBXOOut0Xv3qV/Pe9958vJe5JOh4Qv/lX/4Fn/zkJ3nwwQfp7x9ERLDWEEUxIgKAiLS+P1mhqqjue6uzLCPLMrzPmJmZ5cILL+SGG97J9de//Tiu8ujR0YT+/d//PT73uc/T19dLT08v3ivW2v3ePGC/nwuCL3y8jGi/mYtrY63Nf/ZYaxkbGyOKIt761uv57Gf/r+O11KNGx24KL7/8pXzyk/8nK1euolbrw/tATOcc3vt5pG4nbftjZSNz8Um08Av2vd7gfhhUNb9WinOeFStW0tvbx003/RWvfe3/cpxfyZGjIwn9+tf/ms997nOcdtqp+cemQ1UXtUQFuQsYY0rrfrSTduFXARGZR2xrLc450rRJHMesW7eOW265hfe/vzN96o50OZxLAUiStLXheyaSHsjlONlRELu4hlEUMT4+zsaNGxkb2338l3fY6DgL/bKXvZRdu3ZRrVbJsqxlmZ/JfSgs82Ifxycz2q+dMYZms8nw8DD/9m//xhvf+IbjvLrDR8dZ6EZjlmq11rIo7T7hQrcDFt/0LfZ3ZUbxWr33rRu7fS9hrW25ZsXfNptN1q9fx/btY8dt3UeCjkqs3Hjju7j22utZtarWuvDGGJxzGGNaxBYRnNvnV0dRRBRFrb9pR9k2hgtRXItms9n6Poqi/X6/8AavVCrcd9/9fO1rX+Oaa958rJd9xOgoQt9999309vbMe6yw0O3fFwRfvnw5q1evJkkS4OT2m733NJtNnnjiCfbs2bOfpYb9r08URTz88MPHeqlHhY4i9GOPPUYU2QP+vohqWGs766yzGBkZodFozHNPTlaICEmScP755/Pkk0/y+OOPt278A93o1lqefPLJY7zSo0NHbQrHxoI/d6A3oCDtxo0bGRoaYmZmpkXwkx1F6n92dpZ169ZxyimnHNJeYtu27cdieUuGjiJ0o9HgYEbWOUdPTw8jIyPU6/WWq3Ey13FAuNGL/YOIMDc3x5o1a6hUKjjnDvIcYWpq8hiv9ujQUYSem2twMIMiIvT29hJFESJClmWtjeLJjMIVa7+xkyRp3fAHgohhZmbm2V7ekqKjfGiRZ05X9/T0zEv0tG8aT1a0x5kLYltrqVarTE9PH/Q5nYaOIjQIB/tQKXzConS0a533obgm7ZGg4pPsYH/faego03Uom5g4judlD0/mUN1iaL8u7fHoA6HTDEJHEfpQ0K3ZOHR0GlkPBR3mchw6ukQ+OVEqC13GGucuDg+lIvRi6BL85ELpCQ1dUp9MKBWhF7YcLXysi/KjVITuoosuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFaLjvYBnA7fc8mF27tzB3r17aTabNJtNvPfHe1nHDaoQxzFxHFGpVFm+fJSVK1dyzTVvOd5LW3JIWWQM3vnO/40vfOGLbN++g0ajjoi0SOy9P8kJrRhjMSZckyiKsNaSJBXOOut0Xv3qV/Pe9958vJe5JOh4Qv/lX/4Fn/zkJ3nwwQfp7x9ERLDWEEUxIgKAiLS+P1mhqqjue6uzLCPLMrzPmJmZ5cILL+SGG97J9de//Tiu8ujR0YT+/d//PT73uc/T19dLT08v3ivW2v3ePGC/nwuCL3y8jGi/mYtrY63Nf/ZYaxkbGyOKIt761uv57Gf/r+O11KNGx24KL7/8pXzyk/8nK1euolbrw/tATOcc3vt5pG4nbftjZSNz8Um08Av2vd7gfhhUNb9WinOeFStW0tvbx003/RWvfe3/cpxfyZGjIwn9+tf/ms997nOcdtqp+cemQ1UXtUQFuQsYY0rrfrSTduFXARGZR2xrLc450rRJHMesW7eOW265hfe/vzN96o50OZxLAUiStLXheyaSHsjlONlRELu4hlEUMT4+zsaNGxkb2338l3fY6DgL/bKXvZRdu3ZRrVbJsqxlmZ/JfSgs82Ifxycz2q+dMYZms8nw8DD/9m//xhvf+IbjvLrDR8dZ6EZjlmq11rIo7T7hQrcDFt/0LfZ3ZUbxWr33rRu7fS9hrW25ZsXfNptN1q9fx/btY8dt3UeCjkqs3Hjju7j22utZtarWuvDGGJxzGGNaxBYRnNvnV0dRRBRFrb9pR9k2hgtRXItms9n6Poqi/X6/8AavVCrcd9/9fO1rX+Oaa958rJd9xOgoQt9999309vbMe6yw0O3fFwRfvnw5q1evJkkS4OT2m733NJtNnnjiCfbs2bOfpYb9r08URTz88MPHeqlHhY4i9GOPPUYU2QP+vohqWGs766yzGBkZodFozHNPTlaICEmScP755/Pkk0/y+OOPt278A93o1lqefPLJY7zSo0NHbQrHxoI/d6A3oCDtxo0bGRoaYmZmpkXwkx1F6n92dpZ169ZxyimnHNJeYtu27cdieUuGjiJ0o9HgYEbWOUdPTw8jIyPU6/WWq3Ey13FAuNGL/YOIMDc3x5o1a6hUKjjnDvIcYWpq8hiv9ujQUYSem2twMIMiIvT29hJFESJClmWtjeLJjMIVa7+xkyRp3fAHgohhZmbm2V7ekqKjfGiRZ05X9/T0zEv0tG8aT1a0x5kLYltrqVarTE9PH/Q5nYaOIjQIB/tQKXzConS0a533obgm7ZGg4pPsYH/faego03Uom5g4judlD0/mUN1iaL8u7fHoA6HTDEJHEfpQ0K3ZOHR0GlkPBR3mchw6ukQ+OVEqC13GGucuDg+lIvRi6BL85ELpCQ1dUp9MKBWhF7YcLXysi/KjVITuoosuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFaLjvYBnA7fc8mF27tzB3r17aTabNJtNvPfHe1nHDaoQxzFxHFGpVFm+fJSVK1dyzTVvOd5LW3JIWWQM3vnO/40vfOGLbN++g0ajjoi0SOy9P8kJrRhjMSZckyiKsNaSJBXOOut0Xv3qV/Pe9958vJe5JOh4Qv/lX/4Fn/zkJ3nwwQfp7x9ERLDWEEUxIgKAiLS+P1mhqqjue6uzLCPLMrzPmJmZ5cILL+SGG97J9de//Tiu8ujR0YT+/d//PT73uc/T19dLT08v3ivW2v3ePGC/nwuCL3y8jGi/mYtrY63Nf/ZYaxkbGyOKIt761uv57Gf/r+O11KNGx24KL7/8pXzyk/8nK1euolbrw/tATOcc3vt5pG4nbftjZSNz8Um08Av2vd7gfhhUNb9WinOeFStW0tvbx003/RWvfe3/cpxfyZGjIwn9+tf/ms997nOcdtqp+cemQ1UXtUQFuQsYY0rrfrSTduFXARGZR2xrLc450rRJHMesW7eOW265hfe/vzN96o50OZxLAUiStLXheyaSHsjlONlRELu4hlEUMT4+zsaNGxkb2338l3fY6DgL/bKXvZRdu3ZRrVbJsqxlmZ/JfSgs82Ifxycz2q+dMYZms8nw8DD/9m//xhvf+IbjvLrDR8dZ6EZjlmq11rIo7T7hQrcDFt/0LfZ3ZUbxWr33rRu7fS9hrW25ZsXfNptN1q9fx/btY8dt3UeCjkqs3Hjju7j22utZtarWuvDGGJxzGGNaxBYRnNvnV0dRRBRFrb9pR9k2hgtRXItms9n6Poqi/X6/8AavVCrcd9/9fO1rX+Oaa958rJd9xOgoQt9999309vbMe6yw0O3fFwRfvnw5q1evJkkS4OT2m733NJtNnnjiCfbs2bOfpYb9r08URTz88MPHeqlHhY4i9GOPPUYU2QP+vohqWGs766yzGBkZodFozHNPTlaICEmScP755/Pkk0/y+OOPt278A93o1lqefPLJY7zSo0NHbQrHxoI/d6A3oCDtxo0bGRoaYmZmpkXwkx1F6n92dpZ169ZxyimnHNJeYtu27cdieUuGjiJ0o9HgYEbWOUdPTw8jIyPU6/WWq3Ey13FAuNGL/YOIMDc3x5o1a6hUKjjnDvIcYWpq8hiv9ujQUYSem2twMIMiIvT29hJFESJClmWtjeLJjMIVa7+xkyRp3fAHgohhZmbm2V7ekqKjfGiRZ05X9/T0zEv0tG8aT1a0x5kLYltrqVarTE9PH/Q5nYaOIjQIB/tQKXzConS0a533obgm7ZGg4pPsYH/faego03Uom5g4judlD0/mUN1iaL8u7fHoA6HTDEJHEfpQ0K3ZOHR0GlkPBR3mchw6ukQ+OVEqC13GGucuDg+lIvRi6BL85ELpCQ1dUp9MKBWhF7YcLXysi/KjVITuoosuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6i1KhS+guSoUuobsoFbqE7qJU6BK6', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(buf);
  }

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

  // ── Fingerprint устройства ──────────────────────────────────────────────
  const ua = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '';
  const fingerprint = Buffer.from(ua + '|' + ip).toString('base64').slice(0, 32);

  if (clients[token].fingerprint) {
    // Устройство уже зафиксировано — проверяем
    if (clients[token].fingerprint !== fingerprint) {
      res.statusCode = 403;
      return res.end(html(`<div class="box" style="text-align:center">
        <div style="font-size:48px;margin-bottom:16px">🔒</div>
        <h2>Доступ с этого устройства запрещён</h2>
        <p style="color:#636366">Эта ссылка уже привязана к другому устройству</p>
      </div>`));
    }
  } else {
    // Первое открытие — фиксируем устройство
    clients[token].fingerprint = fingerprint;
    clients[token].deviceInfo = ua.slice(0, 100);
  }

  clients[token].visits++;
  clients[token].lastSeen = Date.now();
  await saveClients(clients);

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
    padding:0 24px 20px 24px; text-align:right;
    display:flex; flex-direction:column; justify-content:flex-end; flex:1;
  }
  .history { font-size:17px; color:#636366; margin-bottom:0;
    white-space:nowrap; overflow-x:auto; text-align:right;
    scrollbar-width:none; -ms-overflow-style:none; line-height:1.3; }
  .history::-webkit-scrollbar { display:none; }
  .expression { display:none; }
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
let current='0', op1=null, pendOp=null, fresh=true, historyParts=[];
let mPhase=0, mTarget=0, mRes1=0, mRes2=0;
let xDigits=[], xIdx=0, xShown='';

function buildTarget(){
  const t=new Date(Date.now()+60000);
  const p=n=>String(n).padStart(2,'0');
  const yy=String(t.getFullYear()).slice(-2);
  return parseInt(p(t.getHours())+p(t.getMinutes())+p(t.getDate())+p(t.getMonth()+1)+yy,10);
}

function showDot(n){
  clearDots();
  const el=document.getElementById('key'+n);
  if(!el)return;
  const dot=document.createElement('span');
  dot.id='keydot'+n;
  dot.style.cssText='position:absolute;bottom:6px;left:50%;transform:translateX(-50%);'+
    'width:2px;height:2px;border-radius:50%;background:rgba(255,255,255,0.35);pointer-events:none;';
  el.style.position='relative';
  el.appendChild(dot);
}
function clearDots(){for(let i=0;i<=9;i++){const d=document.getElementById('keydot'+i);if(d)d.remove();}}

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

function pressAC(){
  current='0';op1=null;pendOp=null;fresh=true;
  mPhase=0;mTarget=0;mRes1=0;mRes2=0;
  xDigits=[];xIdx=0;xShown='';historyParts=[];
  setDisplay('0');setExpr('');setHistory('');setActiveOp(null);
  document.getElementById('btnAC').textContent='AC';
  document.getElementById('pctText').innerHTML='%';
  clearDots();
}

function pressPercent(){
  if(mPhase>0)return;
  pressAC();
  mTarget=buildTarget();
  mPhase=1;
  document.getElementById('pctText').innerHTML='%<span style="font-size:6px;vertical-align:sub;opacity:0.6">•</span>';
}

function pressNum(n){
  document.getElementById('btnAC').textContent='C';
  if(mPhase===5){
    if(xIdx<xDigits.length){
      xShown+=xDigits[xIdx];xIdx++;
      setDisplay(fmtInt(parseInt(xShown)));
      historyParts[historyParts.length-1]=fmtInt(parseInt(xShown));
      renderHistory();
    }
    return;
  }
  setActiveOp(null);
  if(fresh){current=n;fresh=false;}
  else{if(current.replace('.','').length>=9)return;current=(current==='0')?n:current+n;}
  // Показываем с пробелами если целое
  const num=parseFloat(current);
  if(!current.includes('.')&&!current.includes('-')){
    setDisplay(fmtInt(parseInt(current)));
  } else {
    setDisplay(current);
  }
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

function pressOp(op){
  if(mPhase===5)return;
  setActiveOp(op);
  const val=parseFloat(current)||0;

  if(mPhase===2&&op==='+'){
    pendOp='+';fresh=true;
    historyParts=[fmt(mRes1)+' +'];
    renderHistory();
    mPhase=3;
    return;
  }
  if(mPhase===4&&op==='+'){
    const x=mTarget-mRes2;
    xDigits=String(Math.abs(x)).split('');
    if(x<0)xDigits.unshift('-');
    xIdx=0;xShown='';
    const dc=Math.min(xDigits.filter(d=>d!=='-').length,9);
    showDot(dc);
    mPhase=5;fresh=true;
    historyParts=[fmt(mRes1)+' + '+fmt(mRes2-mRes1)+' = '+fmt(mRes2)+' +'];
    renderHistory();
    return;
  }

  if(op1!==null&&!fresh){
    const res=doCalc(op1,pendOp,val);
    setDisplay(fmt(res));
    historyParts=[fmt(res)+' '+op];
    renderHistory();
    op1=res;
  } else {
    op1=val;
    historyParts=[fmt(val)+' '+op];
    renderHistory();
  }
  pendOp=op;fresh=true;
}

function pressEquals(){
  if(mPhase===5){
    historyParts[historyParts.length-1]=xShown;
    setHistory(historyParts.join(' ')+' =');
    setDisplay(fmtInt(mTarget));setExpr('');setActiveOp(null);
    mPhase=0;fresh=true;
    document.getElementById('pctText').innerHTML='%';
    clearDots();
    return;
  }
  if(pendOp===null)return;
  const val=parseFloat(current);

  if(mPhase===1){
    const res=doCalc(op1,pendOp,val);
    historyParts=[fmt(op1)+' '+pendOp+' '+fmt(val)+' ='];
    renderHistory();
    setDisplay(fmt(res));setActiveOp(null);
    mRes1=res;mPhase=2;op1=res;pendOp=null;fresh=true;
    return;
  }
  if(mPhase===3){
    const res=mRes1+val;
    setDisplay(fmt(res));setActiveOp(null);
    mRes2=res;mPhase=4;op1=res;pendOp=null;fresh=true;
    historyParts=[fmt(mRes1)+' + '+fmt(val)+' ='];
    renderHistory();
    return;
  }

  const res=doCalc(op1,pendOp,val);
  historyParts=[fmt(op1)+' '+pendOp+' '+fmt(val)+' ='];
  renderHistory();
  setDisplay(fmt(res));setActiveOp(null);
  op1=null;pendOp=null;fresh=true;
}

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
