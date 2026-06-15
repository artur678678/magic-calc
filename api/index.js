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
      delete clients[token].deviceCookie;
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
    const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAoo0lEQVR4nO19abRV1ZXunGutvc8+/W1ABKSVRgoCdohNIiYCJsE8o5VGn5rERB1SsUlVWY4kIxorib4K8VW9WCMCT1OJGWWSZxqNGUTERKJElItKQESBKJ2AF253+t2tNd+Pdc/hipxzGzh3H2V/4/64A/bda+29v7XWXHPN+U3csmUzhAhxNLCgOxCicRGSI0RVhOQIURUhOUJURUiOEFURkiNEVYTkCFEVITlCVEVIjhBVEZIjRFWE5AhRFSE5QlSFCLoDh0FEQXchSCBi0F04EsGQg8oAAMYQkWEZgfQncOhXQX0AAIjIWJBT+3CTQykFAKZpmGaEc66U8n3f933P85RSRKQUAZxYU4gmASJyzg3DMAxDCAGAnuc6juP7vv7f4e/Y8JFDKYWIiUQCAN55553t27dv27Z9//79XV3duVzOcRzP86SUUsoTjBzIGDLGhRCGIaLRWFNT08iRIydNmjR9+rTJkyc1NzeXSiXHcYZ/FhkmckgpE4mE7/t//vOfV61atWnT5s7OLs9zEVkFlcFxAi4uSim9sACA7/t6IEWj0YkTJ15wwfmf+MTHp06dWigUPM9ljA9br7DekWB6+UylUuvXr3/wwQdfeeUVKaVlxUzTRGQASCThxLZG+w4G/TsiEpFSynVd2y42NzdfdtllX/rSl1KpdD6f53yYppD6koOIOOdCiIceeujhhx/2fT+RSGh7S5tcAAig6teB9zu0OeJ5Xi6Xmz59+p133jlnzpxMppvz4Zg/6kgOItLrxT333PO73/2+qakJsdcg1U3Xqd0PHrStWigUTNO89957L7xwfjbbMwzzR30bsCxr6dKlTzzxuxGtLQColG4RQ2YMCkTk+34sFlNKfeMb33jppQ2JREIpWe9260UOKWUqlfrNb37zq1/9qqWl1fN9Igo5cSyQUpqm6fv+d7/7va6uLsMw6m2o1YUcRBSJRHbv3v3ggw8lk0kpNS2obF6wkCVDg5QyFovt3r3rJz/5iWVF+6zRdUFdyKGUikajjz/++MGD7ZFIpDxnUPnnKDjBPaQDf3YpZTKZfOqp1Tt37rIsq66Tx/EnBxEJIbq7u5977jnLsqTUve/7DEd5Himl53l6i9/Xi6zKoA8utJvY8zwi6pciRMQ57+zsfPbZtdFojKiOk8fxd4IRUSQSeeONN/bt22eaJh2mduWxD5MDEaWUAJBMJtPpdDQaFUL0dQV+sOcSRFRKSSkdxykUCj09PbZtC9HPR9H8eOWVl6+99hrEOu5p60IOIcSOHTts206l0lJWpTYi+r4fjUYnTZqUTqc555XBdNx71bCoeL0Q0bbtAwcO7N+/v7annIgMw9i7d293d3csFlNK1mkE1cV9jojt7e3aB1zjGu1TnzZtWjQa1Qcr8J6p4oNNlMrD6scUQkycODEej7/55pu1/1AIkclkstlsKpVyXb9OBn5dyKGU6urqgpqfVk8wU6ZMiUQirutWGysf7GWlAv2YROS67qhRo0ql0p49e6ptVrVp4jhOT0/PhAkTBmKpDA3H3yDV5wLFYrHG3KinjdbW1lgsJqUMNmqhoaCd5SeddJJpmjV2qvoFOo5T18FTLz+H7/sAUG3i0GRvamr6YK8aQ4NSyjAM7Q+t9u21Jatfcv1QL3J4nleb1IwxwzDghFk4BgXGWNk/VBV6h1/XSbd+t+7Hr4OI/e7ZTljok7aB+DzqOrLqRw4dFFm323/QUdniHvV/Kxv+ur7hei0rJ5q7oh7o9wXW+w2H24QQVRGSI0RVhOQIURUhOUJURUiOEFURkiNEVYTkCFEVITlCVEVIjhBVEZIjRFWE5AhRFSE5QlRFSI4QVRGSI0RVhOQIURUhOUJURUiOEFURkiNEVQRGDh08rZNcgupDw4KIdP5fsAiGHDrtot45Oe9T6AGjX06wIyewmYOIenp6gmq9kYGIruvWThkcHgTTvE6U7ejoyOfzQohwZalAv5n9+/cHokp7BIJMK1JKvfnmm9OnT7csy+8VDTuhwRjTzGhvb9djJthlN0hyMMYKhcLWrVvHjRvX3NyssyNPWIpofY5du3YdPHiwQUyxIMmhFWpc192xY0cikUilUpFIxDTNwKfTYYbOly8Wi5lMxnEcwzDqrQQ3QAScrapnTiFEoVDIZrMAMDzavI2DvjOlVntunLkz+FRmnTiJiCfmstI3J/a9zx7s2wieHBWcaLToi8Z89hNrdQ8xKITkCFEVITlCVEVIjhBV0UAG6QmCo+g4Nyoajhy6NpFWBKc+FTQrla2OY1t9b3tEW7pS5fFqCAEYAwBUBJIAiACBIXIEAFKkdysN4RXtiwYiB2MIALbt6DMny7JM0wQA3/cLhYLneYYhYrEYY/zYYx04Z0qpYrHoeZ4QwrIsIQwi5XleoVBQSkUihmXFAGBodCQERkTAEIgjc5UsFJUPEGUqbjBkSECOS1mfKSArIqKcS5CaIqi50wBoFHLoMlVKqSlTppx55pkf+tCsMWPGJBJJxqBYLHZ0dGzfvuOllza8+uqrtu0mk0kYqm9Au5uy2VwkEpkzZ85ZZ5112mnTR44cqXU/8/ncO++889prr23Y0LZjx5uM8Xg8rpQcbFNIpAA4okd+pijHxfxzZtHcyXDaSDol5ghhKoVdBbm9B9t28Rf+Rrs6BLcwYjBJuioNa4RlJ3hy6Ik9k8nMmTP76quvOe+8c1PpBCmQUurZnjEUwliwYIFtX/faa6/96lePPvXU05yLSCQy2GHNGHNdV0q5cOHCq666cubMGZZlSamklESKCBhjZ5555qWXXprJZF588cWf//znL7+8MZlMDj7uBjnjJdtuNfwlF8G1Z/sTT/IBPUAJCkDmgeBUZHMFXH2O1ZWxHt/s/vgv7PUejEejpBiAaoRVJmByaJlm3/eXLFnyhS98IRo1i6V8JpNBYPAu3XgbABhjs2fPPuOMMxYuXLR06dJDhzq1OvYA22KMlUqlpqamO+64Y8GCBUp5JbtgOzYCqzSlhbm1DOjChQsvvPDC//7vRx588EFEJoToj4uVgkPIGc8U7Qsm2ks/Hfu7U7JgF1WRCAEYIHIg7SxX4CJgsSVW/PJFxqVzWr79B/nLjV7SMgk8fU2wCJIcOlgQAL/3ve9dcskl2Wwmky1yzhhjR7waLXhLRPl8noguuuiiSZMm3X777bt27dHLAfS3yjDGSiV77NhT7rvvB6eeOjmb7UGmGGMM31VTrFI+XimVyWQQ8YYbrp80aeJdd31bSqmLflRvSwEgEmOcsiXnqhn4g2swzg95ecUBe0+aCXprmenKqQgESD7KnHdS5OCyK5OTm3HpM7YVjTfAqhK0n8O27a9//Y5PfOKSru6DiJJzDnAkMzT092CMcc57enrGjRu3dOnSlpYm13X7jX5ARM/z0unU0qX/NmnS+J5MJxfImAA6SrW5ioKq3rZ0dnYuXLjwm9/8huPY/T0NMiLkkLPposnu/77ajUPGcaSBxLDPp353KTMEQgCBTElUdvZfFhevPx/zJZ/z4GeOwMjBOc/n84sXL/7Upy7t7DooBAcEIAbE+11uhRDZbPbUU0+99dZbB0gOx7GXLFkybfrUbK5bCA4AQAxgQG11dHQsXrz48ssvz+VyNSMKkBB9iSNN539dTlHRLV1uIqPen2oFU/U/EkMCYrJQvOvj8rzRKm9TuYJ7YCwJLPrc9/2mpqYvfOELrusyxhH79qT/KVUI0dPTs3DhorPOOqtQKNSID2KMFYvFOXNO/+QnP5nLZg3DHGxbnPNisXjNNde2trbW5KJCxkq2vPIcMX1kyS8hEwpJ/xCWS9UfDb3/zpDIZ9FI4fqLQPp+79IT3AITDDn0B5s7d+6pp55q2w5DAYRAujMD3YDoYnKLFi2SUtZQ4ddEXLRoUSwWU4qAWLktGmBbuvLN+PHj582bZ9t21bpBgEpBwipddoZP0kXtsCh3dkDfmJAxIMe/eJo3Y5Rre7VKXQ0DgkxqmjNnDmOVkTHoMtWMoeO4M2fOjMfjNSqP6FqsM2fOdF2dJjPEetiIePrpp0spq1q+jByPpjXz6SNLIIkxQhrsqCcGRD6k46W5Y9H1ATFIz2mQqQmnnHKKlMcyOFBKv7W1NZlMep539CsQdW3skSNH+r4/5LYQUSk5ZswYzkW1zTMD9JUcnWIxwbRLHIbyYfV2CMY3G4pUsEZpYOTgnFd2hsd4H8uyal9jGMaxz8/6PqZZ/VYEBMAtX//Wa2cOsVnipgr8xDxIgzSXy+kztiHfhzFm23apVKpR10fbN7ZtHyM/GGP5fF57O456AQFwhFwJfamtp6EsYYSgY0q7iwyAAcGgl6bjh8DIIaXcsWMH4tDDJ/VQ3rNnb3d3dzVy6PUrk8ns3r1biKGH/BMRY2zHjh2e51c1fgkMAXvaobsQBYFEQIiDfMMIQMBAecaOfT7jCiBIizSwZcU0zba2tmKxNORcBKWUEGLduuddt1bmoPaAvfjii9UqcQ4Eevp54YUXTLMqwxSAIcTeDGvbY4DBZe8mdhB0JCSSAjl7s0ts3C8t0wg20z4YciilotHo1q1b165dm0ymhlDlUCmyrMj+/fuffvppy4rWOGFRSsXj8aeffnrXrl2WZQ1h8pBSJpPJ9evbXn31VcuyajCMkfIE/6/1JUkWMCTAge/MAQAJfZAYtR5tw4M5NBGACIM7ZAkyy14IsXz58s7ObsuKDuqbERGRisXiK1asaG9vN02zRtUwvfp0dHQsX75Mm66Dmj90Ic9sNrts2QOci3LrR7kDAvhAiYh49m/GzzckRTzuK6IBv2FC8IjMOG56M/rj9WAlLEkSVK/7LBAESY5oNLpr16577vkeY9wwIgM8X9Xn+CNGjHj44YefeOKJZDJZy/cAAAB6N/vUU0/9+Mc/bmlpGXhEmZTSMAzTNO+5557t27dHo1YlZuwoTwSAhKTIMq17f++t3RYz4obfT9f6tkVGlO3rbvnnR3jRizHGCYLjBQAEe/Cmv9maNWvuuOOOUqmUTjcpRdW+tP6iUkrLspLJxLJly+6///5YLK7UgF6gXlweeOCB+++/Px6PR6OxSrzIUdvS/5tKpVzX/eY3v7l69epUKjUQ+ipAzlQGjRsf8f+4udlIWcjIV6DoKF5SAiSFviIAEknz9YPNX/wv+muGR00EqQCIAt3OBhzPofnx3HPP3XjjjTfffPNHPvIRxtBxbM/z+g5unU8biUSEENu3b1+2bPkzz/xpCPFg8XjioYd+vG3b9iVL/mHGjBm+7zqOc4T6g66GbFmWlPL555+///7/3LFjeyqVknJgvnYgRWBwyMjIdf9P3bQ7fv2FxqiUA8oDXymJSocPogICzggiKIRw7dgv1hrf/xM/WDQSUZAKERmB1PNRUE7S4CPBtLm3Z8+e22+/fd68eYsXL54zZ/aIEa2RSKQSfyWl7Onp2bRp0+rVq595Zk0ul0+nm6TUZuxAXxwREFEymVq79i+vvLLx4osvXrRo0bRpU5ua0n13wq7rdnR0bNq0aeXKP7S1tQFgKpWW0h/MLItKcsGIGLvvOXxsM//7061LZrPTWnMxyyvfhoDA9yK7u8012/hvNkLbXiMS4YkI+oRYnmWCXVeCJwcA6MUCAF544YV169aNHDlywoRxY8eOTaVSjGGxWGpvb9+9e/e+fW+7rpdIpBIJPY6xPLAG11YikZBSPv744ytXrhw9+uQJE8aPHj06FosSUTabO3Bg/86duw4ebAdgiUQKEctzxkDaKh8VIRAxBErHxd4S+/6f/WXr5KkjY9Nb5MgkNyNMSXkwB3/rNt7qUB1FZnKRiHFS0idAUIBUCR3SUWODf6nHAQ1BDigHeScSCQDI5XKvvLJxw4aX+qYLGIZhWdFYLKEUKaXX/l4P9WD5oVUM0+m0UurgwYNvv/1239QEzrlpmslkCgD72CQDjOvs+xWJAKSCCJfROFOSv/4ObdkHiiSAIuCKmYwzS0A6qohIKR+AYe9NeleTYGMFG4UcGpoiQogjTkMqJa7fs/AP/eVp69IwTNOMvLctpSrmY+V7D9E4JEJJAEhmBBABQQAggEIiBb4CkIfP1ypP1xCpT41FDo3qTovjH/kynG0pAFRQjiPRn/9wZGkDohHJUR3D+RKPf1t9rMuGmBj6ReDHwiEaFyE5QlRFSI4QVdGgNgeWAWUfaI2jtWNvCPpIttWpIQC9VTkcoEHaod7AVkdjkUO7NKSUjuP6vqe/k05kMgzTMDjRENPe3wuds+T7vs6e1bfVGsKmaXLOj0WFgfCw+an1F4jQk+RK8lVvVDpnaHAwBDDEPowMPpepgkYhByIyhqVSyXHceDw+btwpJ598ciqVQsRisXDoUMf+/fu7uzsZ4/F4opxHOUTo2MRCIS+lampqmjBhwkknnRSPx6RUuVyuvb39wIH9PT09phnVuZZDmEiQAEERcMZISZ4tOiaq1iaYnIbRCWUIQynqzPu7MnxfRuU8ETWjhumB1DIdioA3wkamIcihdYxLpdL06dM//vFLzj777HHjxsXjMSEMRPB933Gcjo5DmzZtWrVq9YYNG4ggHo8PTaVDZygR0bx55y5cuGD27NmjRo2KRi0d7ez7Xqlk79u3b/369atWrXrjjW3RaNQwzMFzkQgFB8qVnLSlrjuDXTJHzhytRicVEzYoBsRAYpdL29qjz2ylRzfnd2VYKip0+myDKLkETw6dF9nS0vK1r33tk5/8RFNTynEd1/Ecx7FtW+vXMsbGjBk7efKpixdfumFD249+tGzz5le1/3tQbTHGenp6Zs2addNNN51//rnC4I7jeK5fLBahHCgqhJg2bdqsWbM++9nPrlq1asWK/9vZ2aWPY/q7/eEsewbMJ+XYhc/NMr62gKaPyYHywCeQSsrexAUO0GLgeZOc86aJ6+abDz8Xf/D5YpHHTSFQyUagR8C7Fc55LpebOXPm8uXLr7zySmTU1dNRKpX08Ye2NvQq4DhOd3d3qVSaN+/cFSuWff7zn83na2euHgnGWC6Xu/zyy5ctW3bBBRcUivlMptt1XM0J3ZZesEqlUnd3NwB87nOfe+ihB08/fXYul6sR4F5Gr9HAgHxCw3Pu+TQu+6I/fVTOLziypJQkIuRAgoFgCAyJQDpK5pwx0dw3/kfhoWuN0Zbjur4WOQocQZJDV02YM+f0H/7wh+PGje3u7gBQnPEjNg6Hz74YA4BsNqsUfetb37r22muy2YwQokYuZAWcs1wud9VVV33723cxBrl8D2NQCUs+altE1NnZOXr06B/+8P+cddaZmh812yIEQECJHGTxP/9e3DC/ZJe6pOMLBpwBg/Jpq9JxPoAEHIgjUz7zcrmPzen62XVqjFV0PdUIdRMCI4euRzRiROt3vvPteDxSLOWEwYEYkICa8U/aOMhkMrfddtv8+RdmsxnG+pk/GGO5XP7888/7x3+8LZfvUeRxzoA4kKj9BoQQxWLRNCPf/e53Tj55VH/JLwyIkEGpaN++UH3q3B6v2zGA86r59X3/EgzG3Iz/ofE9932WCfIA2QD+rr4IkhyO41x//Q3jxo0rFPNCiD5RT/0Y6joIyPf9W265tamp2fe92jOHlDKZTNx88y2KFJEsZ9kPqC1twI4ePfqmm5b0J/dAwJhtw9xxcNMFvsyXOEcGRIj6p7oEg7ZUyGDo5dTHZtj/8yyeK0mBHAPdswSW1GTb9tSpUxctWlQoFAzD7BMMN6DXwRgrlYpTpkxZsGBBbQkGLUX3sY9dPGPGDLtkc24gDq4tIUQul/voRz962mmnlUqlGvxARF+5XzyfRUWRJEdWkWBQSP0n2iMRAyC/dO15sinie4oAWIDsCEyCwXXdefPmpdNp3/eBWO8PwMD394hMSvnhD39YZytV+2Y6n/bDH/4wkcJefRgtHjQwWQQAKMcynnvuua7rVpVgQPB8GJPyPjK1RFLqLPtBLgzIkcCl6Sc7p4/1bE8hCzLcJ8jUhGnTph2LLwsRXdebMGFCMpl0XbfaZToucNKkSa7rvlu2ZXBQSk2bNg2qK5Miguupqc3m6IQPkhBh8JmuBACKwODunFGG55+QWfZKKdM0W1paAI6pxp1SMh6P13BC6KTcRCKRSCQGmMRQ7T5KyebmZtOs6hBDAgkqFZccGSlAKmvCDQGELQkgkBCosnGQW1ktJXiMN9ELSg2HR2VjfMybQ6x4RI7eEwAEkEIRHB7xQ1gVEABQ2gAcOBzDVHfsCMwg9TxPl0E8hiPQ3gz6TCZbI8ueMZbNZru7ezgf+oEFEXHO2tvbtc1RbbYTHDq6mONy/U0J2RDeMCGAMvd1qHI0YWDFAAMjBwBs3LjxWA7HlSLTNLdu3ZrNZmrMHHqvsWXLFtM0j2VlIYJNmzZBufNHvcAQfOdB3NsdI87UkLLViBhjULD5a/uVMEEFqoIemM0Ri8VefPHFffvejkQiQ6aIlPKPf/xjbatF71b++MenPa8fd0iNO5im2d7+zrp163Qm3NEvAzAYO+jAE6/5aGjRpsFJMACCT4gmX7dbvNrOYsIE8Aaein3cEZg+h2EYhw4d+sUvfhmLJQaYadgXvu+n0+kXXnjhxRdfrC1yrbNk29o2rFnz51RqKHIP2qT99a9/c+DAOzVFPkiRb0aMh9v8vdm4iDAfBmFTEYIiRO77GH/gWfKAA0ikE09qEspZsr/+9a/XrFnT0tI6qG+mBQI7Ojr+/d//vaJ8XWP6ISLDEPff/8MDBw4M9qzf87zm5ubnn3/+kUceSSaTOrzj6BIMhIowytnejHXn49wXKUakVP86uOVeggQlErEVq82/7ODJqCEJZbCHXwG2DQCMsbvvvrutra219SQpVb9uD+01TyQSxWLx61//+q5duyKR/vVYiCgSsfbvP3DHHXf09PQkk8kjkqePCp3UP2LEiM2bN991113ah1aLgggI4BOlLXPlq3TXYxzNNDN8qRT1t2mRChDISMZ+sTbxb0/zWDRKKvhc2SDJoReXUqn0T//0T4899ttUKh2LJfQnqQzQcv6ZklJqtYzW1tY33njjpptu2rhxYyqVKqdG9gOlZCIR37p165IlS7Zs2dLSMkIrglRrS1tF6XT697///a233prNZk1zoLaRJBWLR1e8wL7yc+OgneJxAxlJRZJ0FiwqYAqYBJAKfUWExKPMFal/+0Pi9seIolyxcszgiZxIrb1hvu/ffffdzz777NVXXz1r1kzLinie5/u+nhK0/oKu471nz54nnnji0Ud/ZdulRCLh+/7AV3UpVSKR2rNn75IlX73iiiuuuOKKCRPGc850W1QWw9dtua772muv/fKXv1y9+ulIxKzh+zoqSKlEzHzsNfnG23TjhfzTH1JNaQmyCJJAlacRrb1umG7BfHar9Z9r4C97RCxqIKrD1wSK4CPBlFKc80QisWbNmueff/6MM84499xzZ8yYPmrUKJ1673leT0/P3/72tw0bNqxf39bR0RGPJ6PRuJSDYIaGlFJLTP3sZz9buXLlvHnz5s6dO2XKpJaWVq0dZdv2oUOHtm7dun79+o0b/2rbdiKR0rPJoGZZAgYS0hbfmY/98+Nq+fP+/OnsgonG9BFuU4wLzohktgQ7u82X3mbPbGOb96EHkVQMFJEi5IAKVcC6Po1ADijH2iQSCSJqa2tbt25dJGIkk8loNIqIjuPm8zldIycajTU1NVdixcsOokFQRP9lU1OTbdtPPrnqySf/EI1ayWRS15MrlUr5fN62bSFELBZPpdK+r8onxmow/FCAKBUaggyT7cwa29bKnz5vNptm3AIhQJHqdkXGEZ5HpomxCJqkq4UxBJDls9gTelnpC/3Z4vF4OVbPKRRK0CuLINLpJs2hdy8lQ4yH0Vqz6XRK/57LFYjyAMAYM03LsmK6YmSftgbbiv6sRAQgyeIQSwgiKCjIloiAEAgZtwyMmQBE8rB3TkEfToQSDO9CZWnX+tf6d+oVX3hv/vHQXx4RVfa0fb3v5X8/nm0pAqVLPiIIAb31/YiIpAQMWIWjOhqOHBXUKe0syLZ6JxPoI8HAsYFT3t5fubLvbwmGPgglGEK8zxGSI0RVhOQIURWNaJBWomn62In1NRkrR/mVdo9XLn8FDLX4AioCHTWGCPqshgIsqVITDUQORGCMSalKpZIOGNYxeQNJaDtGVE5VdBqmYRiRiMm5GFqKPQAQAiOtik8CmQRVcsmRxEkKznRtQKnAV4wLskxuMJQksbfCU4PkUTcMOTjnnudls7l4PD5t2rTp06eNHz++ubklmYybpqkzTYZcmaU29KGe67qFQrG7u2vPnr3bt2/buXNnJtMdjyeFMCpnewMnCqPeyYFQ9hRVkvlnjFFzJuLsUXhKomhwQynsyMvXu/DlPbhpj+goRqw4izAgBQhKAQs2nUmjIcih06nT6fRll112ySWLpk6donXN9cA97jP8EShnLaOepZRShULhrbfeWr169ZNPPtnV1Z1KpQcr90BAjAnXdYV0PjMbvjIPzprgGaYPzAdSIDV32OUcwIu+0Q4/e8X9zUu822ZRK6IUNgIzIHByICIAZbOZj370Y7fccsvEiRM8r+S4Tk9Pt5Zk0pfV1eJ4byuMsenTp8+ePfszn/nMAw88sHr108lkagB9OCzBwJFnbWdqS/HeSxMX/10eZB4c1XtQiLoeNgH4QMhY7rTRuXs/Hbn2zJa7Hvf+tNtLxkylBn2mWA8ET458vnD99TfcdNMSKf1MNsMYMOT4bg2C4am927cV27aLxeLJJ5/8/e9/f+rUKcuXPxiLxSr/W4UovWrlnFHW8S8aQ/d/kZ/S1OkXPVTAGXLQX1xB7y9aqQWVjdJ2Zpx88Gc3pr75W3xkgxdLWIOPnDz+CHIryznPZrPXXXfd1752W6GYs52C4Jyh0QgbbB3Y4ThONpv9h3/46g03XD8AORBkRMgp78GsUfaKL8lTkhm74AogXsl4pSN/kIghGMilQxHWfd/nnMs/JHNFjzeAREdwkc2M5fP5888/f8mSm7q7OxlT5bVfBZipcQS0FdLZ2fmVr3x5/vz5uVxOC7xUmcmQEJVicSgtvQJGprr8IkaYTl2pcXrc+9QciRzOZO7eK+i0EWRLYIydoBIMOgbshhuuB6De1LfDh5PBD5oKKmlX119/g2VZNQOhFTIsltQVZxjzxtt+gbhBQGoAByi9F3AmpcNak8Ul89FzJAs23y3ALPtisXjmmWfOmvWhYrHIGAdiDcWJvtC9nTHjtLlz5xaLxapZ9oBEGDFLn5krSdqIDIDwXatIfyDGmSLHvWSmP7HFs31JGGS4T5BFh88++2wdnBdIHwYFIuJczJ07V3vJjn4RkuPRlGacdXIRJDFGqGCQGWuEAODDyGTp7FOU6xELNNYjyFr248aNr/WuGwmazePHj68RacwQPSnHpUTKZL31/oY0GSoAIJraavhSBnumHyQ5DEMMWSJ4+EFElbJzR5/tCAjAiHp6q4tDZgcAgDIiWmoGg9w0BNKqHoilUqlh7Yz3Qgss1zBICYAjlHwmD1f8xMEnQvcqsXfbyIAhsg9aln2/R2VadHznzp1aGrAefTi+ICLG+FtvveX7ftVHIxAc326HXDECHAm0SNyg3jDqrAbyzZ0HJDKpTsBcWZ23vmHDBp1wEEgfBgXGmOPYbW1tOoPhqFAAhhC7u3HTvggIrrS4z+Cy7EkRRwZvZ/jG/RCJGNSbSx0M6kWO2p9cKRWNRl999dW2tjZdb7xO3TgukFLG4/GXX35l48aN0Wi0+kEgcVRFwIdfKgE3iSlCQhzUooA+KYxFfruJ7c4wCxFI1lAkqve4qtey0u96oR9sxYoVuVxBiCEozw8TlFJCCNu2V6xYLqWsIUWEgD6pZCSy8jX+xNaEiFmepIG/YULwiUyLdrXHVqxVMUv4oICObnPoZa7ei3K9yGEYBgDUYLbOVH799dd/8IMfRKNRIcwGnD907lMsFrvvvh9s3vxqbSEQ6LUyFLLoXb+WW99JmlHh+wN1dUhJwoCc1/wvj4iufDQiOBGq6irGnKPOHx7aow0E9SJHLBbrt99aomPlypV33nmnUiqZTOsM98BNVJ3XpLVHGWP/+q//+vjjv0ul+ln+FAMAkICWYAds8ys/kRv3Nok0R1JSYdlFesQRAeqqs0qRiPNDTvOSh/GZvcKKCVlTgoGIhDBisVhdfQHH/8hea7S1tLQM5BvrD7By5crdu3d/9atfPeeccxgD27YrKfbDD30ea1mWUuqVV17+0Y8e+Otf/5pO9x/vU/6QJImihngzxz77U+euhckrz3LMiAOuJJ8kaHcIAgAgMFJMADcRKP6nrZFvP2lsbeepOPrlLHuko2ZEIpHSZbP1Snc8n78P6hLPQURjx44dYKellOl0etu2bbfddtt55523ePHimTP/bsSIVu1xqtywHv18NxARlCLPczs7O7ds2bJq1aq//GWdlDKVSvu+P6hZViqKCiz61u2PeY++zK+ZG7vwNByTyHLhH96aIoI0MnZk/Vbj0Zfxya3cRzMVRY+I92Ougef5o0aNam5u8v06VmY5/uTQMpJTp06NxWIDFPuSUkajUSJau3bt2rVrR40adcopY8eOHTNy5MhEIqErrunyK8e9twCglNKV3gqFQldX59tv79uzZ097ezsRJhIJACw/xWDifhFIoYFkxM0X9+O6x7yxKTV7TGLmSP+klDBNrpR/MAfbO4wtB2hnF5OKxyJCgJQ6KBmxHDp0lHszhq7rTZw4IZ2OFYpFhvWK2Dr+92WMOY4zZcqUyZMnb9u2o+be7zD0NYlEAgB6enoOHmzfsGGDnjDeMwMdx1mkkpFQqdJIjPFIxIzH44isHHyO5RDAgY9RIgRd6C0WUQiiq0irXxdPbYkAKGQKiDvMRBSWIMtUCKCUr8pVHHofu+qDolLqnHPmCoNrR32dUBfSSSmbmpoWLFiwefOWeDw+cOtBXymEMAwjKOdYOU2BynvIXgGmQc7eWPlbUkhAnENM6GcSBIBACQJCTwKoPoLHh/9YZ12/p02t+D5mzMnz519YLLgMzfq5UOtCDl2C6VOf+tRvf/v4wYMH9bn8wO2GQV1cNxznQw3NNVTwrm85aO8ncS4ymcx1131x9OgxmUwtdd5jR722sr7vt7S03HLLLfow4n3hI383jv9e6djjdoQQ2Wx2zpzTr7rqqnw+XycjrIJ63Z0xlstlFyy4+Mtf/nJ3d3f9zMkTB0KIQqHY2tp6993f1jvt96X7vPfWjOfz+RtvvPGGG27IZLK+79d1DvwAQ+sp9vT0jBw58j/+475Jk8cVS3WfNmAYTmVLpeLNN3/1rru+FYmYPT1dAKT3pfVu9wOAcvFU5rpuV1fXeeedt3z5shkzThtszdShd2DLls31bkMplUwm33rrrZ/+9Kdr1qzJ5fKRiKW9F++9uAFM0SDR1+/neZ7jOFLKyZMnf/7zn7/88k8DgG2XuGAw6AJhQ+rMMJADegVALV0B46mnntqw4eV9+/bl83m9cFagu6Q9lcPQq4ZB78Pq1GA9PEzTbG5unjFjxvz58+dfdGFrS1MulyMAhsawxYYNEzmgLHoRi8VM08xmc3v37t25c9fbb+89dKgjm83adsnzfCml0mqcjZFJPDzQ5bCFENr51tTUNGrUqAkTJpx66pSTTjqJc1EsZj3fEXy4cwGHjxwaOnFeCG6aEe3pqghjVNTHh7M/jQDsDRtFVgYAaFUI13WJgHPNieGOJx3uRGr95ERQKtnFYlH/Y+XtDHNnGg16YFQODd6z/x/uY+rAsuwZQ4BwZ/su9Dc8hlvxJ3RMvY8w3DNrSI4QVRGSI0RVhOQIURUhOUJURUiOEFURkiNEVYTkCFEVITlCVEVIjhBVEZIjRFWE5AhRFSE5QhwdiAGroIZoXHie//8BjXdb/faQ0tQAAAAASUVORK5CYII=', 'base64');
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

  // ── Привязка устройства через cookie ────────────────────────────────────
  const cookieName = 'dev_' + token;
  const cookieVal  = cookies[cookieName] || '';

  if (clients[token].deviceCookie) {
    // Устройство уже зафиксировано — проверяем cookie
    if (clients[token].deviceCookie !== cookieVal) {
      res.statusCode = 403;
      return res.end(html(`<div class="box" style="text-align:center">
        <div style="font-size:48px;margin-bottom:16px">🔒</div>
        <h2>Доступ с этого устройства запрещён</h2>
        <p style="color:#636366">Эта ссылка уже привязана к другому устройству</p>
      </div>`));
    }
  } else {
    // Первое открытие — генерируем уникальный cookie для этого устройства
    const uid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    clients[token].deviceCookie = uid;
    clients[token].deviceInfo = (req.headers['user-agent'] || '').slice(0, 100);
    // Устанавливаем cookie на устройство клиента
    res.setHeader('Set-Cookie', `${cookieName}=${uid}; Path=/; HttpOnly; Max-Age=31536000`);
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
    overscroll-behavior:none;
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
    transition:filter 0.08s; user-select:none; -webkit-user-select:none;
    -webkit-touch-callout:none; touch-action:manipulation; }
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

