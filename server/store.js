const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { P } = require('./engine');
const png = require('./png');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', '.data'));
const SEED_DIR = path.join(__dirname, '..', 'seed');
const MAX_SIGS = 40;
const JITTER = [[0, 0], [-2, -2], [2, 2], [0, -3], [0, 3], [-3, 0], [3, 0]];

const SETTINGS_PADRAO = {
  title: 'PKA Stone Reader',
  subtitle: 'Jogue a print da bag e receba a lista de pedras com as quantidades.',
  logo: '💎',
  accent: '#5b8cff',
  accent2: '#a76bff',
  bg: '#0b0e14',
  panel: '#141925',
  text: '#e8edf6',
  font: 'Poppins',
  radius: 14,
  aiAuto: true,
  publicContrib: true,
  tolerance: 0.16,
  aiDailyLimit: 500
};

let catalog = null;
let settings = null;
let cacheCatalogo = null;
const amostras = new Map();
const imagens = new Map();

function erro(status, msg) { const e = new Error(msg); e.status = status; return e; }
function arq() { return path.join.apply(null, [DATA_DIR].concat([].slice.call(arguments))); }
function lerJSON(f, padrao) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return padrao; } }
function gravarJSON(f, obj) {
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, f);
}
function novoId(p) { return p + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }
function r3(v) { return Math.round(v * 1000) / 1000; }
function arred(f) {
  return { shape: f.shape.map(r3), hue: f.hue.map(r3), grid: f.grid.map(r3), size: f.size.map(r3) };
}
function texto(v, max) {
  return String(v == null ? '' : v).split('').filter(ch => ch.charCodeAt(0) >= 32 && ch !== '<' && ch !== '>')
    .join('').trim().slice(0, max || 60);
}

function rotulo(l) {
  if (!l) return '';
  if (l.kind === 'ignore') return 'Ignorado';
  if (l.customName) return l.customName;
  return l.tier + ' ' + l.element + ' Stone';
}

function faixa(tier) {
  const t = catalog.tiers.find(x => x.name === tier);
  return t ? t.range : '';
}

function canonTier(t) {
  const alvo = String(t || '').trim().toLowerCase();
  const achado = (catalog ? catalog.tiers : P.TIERS).find(x => x.name.toLowerCase() === alvo);
  return achado ? achado.name : null;
}

function canonElemento(e) {
  const alvo = String(e || '').trim().toLowerCase();
  return P.ELEMENTS.find(x => x.toLowerCase() === alvo) || null;
}

function interpretarNome(nome) {
  const m = /^\s*(?:\d+\s+)?([A-Za-z]+)\s+([A-Za-z]+)(?:\s+stones?)?\s*(?:\([^)]*\))?\s*$/i.exec(String(nome || ''));
  if (!m) return null;
  const tier = canonTier(m[1]), element = canonElemento(m[2]);
  return tier && element ? { tier, element } : null;
}

function limparRotulo(l) {
  if (!l || typeof l !== 'object') return null;
  if (l.kind === 'ignore') return { kind: 'ignore', tier: '', element: '', customName: '' };
  const r = {
    kind: 'stone',
    tier: texto(l.tier, 30),
    element: texto(l.element, 30),
    customName: texto(l.customName, 60)
  };
  if (r.customName) {
    const p = interpretarNome(r.customName);
    if (p) return { kind: 'stone', tier: p.tier, element: p.element, customName: '' };
    r.tier = ''; r.element = '';
    return r;
  }
  if (!r.tier || !r.element) return null;
  r.tier = canonTier(r.tier) || r.tier;
  r.element = canonElemento(r.element) || r.element;
  return r;
}

