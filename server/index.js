const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const gemini = require('./gemini');
const { criar } = require('./auth');
const { P } = require('./engine');

store.iniciar();
const auth = criar(store.segredo());

const PUBLICO = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp'
};
const SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
    "script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'"
};

const uso = { dia: '', total: 0, porIp: new Map(), envios: new Map() };

function ipDe(req) {
  const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return f || (req.socket && req.socket.remoteAddress) || '?';
}

function limite(mapa, chave, max, janela) {
  const agora = Date.now();
  const lista = (mapa.get(chave) || []).filter(t => agora - t < janela);
  if (lista.length >= max) return false;
  lista.push(agora);
  mapa.set(chave, lista);
  return true;
}

function json(res, status, obj) {
  const corpo = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(status, Object.assign({ 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }, SEGURANCA));
  res.end(corpo);
}

function falha(status, msg) { const e = new Error(msg); e.status = status; return e; }

function lerCorpo(req, max) {
  return new Promise((ok, erro) => {
    let n = 0; const partes = [];
    req.on('data', c => {
      n += c.length;
      if (n > max) { erro(falha(413, 'envio grande demais')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      if (!n) return ok({});
      try { ok(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch (e) { erro(falha(400, 'JSON invalido')); }
    });
    req.on('error', erro);
  });
}

const rotas = [];
function rota(metodo, padrao, fn, opcoes) {
  const chaves = [];
  const re = new RegExp('^' + padrao.replace(/:(\w+)/g, (_, k) => { chaves.push(k); return '([^/]+)'; }) + '$');
  rotas.push({ metodo, re, chaves, fn, opcoes: opcoes || {} });
}

rota('GET', '/api/health', () => ({ ok: true }));

rota('GET', '/api/me', ctx => ({
  admin: ctx.admin,
  adminConfigured: auth.configurado(),
  ai: gemini.ativo()
}));

rota('GET', '/api/settings', () => store.getSettings());

rota('GET', '/api/catalog', (ctx, req, res) => {
  const etag = store.etag();
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return undefined; }
  res.writeHead(200, Object.assign({ 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', ETag: etag }, SEGURANCA));
  res.end(store.catalogoPublico());
  return undefined;
});

rota('POST', '/api/login', async (ctx, req, res) => {
  const r = auth.login(req, res, ctx.ip, await lerCorpo(req, 4096));
  if (!r.ok) throw falha(r.status, r.msg);
  return { ok: true };
});

rota('POST', '/api/logout', (ctx, req, res) => { auth.logout(req, res); return { ok: true }; });

rota('POST', '/api/samples', async (ctx, req) => {
  const cfg = store.getSettings();
  if (!ctx.admin && !cfg.publicContrib) throw falha(403, 'envio de correcoes desativado');
  if (!ctx.admin && !limite(uso.envios, ctx.ip, 20, 3600 * 1000)) throw falha(429, 'muitos envios, tente mais tarde');
  const dados = await lerCorpo(req, 8 * 1024 * 1024);
  const s = store.criarAmostra(dados, ctx.admin ? 'admin' : 'publico');
  if (ctx.admin) store.aprovar(s.id);
  return { id: s.id, status: store.amostra(s.id).status, rev: store.rev() };
});

rota('POST', '/api/ai/identify', async (ctx, req) => {
  if (!gemini.ativo()) throw falha(503, 'IA desativada');
  const cfg = store.getSettings();
  const hoje = new Date().toISOString().slice(0, 10);
  if (uso.dia !== hoje) { uso.dia = hoje; uso.total = 0; }
  if (!ctx.admin) {
    if (cfg.aiDailyLimit <= 0 || uso.total >= cfg.aiDailyLimit) throw falha(429, 'limite diario da IA atingido');
    if (!limite(uso.porIp, ctx.ip, 15, 3600 * 1000)) throw falha(429, 'muitas consultas a IA, tente mais tarde');
  }
  const dados = await lerCorpo(req, 4 * 1024 * 1024);
  const itens = Array.isArray(dados.items) ? dados.items.slice(0, 30) : [];
  if (!itens.length) return { results: [] };
  uso.total++;
  const els = P.ELEMENTS.slice();
  const tiers = JSON.parse(store.catalogoPublico()).tiers.map(t => t.name);
  const results = await gemini.identificar(itens, store.entradas(), tiers, els);
  return { results, model: gemini.modelo() };
});

rota('GET', '/api/prints/:id', (ctx, req, res, p) => {
  const f = store.arquivoPrint(p.id);
  if (!fs.existsSync(f)) throw falha(404, 'print nao encontrada');
  res.writeHead(200, Object.assign({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' }, SEGURANCA));
  fs.createReadStream(f).pipe(res);
  return undefined;
}, { admin: true });

rota('GET', '/api/admin/samples', (ctx, req) => {
  const status = new URL(req.url, 'http://x').searchParams.get('status') || '';
  return store.listarAmostras(status || undefined).slice(0, 300).map(s => ({
    id: s.id, createdAt: s.createdAt, status: s.status, source: s.source,
    total: s.cells.length, rotuladas: s.cells.filter(c => c.label).length,
    rotulos: s.cells.map(c => store.rotulo(c.label)).filter(Boolean).slice(0, 40)
  }));
}, { admin: true });

rota('GET', '/api/admin/samples/:id', (ctx, req, res, p) => store.amostra(p.id), { admin: true });
rota('POST', '/api/admin/samples/:id/approve', async (ctx, req, res, p) =>
  store.aprovar(p.id, await lerCorpo(req, 1024 * 1024)), { admin: true });
rota('POST', '/api/admin/samples/:id/reject', (ctx, req, res, p) => store.rejeitar(p.id), { admin: true });
rota('DELETE', '/api/admin/samples/:id', (ctx, req, res, p) => { store.excluirAmostra(p.id); return { ok: true }; }, { admin: true });
rota('POST', '/api/admin/samples/:id/unlabel', async (ctx, req, res, p) => {
  const d = await lerCorpo(req, 4096);
  store.desrotularCelula(p.id, d.r, d.c);
  return { ok: true, rev: store.rev() };
}, { admin: true });

rota('GET', '/api/admin/entries/:id/uses', (ctx, req, res, p) => store.usosDaEntrada(p.id), { admin: true });
rota('PUT', '/api/admin/entries/:id', async (ctx, req, res, p) =>
  store.editarEntrada(p.id, await lerCorpo(req, 8192)), { admin: true });
rota('DELETE', '/api/admin/entries/:id', (ctx, req, res, p) => { store.excluirEntrada(p.id); return { ok: true }; }, { admin: true });
rota('POST', '/api/admin/entries/:id/merge', async (ctx, req, res, p) => {
  const d = await lerCorpo(req, 4096);
  return store.juntarEntradas(p.id, String(d.into || ''));
}, { admin: true });

rota('PUT', '/api/admin/tiers', async (ctx, req) => store.salvarTiers((await lerCorpo(req, 16384)).tiers), { admin: true });
rota('PUT', '/api/admin/settings', async (ctx, req) => store.salvarSettings(await lerCorpo(req, 16384)), { admin: true });
rota('POST', '/api/admin/settings/reset', () => store.restaurarAparencia(), { admin: true });
rota('POST', '/api/admin/rebuild', () => { store.reconstruir(); return { ok: true, rev: store.rev() }; }, { admin: true });
rota('GET', '/api/admin/export', () => store.exportar(), { admin: true });
rota('POST', '/api/admin/import', async (ctx, req) => store.importar(await lerCorpo(req, 16 * 1024 * 1024)), { admin: true });
rota('GET', '/api/admin/stats', () => Object.assign(store.estatisticas(), {
  iaAtiva: gemini.ativo(), modelo: gemini.modelo(), iaHoje: uso.dia === new Date().toISOString().slice(0, 10) ? uso.total : 0,
  volume: store.DATA_DIR
}), { admin: true });

function estatico(req, res, caminho) {
  if (caminho === '/' || caminho === '/admin' || caminho === '/admin/') caminho = '/index.html';
  const alvo = path.normalize(path.join(PUBLICO, decodeURIComponent(caminho)));
  if (!alvo.startsWith(PUBLICO + path.sep)) { json(res, 403, { error: 'proibido' }); return; }
  fs.stat(alvo, (err, st) => {
    if (err || !st.isFile()) { json(res, 404, { error: 'nao encontrado' }); return; }
    const etag = '"' + st.size.toString(36) + '-' + st.mtimeMs.toString(36) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return; }
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[path.extname(alvo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache', ETag: etag
    }, SEGURANCA));
    fs.createReadStream(alvo).pipe(res);
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const caminho = url.pathname;
  if (!caminho.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error: 'metodo nao permitido' }); return; }
    estatico(req, res, caminho);
    return;
  }
  const r = rotas.find(x => x.metodo === req.method && x.re.test(caminho));
  if (!r) { json(res, 404, { error: 'rota nao encontrada' }); return; }
  const m = r.re.exec(caminho), params = {};
  r.chaves.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  const ctx = { ip: ipDe(req), admin: auth.isAdmin(req) };
  try {
    if (r.opcoes.admin && !ctx.admin) throw falha(401, 'faca login como administrador');
    if (req.method !== 'GET' && ctx.admin) {
      const origem = req.headers.origin;
      if (origem && new URL(origem).host !== req.headers.host) throw falha(403, 'origem nao permitida');
    }
    const out = await r.fn(ctx, req, res, params);
    if (out !== undefined && !res.headersSent) json(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'erro interno' : e.message });
  }
});

const PORTA = Number(process.env.PORT) || 3000;
servidor.listen(PORTA, () => {
  console.log('PKA Stone Reader ouvindo na porta ' + PORTA + ' | dados em ' + store.DATA_DIR +
    ' | admin ' + (auth.configurado() ? 'ativo' : 'SEM SENHA (defina ADMIN_PASSWORD)') +
    ' | IA ' + (gemini.ativo() ? 'ativa' : 'desativada (defina GEMINI_API_KEY)'));
});