// current — всегда чистое число в виде строки: "2000", "8.6", "-5"
// НЕ содержит пробелов или запятых
// setDisplay форматирует для показа, но не меняет current
function setDisplay(val){
  const el=document.getElementById('result');
  let displayTxt;
  if(typeof val === 'number'){
    // Результат вычисления — сохраняем как строку без форматирования
    current = Number.isInteger(val) ? String(val) : String(parseFloat(val.toFixed(8)));
    displayTxt = fmtNum(val);
  } else {
    // Строка при вводе — current уже обновлён в pressNum
    current = String(val);
    // Форматируем для показа
    if(/^-?\d+$/.test(current)){
      displayTxt = fmtInt(parseInt(current, 10));
    } else {
      displayTxt = current; // дробное или "-"
    }
  }
  el.textContent = displayTxt;
  const maxW=(window.innerWidth||375)-48;
  const sizes=[72,64,56,48,40,34,28,22,18,15];
  let chosen=15;
  for(const s of sizes){
    _cx.font='300 '+s+'px -apple-system,sans-serif';
    if(_cx.measureText(displayTxt).width<=maxW){chosen=s;break;}
  }
  el.style.fontSize=chosen+'px';
  el.style.letterSpacing=chosen>=40?'-2px':chosen>=28?'-1px':'0px';
}