function normalizarEntradas() {
  let mudou = false;
  const moverCelulas = (de, para) => {
    for (const s of amostras.values()) {
      let alterou = false;
      for (const c of s.cells) if (c.entryId === de.id) { c.entryId = para.id; c.label = limparRotulo(para); alterou = true; }
      if (alterou) salvarAmostra(s);
    }
  };
  for (const e of catalog.entries.slice()) {
    let alvo = null;
    if (e.kind === 'ignore') {
      alvo = catalog.entries.find(x => x.kind === 'ignore');
      if (alvo === e) continue;
    } else if (e.customName) {
      const p = interpretarNome(e.customName);
      if (!p) continue;
      alvo = catalog.entries.find(x => x !== e && x.kind === 'stone' && !x.customName &&
        x.tier === p.tier && x.element === p.element);
      if (!alvo) {
        e.tier = p.tier; e.element = p.element; e.customName = ''; e.range = faixa(p.tier);
        moverCelulas(e, e);
        mudou = true;
        continue;
      }
    } else continue;
    moverCelulas(e, alvo);
    alvo.manualSigs = (alvo.manualSigs || []).concat(e.manualSigs || []);
    if (!alvo.thumb && e.thumb) alvo.thumb = e.thumb;
    catalog.entries = catalog.entries.filter(x => x !== e);
    mudou = true;
  }
  return mudou;
}

function acharEntrada(l) {
  const alvo = rotulo(l);
  return catalog.entries.find(e => rotulo(e) === alvo) || null;
}

function garantirEntrada(l) {
  let e = acharEntrada(l);
  if (e) return e;
  e = {
    id: novoId('e'),
    kind: l.kind === 'ignore' ? 'ignore' : 'stone',
    tier: l.kind === 'ignore' ? '' : l.tier,
    element: l.kind === 'ignore' ? '' : l.element,
    customName: l.kind === 'ignore' ? 'Ignorado' : l.customName,
    range: '', thumb: '', sigs: [], manualSigs: []
  };
  if (e.kind === 'stone' && !e.customName) e.range = faixa(e.tier);
  catalog.entries.push(e);
  return e;
}

function addSig(e, feat) {
  const f = arred(feat);
  for (const s of e.sigs) if (P.featDist(s, f) < 0.03) return false;
  e.sigs.push(f);
  if (e.sigs.length > MAX_SIGS) e.sigs.splice(0, e.sigs.length - MAX_SIGS);
  return true;
}

function retangulo(g, r, c, dx, dy) {
  return { x: g.x + c * g.pw + (dx || 0), y: g.y + r * g.ph + (dy || 0), w: g.pw, h: g.ph };
}

function aprenderCelula(img, g, cell, e) {
  let base = null;
  for (const [dx, dy] of JITTER) {
    const res = P.analyzeCell(img, retangulo(g, cell.r, cell.c, dx, dy));
    if (!res || res.empty) continue;
    if (!dx && !dy) base = res;
    addSig(e, res.feat);
  }
  if (base && cell.qty > 0) P.learnDigits(base.digits.map(d => d.bmp), String(cell.qty));
  if (!e.thumb) e.thumb = png.dataURL(png.resize(img, retangulo(g, cell.r, cell.c), 52, 52));
}

function imagem(id) {
  if (imagens.has(id)) return imagens.get(id);
  const img = png.decode(fs.readFileSync(arq('prints', id + '.png')));
  imagens.set(id, img);
  if (imagens.size > 24) imagens.delete(imagens.keys().next().value);
  return img;
}

function limparGrade(g, img) {
  if (!g || typeof g !== 'object') throw erro(400, 'grade invalida');
  const n = k => { const v = Number(g[k]); if (!isFinite(v)) throw erro(400, 'grade invalida'); return v; };
  const out = {
    x: n('x'), y: n('y'), pw: n('pw'), ph: n('ph'),
    cols: Math.round(n('cols')), rows: Math.round(n('rows'))
  };
  if (out.pw < 8 || out.pw > 300 || out.ph < 8 || out.ph > 300) throw erro(400, 'grade invalida');
  if (out.cols < 1 || out.cols > 40 || out.rows < 1 || out.rows > 40) throw erro(400, 'grade invalida');
  if (img && (out.x > img.width || out.y > img.height)) throw erro(400, 'grade fora da imagem');
  return out;
}

function limparCelulas(cells, g) {
  if (!Array.isArray(cells)) throw erro(400, 'celulas invalidas');
  const vistas = new Set();
  return cells.slice(0, 400).map(c => {
    const r = Math.round(Number(c.r)), col = Math.round(Number(c.c));
    if (!(r >= 0 && r < g.rows && col >= 0 && col < g.cols)) return null;
    if (vistas.has(r + ':' + col)) return null;
    vistas.add(r + ':' + col);
    const q = c.qty === '' || c.qty == null ? null : Math.round(Number(c.qty));
    const ai = c.ai && typeof c.ai === 'object' ? {
      label: limparRotulo(c.ai.label),
      conf: Math.max(0, Math.min(1, Number(c.ai.conf) || 0))
    } : null;
    return {
      r, c: col,
      label: limparRotulo(c.label),
      entryId: null,
      qty: q != null && q >= 0 && q < 100000 ? q : null,
      ai: ai && ai.label ? ai : null,
      origem: ['catalogo', 'manual', 'ia', 'semente'].indexOf(c.origem) >= 0 ? c.origem : 'manual'
    };
  }).filter(Boolean);
}

function salvarAmostra(s) {
  amostras.set(s.id, s);
  gravarJSON(arq('samples', s.id + '.json'), s);
}

function listarAmostras(status) {
  const lista = Array.from(amostras.values());
  return (status ? lista.filter(s => s.status === status) : lista)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function amostra(id) {
  const s = amostras.get(String(id));
  if (!s) throw erro(404, 'amostra nao encontrada');
  return s;
}

function salvarCatalogo() {
  catalog.rev = (catalog.rev || 0) + 1;
  gravarJSON(arq('catalog.json'), catalog);
  cacheCatalogo = null;
}

function catalogoPublico() {
  if (!cacheCatalogo) {
    cacheCatalogo = JSON.stringify({
      rev: catalog.rev,
      sigVersion: catalog.sigVersion,
      tiers: catalog.tiers,
      digits: catalog.digits,
      entries: catalog.entries.map(e => ({
        id: e.id, kind: e.kind, tier: e.tier, element: e.element,
        customName: e.customName, range: e.range, thumb: e.thumb, sigs: e.sigs
      }))
    });
  }
  return cacheCatalogo;
}

function ajustarGrade(s, img) {
  if (s.gradeAjustada === P.SIG_VERSION) return;
  const g = P.refinarGrade(img, s.grid);
  s.grid = { x: g.x, y: g.y, pw: g.pw, ph: g.ph, cols: s.grid.cols, rows: s.grid.rows };
  s.gradeAjustada = P.SIG_VERSION;
  salvarAmostra(s);
}

function reconstruir() {
  for (const e of catalog.entries) e.sigs = (e.manualSigs || []).slice();
  P.digitClearAll();
  const aprovadas = listarAmostras('approved').sort((a, b) => a.createdAt - b.createdAt);
  for (const s of aprovadas) {
    let img;
    try { img = imagem(s.id); } catch (e) { continue; }
    ajustarGrade(s, img);
    for (const cell of s.cells) {
      if (!cell.entryId) continue;
      const e = catalog.entries.find(x => x.id === cell.entryId);
      if (e) aprenderCelula(img, s.grid, cell, e);
    }
  }
  catalog.digits = P.digitExport();
  catalog.sigVersion = P.SIG_VERSION;
  salvarCatalogo();
}

function criarAmostra(dados, fonte) {
  const buf = png.fromDataURL(dados.image);
  if (!buf) throw erro(400, 'imagem invalida');
  if (buf.length > 6 * 1024 * 1024) throw erro(413, 'imagem grande demais');
  let img;
  try { img = png.decode(buf); } catch (e) { throw erro(400, 'imagem invalida'); }
  const grid = limparGrade(dados.grid, img);
  const s = {
    id: novoId('s'),
    createdAt: Date.now(),
    status: 'pending',
    source: fonte,
    width: img.width,
    height: img.height,
    grid,
    cells: limparCelulas(dados.cells, grid),
    gradeAjustada: P.SIG_VERSION
  };
  fs.writeFileSync(arq('prints', s.id + '.png'), buf);
  imagens.set(s.id, img);
  salvarAmostra(s);
  return s;
}

function aprovar(id, dados) {
  const s = amostra(id);
  const jaAprovada = s.status === 'approved';
  if (dados && dados.grid) s.grid = limparGrade(dados.grid, imagem(s.id));
  if (dados && dados.cells) s.cells = limparCelulas(dados.cells, s.grid);
  const img = imagem(s.id);
  if (dados && dados.grid) s.gradeAjustada = P.SIG_VERSION;
  ajustarGrade(s, img);
  for (const cell of s.cells) {
    cell.label = limparRotulo(cell.label);
    if (!cell.label) { cell.entryId = null; continue; }
    const e = garantirEntrada(cell.label);
    cell.entryId = e.id;
    if (!jaAprovada) aprenderCelula(img, s.grid, cell, e);
  }
  s.status = 'approved';
  s.reviewedAt = Date.now();
  salvarAmostra(s);
  if (jaAprovada) reconstruir();
  else { catalog.digits = P.digitExport(); salvarCatalogo(); }
  return s;
}

function rejeitar(id) {
  const s = amostra(id);
  const eraAprovada = s.status === 'approved';
  s.status = 'rejected';
  s.reviewedAt = Date.now();
  salvarAmostra(s);
  if (eraAprovada) reconstruir();
  return s;
}

function excluirAmostra(id) {
  const s = amostra(id);
  amostras.delete(s.id);
  imagens.delete(s.id);
  try { fs.unlinkSync(arq('samples', s.id + '.json')); } catch (e) {}
  try { fs.unlinkSync(arq('prints', s.id + '.png')); } catch (e) {}
  if (s.status === 'approved') reconstruir();
}

function usosDaEntrada(id) {
  const out = [];
  for (const s of listarAmostras('approved')) {
    for (const c of s.cells) if (c.entryId === id) out.push({ sample: s.id, r: c.r, c: c.c, qty: c.qty, grid: s.grid });
  }
  return out;
}

function editarEntrada(id, dados) {
  const e = catalog.entries.find(x => x.id === id);
  if (!e) throw erro(404, 'pedra nao encontrada');
  const l = limparRotulo(dados);
  if (!l) throw erro(400, 'informe tier + elemento ou um nome');
  const outra = acharEntrada(l);
  if (outra && outra.id !== e.id) throw erro(409, 'ja existe uma pedra com esse nome - use Juntar');
  e.kind = l.kind; e.tier = l.tier; e.element = l.element;
  e.customName = l.kind === 'ignore' ? 'Ignorado' : l.customName;
  e.range = e.kind === 'stone' && !e.customName ? faixa(e.tier) : '';
  for (const s of listarAmostras()) {
    let mudou = false;
    for (const c of s.cells) if (c.entryId === e.id) { c.label = limparRotulo(e); mudou = true; }
    if (mudou) salvarAmostra(s);
  }
  salvarCatalogo();
  return e;
}

function juntarEntradas(de, para) {
  if (de === para) throw erro(400, 'escolha outra pedra');
  const a = catalog.entries.find(x => x.id === de), b = catalog.entries.find(x => x.id === para);
  if (!a || !b) throw erro(404, 'pedra nao encontrada');
  for (const s of listarAmostras()) {
    let mudou = false;
    for (const c of s.cells) if (c.entryId === a.id) { c.entryId = b.id; c.label = limparRotulo(b); mudou = true; }
    if (mudou) salvarAmostra(s);
  }
  b.manualSigs = (b.manualSigs || []).concat(a.manualSigs || []);
  catalog.entries = catalog.entries.filter(x => x.id !== a.id);
  reconstruir();
  return b;
}

function excluirEntrada(id) {
  const e = catalog.entries.find(x => x.id === id);
  if (!e) throw erro(404, 'pedra nao encontrada');
  for (const s of listarAmostras()) {
    let mudou = false;
    for (const c of s.cells) if (c.entryId === id) { c.entryId = null; c.label = null; mudou = true; }
    if (mudou) salvarAmostra(s);
  }
  catalog.entries = catalog.entries.filter(x => x.id !== id);
  reconstruir();
}

function desrotularCelula(sampleId, r, c) {
  const s = amostra(sampleId);
  const cell = s.cells.find(x => x.r === Number(r) && x.c === Number(c));
  if (!cell) throw erro(404, 'celula nao encontrada');
  cell.entryId = null; cell.label = null;
  salvarAmostra(s);
  if (s.status === 'approved') reconstruir();
}

function salvarTiers(lista) {
  if (!Array.isArray(lista)) throw erro(400, 'lista invalida');
  const limpa = lista.map(t => ({ name: texto(t && t.name, 30), range: texto(t && t.range, 40) }))
    .filter(t => t.name);
  if (!limpa.length) throw erro(400, 'lista vazia');
  catalog.tiers = limpa;
  for (const e of catalog.entries) if (e.kind === 'stone' && !e.customName) e.range = faixa(e.tier);
  salvarCatalogo();
  return catalog.tiers;
}

function importar(obj) {
  if (!obj || !Array.isArray(obj.entries)) throw erro(400, 'arquivo invalido');
  const compativel = (obj.sigVersion || 1) === P.SIG_VERSION;
  let novas = 0, somadas = 0;
  for (const src of obj.entries) {
    const l = src.kind === 'ignore' ? { kind: 'ignore' } : limparRotulo(src);
    if (!l) continue;
    let e = catalog.entries.find(x => x.id === src.id) || acharEntrada(l);
    if (!e) { e = garantirEntrada(l); novas++; }
    if (!e.thumb && typeof src.thumb === 'string' && src.thumb.startsWith('data:image/png;base64,')) e.thumb = src.thumb;
    if (compativel && Array.isArray(src.sigs)) {
      e.manualSigs = e.manualSigs || [];
      for (const s of src.sigs) {
        if (!s || !Array.isArray(s.shape)) continue;
        if (e.manualSigs.some(o => P.featDist(o, s) < 0.03)) continue;
        e.manualSigs.push(arred(s));
        somadas++;
      }
      if (e.manualSigs.length > MAX_SIGS) e.manualSigs = e.manualSigs.slice(-MAX_SIGS);
    }
  }
  reconstruir();
  if (compativel && obj.digits) { P.digitImport(obj.digits); catalog.digits = P.digitExport(); salvarCatalogo(); }
  return { novas, somadas, compativel };
}

function exportar() {
  return {
    version: 1,
    sigVersion: catalog.sigVersion,
    savedAt: new Date().toISOString(),
    tiers: catalog.tiers,
    digits: catalog.digits,
    entries: catalog.entries.map(e => ({
      id: e.id, kind: e.kind, tier: e.tier, element: e.element, customName: e.customName,
      range: e.range, thumb: e.thumb, sigs: e.sigs
    }))
  };
}

function estatisticas() {
  const todas = listarAmostras();
  let comIA = 0, iaCerta = 0;
  for (const s of todas) {
    if (s.status !== 'approved') continue;
    for (const c of s.cells) {
      if (!c.ai || !c.label) continue;
      comIA++;
      if (rotulo(c.ai.label) === rotulo(c.label)) iaCerta++;
    }
  }
  return {
    entradas: catalog.entries.length,
    amostras: catalog.entries.reduce((n, e) => n + e.sigs.length, 0),
    aprovadas: todas.filter(s => s.status === 'approved').length,
    pendentes: todas.filter(s => s.status === 'pending').length,
    rejeitadas: todas.filter(s => s.status === 'rejected').length,
    ia: { avaliadas: comIA, certas: iaCerta },
    digitos: Object.keys(catalog.digits || {}).sort().join('')
  };
}

function getSettings() { return Object.assign({}, SETTINGS_PADRAO, settings); }

function salvarSettings(novo) {
  const s = getSettings();
  const cor = v => /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
  const out = {};
  if (novo.title != null) out.title = texto(novo.title, 60) || SETTINGS_PADRAO.title;
  if (novo.subtitle != null) out.subtitle = texto(novo.subtitle, 160);
  if (novo.logo != null) out.logo = texto(novo.logo, 8) || SETTINGS_PADRAO.logo;
  for (const k of ['accent', 'accent2', 'bg', 'panel', 'text']) if (novo[k] != null && cor(novo[k])) out[k] = novo[k];
  if (novo.font != null) out.font = texto(novo.font, 40).replace(/[^A-Za-z0-9 ]/g, '') || SETTINGS_PADRAO.font;
  if (novo.radius != null) out.radius = Math.max(0, Math.min(28, Math.round(Number(novo.radius) || 0)));
  if (novo.aiAuto != null) out.aiAuto = !!novo.aiAuto;
  if (novo.publicContrib != null) out.publicContrib = !!novo.publicContrib;
  if (novo.tolerance != null) out.tolerance = Math.max(0.04, Math.min(0.4, Number(novo.tolerance) || 0.16));
  if (novo.aiDailyLimit != null) out.aiDailyLimit = Math.max(0, Math.min(100000, Math.round(Number(novo.aiDailyLimit) || 0)));
  settings = Object.assign({}, settings, out);
  gravarJSON(arq('settings.json'), settings);
  return Object.assign(s, out);
}

function restaurarAparencia() {
  const manter = {};
  for (const k of ['aiAuto', 'publicContrib', 'tolerance', 'aiDailyLimit']) if (settings && settings[k] != null) manter[k] = settings[k];
  settings = manter;
  gravarJSON(arq('settings.json'), settings);
  return getSettings();
}

function segredo() {
  const f = arq('secret.key');
  try { return fs.readFileSync(f, 'utf8'); } catch (e) {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, s);
    return s;
  }
}