// Получить числовое значение current
function getVal(){ return parseFloat(current) || 0; }

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
      setDisplay(xShown);
      historyParts[historyParts.length-1]=fmtInt(parseInt(xShown));
      renderHistory();
    }
    return;
  }
  setActiveOp(null);
  if(fresh){current=n;fresh=false;}
  else{if(current.length>=9)return;current=(current==='0')?n:current+n;}
  setDisplay(current); // передаём строку — current уже обновлён выше
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
  const val=getVal(); // ← parseFloat(current) — current чистая строка

  if(mPhase===2&&op==='+'){
    pendOp='+';fresh=true;
    historyParts=[fmtNum(mRes1)+' +'];
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
    historyParts=[fmtNum(mRes1)+' + '+fmtNum(mRes2-mRes1)+' = '+fmtNum(mRes2)+' +'];
    renderHistory();
    return;
  }

  if(op1!==null&&!fresh){
    const res=doCalc(op1,pendOp,val);
    setDisplay(res); // число
    historyParts=[fmtNum(res)+' '+op];renderHistory();
    op1=res;
  } else {
    op1=val;
    historyParts=[fmtNum(val)+' '+op];renderHistory();
  }
  pendOp=op;fresh=true;
}

function pressEquals(){
  if(mPhase===5){
    historyParts[historyParts.length-1]=fmtInt(parseInt(xShown));
    setHistory(historyParts.join(' ')+' =');
    setDisplay(mTarget);setExpr('');setActiveOp(null);
    mPhase=0;fresh=true;
    document.getElementById('pctText').innerHTML='%';
    clearDots();
    return;
  }
  if(pendOp===null)return;
  const val=getVal(); // ← parseFloat(current)

  if(mPhase===1){
    const res=doCalc(op1,pendOp,val);
    historyParts=[fmtNum(op1)+' '+pendOp+' '+fmtNum(val)+' ='];
    renderHistory();
    setDisplay(res);setActiveOp(null);
    mRes1=res;mPhase=2;op1=res;pendOp=null;fresh=true;
    return;
  }
  if(mPhase===3){
    const res=mRes1+val;
    setDisplay(res);setActiveOp(null);
    mRes2=res;mPhase=4;op1=res;pendOp=null;fresh=true;
    historyParts=[fmtNum(mRes1)+' + '+fmtNum(val)+' ='];
    renderHistory();
    return;
  }

  const res=doCalc(op1,pendOp,val);
  historyParts=[fmtNum(op1)+' '+pendOp+' '+fmtNum(val)+' ='];
  renderHistory();
  setDisplay(res);setActiveOp(null);
  op1=null;pendOp=null;fresh=true;
}

function doCalc(a,op,b){
  if(op==='+')return a+b;
  if(op==='−')return a-b;
  if(op==='×')return a*b;
  if(op==='÷')return b!==0?a/b:0;
  return b;
}
function fmtNum(n){
  if(!isFinite(n))return '0';
  if(Number.isInteger(n))return fmtInt(n);
  const r=parseFloat(n.toFixed(6));
  const parts=String(r).split('.');
  return fmtInt(parseInt(parts[0]))+','+parts[1].replace(/0+$/,'');
}
function fmtInt(n){
  const s=String(Math.abs(Math.round(n)));
  let out='';
  for(let i=0;i<s.length;i++){if(i>0&&(s.length-i)%3===0)out+=' ';out+=s[i];}
  return n<0?'-'+out:out;
}
</script>
</body>
</html>`);
};