function semear() {
  const base = lerJSON(path.join(SEED_DIR, 'catalog.json'), {}) || {};
  catalog = {
    rev: 0,
    sigVersion: P.SIG_VERSION,
    tiers: Array.isArray(base.tiers) && base.tiers.length ? base.tiers : P.TIERS,
    digits: {},
    entries: (base.entries || []).map(e => ({
      id: e.id, kind: e.kind || 'stone', tier: e.tier || '', element: e.element || '',
      customName: e.customName || '', range: e.range || '', thumb: e.thumb || '',
      sigs: [], manualSigs: []
    }))
  };
  const defs = lerJSON(path.join(SEED_DIR, 'samples.json'), []);
  let t = Date.now() - defs.length * 1000;
  for (const d of defs) {
    let buf, img;
    try { buf = fs.readFileSync(path.join(SEED_DIR, 'prints', d.file)); img = png.decode(buf); } catch (e) { continue; }
    const g = P.detectGrid(img, null);
    if (!g) continue;
    const cells = [];
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const rect = retangulo(g, r, c);
        if (rect.x + rect.w > img.width || rect.y + rect.h > img.height) continue;
        const res = P.analyzeCell(img, rect);
        if (res && !res.empty) cells.push({ r, c, label: null, entryId: null, qty: null, ai: null, origem: 'semente' });
      }
    }
    const s = {
      id: novoId('s'), createdAt: t++, status: 'pending', source: 'semente',
      width: img.width, height: img.height,
      grid: { x: g.x, y: g.y, pw: g.pw, ph: g.ph, cols: g.cols, rows: g.rows },
      cells
    };
    if (Array.isArray(d.labels) && d.labels.length === cells.length) {
      cells.forEach((cell, i) => {
        const [tier, element, qty] = d.labels[i];
        cell.label = { kind: 'stone', tier, element, customName: '' };
        cell.qty = qty;
        cell.entryId = garantirEntrada(cell.label).id;
      });
      s.status = 'approved';
    }
    fs.writeFileSync(arq('prints', s.id + '.png'), buf);
    salvarAmostra(s);
  }
  reconstruir();
}

function iniciar() {
  for (const d of ['', 'prints', 'samples']) fs.mkdirSync(arq(d), { recursive: true });
  for (const f of fs.readdirSync(arq('samples'))) {
    if (!f.endsWith('.json')) continue;
    const s = lerJSON(arq('samples', f), null);
    if (s && s.id) amostras.set(s.id, s);
  }
  settings = lerJSON(arq('settings.json'), {}) || {};
  catalog = lerJSON(arq('catalog.json'), null);
  if (!catalog) { semear(); return; }
  for (const e of catalog.entries) { e.sigs = e.sigs || []; e.manualSigs = e.manualSigs || []; }
  for (const s of amostras.values()) {
    let alterou = false;
    for (const c of s.cells) {
      if (!c.label) continue;
      const antes = JSON.stringify(c.label);
      c.label = limparRotulo(c.label);
      if (JSON.stringify(c.label) !== antes) alterou = true;
    }
    if (alterou) salvarAmostra(s);
  }
  if (normalizarEntradas() || catalog.sigVersion !== P.SIG_VERSION) { reconstruir(); return; }
  P.digitClearAll();
  if (catalog.digits) P.digitImport(catalog.digits);
}

module.exports = {
  DATA_DIR, iniciar, segredo, erro,
  catalogoPublico, rev: () => catalog.rev,
  entradas: () => catalog.entries,
  getSettings, salvarSettings, restaurarAparencia,
  criarAmostra, aprovar, rejeitar, excluirAmostra, listarAmostras, amostra, imagem,
  arquivoPrint: id => arq('prints', String(id).replace(/[^a-z0-9]/gi, '') + '.png'),
  usosDaEntrada, editarEntrada, juntarEntradas, excluirEntrada, desrotularCelula,
  salvarTiers, importar, exportar, estatisticas, reconstruir, rotulo
};
