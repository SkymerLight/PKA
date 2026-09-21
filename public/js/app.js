(function (P) {
  'use strict';

  const Cat = P.Catalog;
  Cat.save = function () {};

  const $ = id => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d', { willReadFrequently: true });

  const CORES = {
    Normal: '#A8A77A', Fire: '#EE8130', Water: '#6390F0', Electric: '#F7D02C', Grass: '#7AC74C',
    Ice: '#96D9D6', Fighting: '#C22E28', Poison: '#A33EA1', Ground: '#E2BF65', Flying: '#A98FF3',
    Psychic: '#F95587', Bug: '#A6B91A', Rock: '#B6A136', Ghost: '#735797', Dragon: '#6F35FC',
    Dark: '#705746', Steel: '#B7B7CE', Fairy: '#D685AD', Neutral: '#9aa3ad'
  };
  const APELIDOS = {
    Normal: 'normal', Fire: 'fogo', Water: 'agua', Electric: 'eletrico eletrica', Grass: 'planta grama',
    Ice: 'gelo', Fighting: 'lutador luta', Poison: 'veneno venenoso', Ground: 'terra', Flying: 'voador',
    Psychic: 'psiquico', Bug: 'inseto', Rock: 'rocha pedra', Ghost: 'fantasma', Dragon: 'dragao',
    Dark: 'sombrio noturno', Steel: 'aco metal', Fairy: 'fada', Neutral: 'neutro'
  };
  const COR_ESTADO = { ok: '#3fd08a', man: '#4ea3ff', ia: '#b87bff', q: '#f5c451', no: '#ff6b6b', ig: '#6b7686' };

  const S = {
    me: { admin: false, ai: false, adminConfigured: false },
    settings: {}, rev: 0,
    images: [], active: -1, tol: 0.16,
    mode: null, dragging: null, hover: null, review: null
  };

  const api = {
    async req(metodo, url, corpo) {
      const r = await fetch(url, {
        method: metodo,
        headers: corpo !== undefined ? { 'content-type': 'application/json' } : {},
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        credentials: 'same-origin'
      });
      const txt = await r.text();
      let d = null;
      try { d = txt ? JSON.parse(txt) : null; } catch (e) {}
      if (!r.ok) { const e = new Error((d && d.error) || ('erro ' + r.status)); e.status = r.status; throw e; }
      return d;
    },
    get: u => api.req('GET', u),
    post: (u, b) => api.req('POST', u, b || {}),
    put: (u, b) => api.req('PUT', u, b || {}),
    del: u => api.req('DELETE', u)
  };

  let toastT = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 3200);
  }

  let statusT = null;
  function status(t) {
    $('status').textContent = t || '';
    clearTimeout(statusT);
    if (t) statusT = setTimeout(() => { $('status').textContent = ''; }, 6000);
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').split('')
      .filter(ch => { const c = ch.charCodeAt(0); return c < 0x300 || c > 0x36f; }).join('');
  }

  function rot(l) {
    if (!l) return '';
    if (l.kind === 'ignore') return 'Ignorado';
    if (l.customName) return l.customName;
    return l.tier + ' ' + l.element + ' Stone';
  }
  function lbl(e) {
    return {
      kind: e.kind === 'ignore' ? 'ignore' : 'stone',
      tier: e.kind === 'ignore' ? '' : (e.tier || ''),
      element: e.kind === 'ignore' ? '' : (e.element || ''),
      customName: e.kind === 'ignore' ? '' : (e.customName || '')
    };
  }
  function corDe(l) { return l && CORES[l.element] ? CORES[l.element] : 'var(--line)'; }

  function aplicarSettings(s) {
    S.settings = s;
    const r = document.documentElement.style;
    r.setProperty('--acc', s.accent);
    r.setProperty('--acc2', s.accent2);
    r.setProperty('--bg', s.bg);
    r.setProperty('--panel', s.panel);
    r.setProperty('--tx', s.text);
    r.setProperty('--radius', s.radius + 'px');
    r.setProperty('--font', "'" + s.font + "',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif");
    const fam = encodeURIComponent(s.font).replace(/%20/g, '+');
    const href = 'https://fonts.googleapis.com/css2?family=' + fam +
      (s.font === 'Press Start 2P' ? '' : ':wght@400;500;600;700') + '&display=swap';
    if ($('fontLink').getAttribute('href') !== href) $('fontLink').setAttribute('href', href);
    $('siteTitle').textContent = s.title;
    $('siteSubtitle').textContent = s.subtitle;
    $('logo').textContent = s.logo;
    document.title = s.title;
    if (!S.tolManual) {
      S.tol = s.tolerance;
      $('thr').value = S.tol;
      $('thrv').textContent = S.tol.toFixed(2);
    }
  }

  async function carregarCatalogo() {
    const d = await api.get('/api/catalog');
    if (Array.isArray(d.tiers) && d.tiers.length) P.TIERS = d.tiers;
    Cat.entries = (d.entries || []).map(e => Object.assign(e, { sigs: e.sigs || [] }));
    P.digitClearAll();
    P.digitImport(d.digits || {});
    S.rev = d.rev;
    opcoesCache = null;
    S.images.forEach(im => (im.cells || []).forEach(c => {
      if (!c.empty && c.qtySrc !== 'manual' && c.qtySrc !== 'ia') lerQtd(c);
    }));
    rematchAll();
    renderTudo();
    if (window.PKAAdmin) window.PKAAdmin.catalogoMudou();
  }

  function lerQtd(c) {
    const d = P.readDigits(c.res.digits);
    if (d) { c.qty = String(parseInt(d.text, 10)); c.qtySrc = 'auto'; }
  }

  function readFiles(files) {
    const lista = Array.prototype.slice.call(files).filter(f => f && /^image\//.test(f.type));
    if (!lista.length) return;
    let pendentes = lista.length;
    lista.forEach(f => {
      const url = URL.createObjectURL(f);
      const im = new Image();
      im.onload = () => {
        adicionarImagem(im, f.name || 'print.png');
        URL.revokeObjectURL(url);
        if (--pendentes === 0) prepararTodas();
      };
      im.onerror = () => {
        URL.revokeObjectURL(url);
        toast('Nao consegui abrir ' + (f.name || 'a imagem'));
        if (--pendentes === 0) prepararTodas();
      };
      im.src = url;
    });
  }

  function adicionarImagem(el, nome, extra) {
    const c = document.createElement('canvas');
    c.width = el.naturalWidth; c.height = el.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(el, 0, 0);
    const im = Object.assign({
      name: nome, el, canvas: c, w: c.width, h: c.height,
      data: g.getImageData(0, 0, c.width, c.height), grid: null, region: null, mark: null, cells: []
    }, extra || {});
    S.images.push(im);
    return im;
  }

  function prepararTodas() {
    const pend = S.images.filter(im => !im.cells.length && !im.falhou);
    $('work').classList.remove('hidden');
    $('drop').classList.add('compacta');
    if (!pend.length) { setActive(S.images.length - 1); return; }
    status('analisando ' + pend.length + ' imagem(ns)...');
    let i = 0;
    (function passo() {
      if (i >= pend.length) {
        rematchAll();
        setActive(S.images.length - 1);
        status(S.images.length + ' imagem(ns) prontas');
        if (S.settings.aiAuto && S.me.ai) pend.forEach(im => perguntarIA(im, false));
        return;
      }
      const im = pend[i++];
      setTimeout(() => {
        if (!im.grid) im.grid = P.detectGrid(im.data, im.region);
        if (!im.grid) { im.falhou = true; } else analisarImagem(im);
        passo();
      }, 5);
    })();
  }

  function retangulo(g, r, c) { return { x: g.x + c * g.pw, y: g.y + r * g.ph, w: g.pw, h: g.ph }; }

  function analisarImagem(im) {
    const g = im.grid, antigas = new Map();
    (im.cells || []).forEach(c => antigas.set(c.r + ':' + c.c, c));
    const cells = [];
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const rect = retangulo(g, r, c);
        if (rect.x + rect.w > im.w + 1 || rect.y + rect.h > im.h + 1) continue;
        const res = P.analyzeCell(im.data, rect);
        if (!res) continue;
        const velho = antigas.get(r + ':' + c);
        const cell = {
          r, c, rect, res, empty: !!res.empty, feat: res.feat || null,
          qty: '', qtySrc: '', match: null, incerto: false,
          manual: velho ? velho.manual : null, ai: velho ? velho.ai : null
        };
        if (velho && velho.qtySrc === 'manual') { cell.qty = velho.qty; cell.qtySrc = 'manual'; }
        if (!cell.empty && !cell.qty) lerQtd(cell);
        if (!cell.empty && !cell.qty && cell.ai && cell.ai.qty != null) { cell.qty = String(cell.ai.qty); cell.qtySrc = 'ia'; }
        cells.push(cell);
      }
    }
    if (im.presets) {
      cells.forEach(c => {
        const p = im.presets.get(c.r + ':' + c.c);
        if (!p) return;
        if (p.label) c.manual = p.label;
        if (p.qty != null) { c.qty = String(p.qty); c.qtySrc = 'manual'; }
        if (p.ai) c.ai = { label: p.ai.label, conf: p.ai.conf, qty: null };
      });
      im.presets = null;
    }
    im.cells = cells;
  }

  function casar(c) {
    if (c.empty || !c.feat) return;
    const m = Cat.match(c.feat, S.tol);
    c.match = m;
    c.incerto = false;
    if (m && m.entry && m.alts && m.alts.length > 1) {
      const margem = m.alts[1].dist - m.alts[0].dist;
      if (margem < 0.025 && m.dist > 0.05) c.incerto = true;
    }
  }

  function rematchAll() { S.images.forEach(im => (im.cells || []).forEach(casar)); }

  function final(c) {
    if (c.manual) return { label: c.manual, fonte: 'manual' };
    if (c.match && c.match.entry && !c.incerto) return { label: lbl(c.match.entry), fonte: 'catalogo', entry: c.match.entry };
    if (c.ai && c.ai.label) return { label: c.ai.label, fonte: 'ia' };
    if (c.match && c.match.entry) return { label: lbl(c.match.entry), fonte: 'incerto', entry: c.match.entry };
    return null;
  }

  function estado(c) {
    const f = final(c);
    if (!f) return 'no';
    if (f.label.kind === 'ignore') return 'ig';
    return { manual: 'man', catalogo: 'ok', ia: 'ia', incerto: 'q' }[f.fonte];
  }

  function cur() { return S.images[S.active] || null; }

  function setActive(i) {
    if (i < 0 || i >= S.images.length) return;
    S.active = i;
    const im = cur();
    cv.width = im.w; cv.height = im.h;
    cv.style.maxWidth = Math.round(im.w * (im.w < 420 ? 2 : 1)) + 'px';
    renderStrip();
    if (im.grid) preencherGrade(im.grid);
    if (im.falhou && !im.grid) {
      status('nao achei a grade nesta print - use Marcar grade');
      $('gridbox').classList.remove('hidden');
    }
    renderTudo();
  }

  function renderStrip() {
    const box = $('strip');
    box.innerHTML = '';
    if (S.images.length < 2) return;
    S.images.forEach((im, i) => {
      const d = document.createElement('button');
      d.className = 'th' + (i === S.active ? ' on' : '');
      d.title = im.name;
      const img = document.createElement('img');
      img.src = im.el.src;
      img.alt = '';
      d.appendChild(img);
      d.addEventListener('click', () => setActive(i));
      box.appendChild(d);
    });
  }

  function preencherGrade(g) {
    const r = v => Math.round(v * 100) / 100;
    $('gx').value = r(g.x); $('gy').value = r(g.y);
    $('gpx').value = r(g.pw); $('gpy').value = r(g.ph);
    $('gcols').value = g.cols; $('grows').value = g.rows;
  }

  function reanalisar(im) {
    analisarImagem(im);
    (im.cells || []).forEach(casar);
    renderTudo();
    if (S.settings.aiAuto && S.me.ai) perguntarIA(im, false);
  }

  function lerGrade() {
    const im = cur();
    if (!im) return;
    im.mark = null;
    im.grid = {
      x: +$('gx').value || 0, y: +$('gy').value || 0,
      pw: Math.max(8, +$('gpx').value || 32), ph: Math.max(8, +$('gpy').value || 32),
      cols: Math.max(1, Math.round(+$('gcols').value || 1)), rows: Math.max(1, Math.round(+$('grows').value || 1))
    };
    reanalisar(im);
  }

  function aplicarMarca() {
    const im = cur();
    if (!im || !im.mark) return;
    const cols = Math.max(1, Math.round(+$('gcols').value || 1));
    const rows = Math.max(1, Math.round(+$('grows').value || 1));
    im.grid = { x: im.mark.x, y: im.mark.y, pw: im.mark.w / cols, ph: im.mark.h / rows, cols, rows };
    preencherGrade(im.grid);
    reanalisar(im);
  }

  function drawCanvas() {
    const im = cur();
    if (!im) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im.el, 0, 0);
    (im.cells || []).forEach(c => {
      if (c.empty) return;
      const st = estado(c);
      ctx.strokeStyle = COR_ESTADO[st];
      ctx.lineWidth = c === S.hover ? 3 : 1.6;
      ctx.strokeRect(c.rect.x + 1, c.rect.y + 1, c.rect.w - 2, c.rect.h - 2);
      if (c === S.hover) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(c.rect.x + 1, c.rect.y + 1, c.rect.w - 2, c.rect.h - 2);
      }
    });
    if (S.dragging) {
      const d = S.dragging;
      ctx.strokeStyle = '#5b8cff'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(d.x, d.y, d.w, d.h);
      ctx.setLineDash([]);
    }
  }

  function posCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) };
  }

  function celulaEm(p) {
    const im = cur();
    if (!im) return null;
    return (im.cells || []).find(c => !c.empty && p.x >= c.rect.x && p.x < c.rect.x + c.rect.w &&
      p.y >= c.rect.y && p.y < c.rect.y + c.rect.h) || null;
  }

  function miniatura(im, rect, tam) {
    const c = document.createElement('canvas');
    c.width = tam; c.height = tam;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = tam > rect.w * 1.5 ? false : true;
    g.drawImage(im.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, tam, tam);
    return c;
  }

  function renderTudo() {
    drawCanvas();
    renderItens();
    renderRelatorio();
  }

  function renderItens() {
    const im = cur(), box = $('items');
    box.innerHTML = '';
    const itens = im ? (im.cells || []).filter(c => !c.empty) : [];
    $('itemsCard').classList.toggle('hidden', !itens.length);
    if (!itens.length) return;
    const cont = { ok: 0, man: 0, ia: 0, q: 0, no: 0, ig: 0 };
    itens.forEach((c, k) => {
      cont[estado(c)]++;
      box.appendChild(linhaItem(im, c, k));
    });
    const partes = [itens.length + ' itens'];
    if (cont.no) partes.push(cont.no + ' desconhecido(s)');
    if (cont.q) partes.push(cont.q + ' para conferir');
    if (cont.ia) partes.push(cont.ia + ' pela IA');
    $('itemsInfo').textContent = '- ' + partes.join(' - ');
    $('btnAI').classList.toggle('hidden', !S.me.ai);
    const podeEnviar = S.me.admin || S.settings.publicContrib;
    $('btnSave').classList.toggle('hidden', !podeEnviar);
    $('btnSave').textContent = S.review ? 'Aprovar e ensinar' : (S.me.admin ? 'Salvar e ensinar' : 'Enviar correções');
  }

  function linhaItem(im, c, k) {
    const st = estado(c), f = final(c);
    const el = document.createElement('div');
    el.className = 'item st-' + st;
    el.dataset.k = k;
    el.appendChild(miniatura(im, c.rect, 52));

    const main = document.createElement('div');
    main.className = 'it-main';
    const top = document.createElement('div');
    top.className = 'it-top';
    const pos = document.createElement('span');
    pos.textContent = 'L' + (c.r + 1) + ' · C' + (c.c + 1);
    top.appendChild(pos);
    if (f && f.fonte === 'ia') top.appendChild(tag('IA ' + Math.round((c.ai.conf || 0) * 100) + '%', 'ia'));
    if (st === 'q') top.appendChild(tag('confira', 'q'));
    if (f && f.fonte === 'manual') top.appendChild(tag('você', ''));
    if (f && f.label.kind === 'stone' && !f.label.customName) {
      const faixa = P.rangeOf(f.label.tier);
      if (faixa) top.appendChild(tag(faixa, ''));
    }
    main.appendChild(top);

    const combo = document.createElement('div');
    combo.className = 'combo';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = f ? corDe(f.label) : 'var(--no)';
    const inp = document.createElement('input');
    inp.className = 'nm';
    inp.value = f ? rot(f.label) : '';
    inp.placeholder = 'Não identificada - digite o nome';
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('spellcheck', 'false');
    combo.appendChild(dot);
    combo.appendChild(inp);
    main.appendChild(combo);
    ligarCombo(inp, c);
    el.appendChild(main);

    const q = document.createElement('label');
    q.className = 'it-qty';
    q.textContent = 'Qtd';
    const qi = document.createElement('input');
    qi.inputMode = 'numeric';
    qi.value = c.qty;
    if (c.qtySrc === 'ia') { qi.classList.add('src-ia'); qi.title = 'lida pela IA'; }
    qi.addEventListener('change', () => {
      const v = qi.value.replace(/[^0-9]/g, '');
      c.qty = v ? String(parseInt(v, 10)) : '';
      c.qtySrc = c.qty ? 'manual' : '';
      qi.classList.remove('src-ia');
      renderRelatorio();
    });
    q.appendChild(qi);
    el.appendChild(q);

    if ((st === 'no' || st === 'q') && c.match && c.match.alts) {
      const alts = document.createElement('div');
      alts.className = 'alts';
      c.match.alts.filter(a => a.dist <= 0.4).forEach(a => {
        const b = document.createElement('button');
        b.textContent = Cat.label(a.entry) + ' · ' + a.dist.toFixed(2);
        b.addEventListener('click', () => escolher(c, lbl(a.entry)));
        alts.appendChild(b);
      });
      if (alts.children.length) el.appendChild(alts);
    }

    el.addEventListener('mouseenter', () => { S.hover = c; drawCanvas(); });
    el.addEventListener('mouseleave', () => { if (S.hover === c) { S.hover = null; drawCanvas(); } });
    return el;
  }

  function tag(t, cls) {
    const s = document.createElement('span');
    s.className = 'tag ' + (cls || '');
    s.textContent = t;
    return s;
  }

  function escolher(c, label, focarProximo) {
    c.manual = label;
    renderItens();
    renderRelatorio();
    drawCanvas();
    if (focarProximo) {
      const im = cur();
      const itens = im.cells.filter(x => !x.empty);
      const i = itens.indexOf(c);
      const prox = itens.slice(i + 1).find(x => ['no', 'q'].indexOf(estado(x)) >= 0);
      if (prox) {
        const alvo = $('items').querySelector('.item[data-k="' + itens.indexOf(prox) + '"] input.nm');
        if (alvo) { alvo.focus(); alvo.select(); }
      }
    }
  }

  let opcoesCache = null;
  function opcoes() {
    if (opcoesCache) return opcoesCache;
    const vistos = new Set(), out = [];
    Cat.entries.forEach(e => {
      const l = lbl(e), k = rot(l);
      if (vistos.has(k) || l.kind === 'ignore') return;
      vistos.add(k);
      out.push({ label: l, texto: k, thumb: e.thumb, conhecida: true, busca: norm(k + ' ' + (APELIDOS[l.element] || '')) });
    });
    P.TIERS.forEach(t => P.ELEMENTS.forEach(el => {
      const l = { kind: 'stone', tier: t.name, element: el, customName: '' }, k = rot(l);
      if (vistos.has(k)) return;
      vistos.add(k);
      out.push({ label: l, texto: k, busca: norm(k + ' ' + (APELIDOS[el] || '')) });
    }));
    out.push({ label: { kind: 'ignore', tier: '', element: '', customName: '' }, texto: 'Ignorar este slot', busca: 'ignorar ignorado vazio nada', especial: true });
    opcoesCache = out;
    return out;
  }

  const DD = { alvo: null, cell: null, lista: [], sel: 0, livre: '' };

  function ligarCombo(inp, c) {
    inp.addEventListener('focus', () => { inp.select(); abrirDD(inp, c, ''); });
    inp.addEventListener('input', () => abrirDD(inp, c, inp.value));
    inp.addEventListener('keydown', e => {
      if ($('dd').classList.contains('hidden') && e.key === 'ArrowDown') { abrirDD(inp, c, ''); e.preventDefault(); return; }
      if (e.key === 'ArrowDown') { DD.sel = Math.min(DD.lista.length - 1, DD.sel + 1); pintarDD(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { DD.sel = Math.max(0, DD.sel - 1); pintarDD(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const op = DD.lista[DD.sel];
        if (op) confirmarDD(op, true);
      } else if (e.key === 'Escape') { fecharDD(); inp.blur(); }
    });
    inp.addEventListener('blur', () => setTimeout(() => {
      if (DD.alvo === inp) {
        fecharDD();
        const f = final(c);
        inp.value = f ? rot(f.label) : '';
      }
    }, 160));
  }

  function abrirDD(inp, c, q) {
    DD.alvo = inp; DD.cell = c; DD.sel = 0;
    const tokens = norm(q).split(/\s+/).filter(Boolean);
    let lista = opcoes().filter(o => tokens.every(t => o.busca.indexOf(t) >= 0));
    lista.sort((a, b) => (b.conhecida ? 1 : 0) - (a.conhecida ? 1 : 0));
    lista = lista.slice(0, 60);
    DD.livre = q.trim();
    if (DD.livre && !lista.some(o => norm(o.texto) === norm(DD.livre))) {
      lista.push({ label: { kind: 'stone', tier: '', element: '', customName: DD.livre.slice(0, 60) }, texto: 'Usar como nome livre: "' + DD.livre + '"', especial: true });
    }
    DD.lista = lista;
    pintarDD();
    posicionarDD();
  }

  function pintarDD() {
    const dd = $('dd');
    dd.innerHTML = '';
    if (!DD.lista.length) {
      const v = document.createElement('div');
      v.className = 'vazio';
      v.textContent = 'Nada encontrado';
      dd.appendChild(v);
    }
    let secao = null;
    DD.lista.forEach((o, i) => {
      const s = o.conhecida ? 'Já cadastradas' : (o.especial ? 'Outros' : 'Todas as combinações');
      if (s !== secao) {
        secao = s;
        const h = document.createElement('div');
        h.className = 'sep';
        h.textContent = s;
        dd.appendChild(h);
      }
      const op = document.createElement('div');
      op.className = 'op' + (i === DD.sel ? ' sel' : '');
      op.setAttribute('role', 'option');
      if (o.thumb) {
        const img = document.createElement('img');
        img.src = o.thumb; img.alt = '';
        op.appendChild(img);
      } else {
        const ph = document.createElement('span');
        ph.className = 'ph';
        const b = document.createElement('i');
        b.style.background = o.label.kind === 'ignore' ? 'var(--ig)' : corDe(o.label);
        ph.appendChild(b);
        op.appendChild(ph);
      }
      const t = document.createElement('span');
      t.textContent = o.texto;
      op.appendChild(t);
      if (o.label.kind === 'stone' && o.label.tier) {
        const sm = document.createElement('small');
        sm.textContent = P.rangeOf(o.label.tier);
        op.appendChild(sm);
      }
      op.addEventListener('mousedown', e => { e.preventDefault(); confirmarDD(o, true); });
      dd.appendChild(op);
      if (i === DD.sel) setTimeout(() => op.scrollIntoView({ block: 'nearest' }), 0);
    });
    dd.classList.remove('hidden');
  }

  function posicionarDD() {
    if (!DD.alvo) return;
    const r = DD.alvo.getBoundingClientRect(), dd = $('dd');
    const abaixo = window.innerHeight - r.bottom;
    dd.style.left = Math.min(r.left, window.innerWidth - 300) + 'px';
    dd.style.width = Math.max(r.width, 280) + 'px';
    if (abaixo < 240 && r.top > abaixo) { dd.style.top = ''; dd.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
    else { dd.style.bottom = ''; dd.style.top = (r.bottom + 4) + 'px'; }
  }

  function confirmarDD(o, proximo) {
    const c = DD.cell;
    fecharDD();
    if (c) escolher(c, o.label, proximo);
  }

  function fecharDD() {
    $('dd').classList.add('hidden');
    DD.alvo = null; DD.cell = null;
  }

  window.addEventListener('resize', posicionarDD);
  window.addEventListener('scroll', posicionarDD, true);

  function relatorio(somar) {
    const imgs = somar ? S.images : [cur()];
    const ordem = [], mapa = {}, desc = [], semQtd = [];
    let porIA = 0, conferir = 0;
    imgs.forEach(im => {
      if (!im) return;
      (im.cells || []).forEach(c => {
        if (c.empty) return;
        const onde = (imgs.length > 1 ? im.name + ': ' : '') + 'L' + (c.r + 1) + ' C' + (c.c + 1);
        const f = final(c);
        if (!f) { desc.push(onde); return; }
        if (f.label.kind === 'ignore') return;
        if (f.fonte === 'ia') porIA++;
        if (f.fonte === 'incerto') conferir++;
        const k = rot(f.label);
        const q = c.qty === '' ? null : parseInt(c.qty, 10);
        if (q === null) semQtd.push(onde);
        if (!mapa[k]) { mapa[k] = { label: f.label, qty: 0, algum: false }; ordem.push(k); }
        if (q !== null) { mapa[k].qty += q; mapa[k].algum = true; }
      });
    });
    const linhas = ordem.map(k => {
      const m = mapa[k];
      return Cat.line({ tier: m.label.tier, element: m.label.element, customName: m.label.customName, range: '' },
        m.algum ? m.qty : null);
    });
    const aviso = [];
    if (desc.length) aviso.push('Sem nome (' + desc.length + '): ' + desc.join(', '));
    if (semQtd.length) aviso.push('Sem quantidade (' + semQtd.length + '): ' + semQtd.join(', '));
    if (porIA) aviso.push(porIA + ' item(ns) identificado(s) pela IA - confira os roxos.');
    if (conferir) aviso.push(conferir + ' item(ns) com reconhecimento incerto - confira os amarelos.');
    return { texto: linhas.join('\n'), aviso: aviso.join('\n'), n: linhas.length };
  }

  function renderRelatorio() {
    const r = relatorio($('sumAll').checked);
    $('output').textContent = r.texto || 'Nada identificado ainda.';
    $('reportCount').textContent = r.n ? r.n + ' linha(s)' : '';
    $('warn').textContent = r.aviso;
    $('warn').classList.toggle('hidden', !r.aviso);
  }

  function copiar(t) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(t).then(() => toast('Copiado!'), () => copiarVelho(t));
    }
    copiarVelho(t);
  }
  function copiarVelho(t) {
    const ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copiado!'); } catch (e) { toast('Nao consegui copiar'); }
    ta.remove();
  }
  function baixar(nome, conteudo, tipo) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function perguntarIA(im, forcar) {
    if (!S.me.ai || !im || im.iaOcupada) return;
    const alvo = (im.cells || []).filter(c => {
      if (c.empty || c.manual) return false;
      if (!forcar && c.aiTentou) return false;
      const st = estado(c);
      if (st === 'ig') return false;
      return st === 'no' || st === 'q' || (forcar && st === 'ia') || !c.qty;
    }).slice(0, 30);
    if (!alvo.length) { if (forcar) toast('Nada para perguntar: tudo já foi reconhecido'); return; }
    im.iaOcupada = true;
    alvo.forEach(c => { c.aiTentou = true; });
    barraIA(im, 'IA analisando ' + alvo.length + ' item(ns)...', true);
    try {
      const itens = alvo.map(c => ({ image: miniatura(im, c.rect, 96).toDataURL('image/png') }));
      const r = await api.post('/api/ai/identify', { items: itens });
      let n = 0;
      (r.results || []).forEach(x => {
        const c = alvo[x.index];
        if (!c) return;
        c.ai = { label: x.label, qty: x.qty, conf: x.conf };
        if (x.label) n++;
        if ((!c.qty || c.qtySrc === 'ia') && x.qty != null) { c.qty = String(x.qty); c.qtySrc = 'ia'; }
      });
      barraIA(im, n ? 'A IA sugeriu ' + n + ' item(ns). Confira os marcados em roxo e salve para ela aprender.'
        : 'A IA não conseguiu identificar esses itens.', false);
    } catch (e) {
      barraIA(im, 'IA: ' + e.message, false, true);
    } finally {
      im.iaOcupada = false;
      if (im === cur()) renderTudo();
    }
  }

  function barraIA(im, msg, girando, erro) {
    im.iaMsg = { msg, girando, erro };
    if (im !== cur()) return;
    const b = $('aiBar');
    b.innerHTML = '';
    b.classList.remove('hidden');
    b.classList.toggle('erro', !!erro);
    if (girando) { const s = document.createElement('span'); s.className = 'spin'; b.appendChild(s); }
    const t = document.createElement('span');
    t.textContent = msg;
    b.appendChild(t);
  }

  function recorteParaEnvio(im) {
    const g = im.grid;
    if (S.review) return { image: im.canvas.toDataURL('image/png'), grid: g };
    const x0 = Math.max(0, Math.floor(g.x - g.pw * 0.5)), y0 = Math.max(0, Math.floor(g.y - g.ph * 0.5));
    const x1 = Math.min(im.w, Math.ceil(g.x + g.cols * g.pw + g.pw * 0.5));
    const y1 = Math.min(im.h, Math.ceil(g.y + g.rows * g.ph + g.ph * 0.5));
    const c = document.createElement('canvas');
    c.width = x1 - x0; c.height = y1 - y0;
    c.getContext('2d').drawImage(im.canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    return {
      image: c.toDataURL('image/png'),
      grid: { x: g.x - x0, y: g.y - y0, pw: g.pw, ph: g.ph, cols: g.cols, rows: g.rows }
    };
  }

  function celulasParaEnvio(im) {
    return (im.cells || []).filter(c => !c.empty).map(c => {
      const f = final(c);
      return {
        r: c.r, c: c.c,
        label: f ? f.label : null,
        qty: c.qty === '' ? null : parseInt(c.qty, 10),
        origem: !f ? 'manual' : (f.fonte === 'manual' ? 'manual' : (f.fonte === 'ia' ? 'ia' : 'catalogo')),
        ai: c.ai && c.ai.label ? { label: c.ai.label, conf: c.ai.conf } : null
      };
    });
  }

  async function salvar() {
    const alvo = S.review ? [cur()] : S.images.filter(im => im.grid && im.cells.some(c => !c.empty));
    if (!alvo.length) return;
    const btn = $('btnSave');
    btn.disabled = true;
    $('saveMsg').textContent = 'enviando...';
    try {
      if (S.review) {
        const im = cur();
        await api.post('/api/admin/samples/' + S.review + '/approve', { grid: im.grid, cells: celulasParaEnvio(im) });
        toast('Aprovado! A pedra aprendeu com esta print.');
        sairRevisao();
      } else {
        for (const im of alvo) {
          const r = recorteParaEnvio(im);
          await api.post('/api/samples', { image: r.image, grid: r.grid, cells: celulasParaEnvio(im) });
        }
        toast(S.me.admin ? 'Salvo! O reconhecimento aprendeu com ' + alvo.length + ' print(s).'
          : 'Enviado para revisão. Obrigado!');
      }
      if (S.me.admin) await carregarCatalogo();
      $('saveMsg').textContent = S.me.admin ? 'aprendido' : 'enviado';
      if (window.PKAAdmin) window.PKAAdmin.filaMudou();
    } catch (e) {
      $('saveMsg').textContent = '';
      toast('Não consegui enviar: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function abrirRevisao(id) {
    const s = await api.get('/api/admin/samples/' + encodeURIComponent(id));
    const blob = await (await fetch('/api/prints/' + encodeURIComponent(id), { credentials: 'same-origin' })).blob();
    const url = URL.createObjectURL(blob);
    const el = new Image();
    await new Promise((ok, erro) => { el.onload = ok; el.onerror = erro; el.src = url; });
    S.images = [];
    S.review = id;
    const presets = new Map();
    s.cells.forEach(c => presets.set(c.r + ':' + c.c, c));
    const im = adicionarImagem(el, 'envio', { grid: s.grid, presets });
    analisarImagem(im);
    rematchAll();
    $('review').classList.remove('hidden');
    $('work').classList.remove('hidden');
    $('drop').classList.add('compacta');
    mostrarAba('leitor');
    setActive(0);
    if (S.settings.aiAuto && S.me.ai) perguntarIA(im, false);
  }

  function sairRevisao() {
    S.review = null;
    S.images = [];
    S.active = -1;
    $('review').classList.add('hidden');
    $('work').classList.add('hidden');
    $('itemsCard').classList.add('hidden');
    $('drop').classList.remove('compacta');
  }

  function mostrarAba(nome) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 'tab-' + nome));
    document.querySelectorAll('#adminNav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === nome));
    if (window.PKAAdmin) window.PKAAdmin.abriu(nome);
  }

  $('drop').addEventListener('click', () => $('file').click());
  $('drop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
  $('file').addEventListener('change', e => { readFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => $('drop').addEventListener(ev, e => { e.preventDefault(); $('drop').classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => $('drop').addEventListener(ev, e => { e.preventDefault(); $('drop').classList.remove('over'); }));
  $('drop').addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files) readFiles(e.dataTransfer.files); });
  window.addEventListener('paste', e => {
    if (!e.clipboardData) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      const temArquivo = Array.prototype.some.call(e.clipboardData.items, i => i.kind === 'file');
      if (!temArquivo) return;
    }
    const fs = [];
    for (const it of e.clipboardData.items) if (it.kind === 'file') { const f = it.getAsFile(); if (f) fs.push(f); }
    if (fs.length) { e.preventDefault(); readFiles(fs); }
  });

  ['gx', 'gy', 'gpx', 'gpy'].forEach(id => $(id).addEventListener('change', lerGrade));
  ['gcols', 'grows'].forEach(id => $(id).addEventListener('change', () => {
    const im = cur();
    if (im && im.mark) aplicarMarca(); else lerGrade();
  }));
  $('thr').addEventListener('input', () => {
    S.tol = +$('thr').value;
    S.tolManual = true;
    $('thrv').textContent = S.tol.toFixed(2);
    rematchAll(); renderTudo();
  });

  $('btnAuto').addEventListener('click', () => {
    const im = cur();
    if (!im) return;
    im.region = null; im.mark = null;
    const g = P.detectGrid(im.data, null);
    if (!g) { status('nao achei a grade - use Marcar grade'); $('gridbox').classList.remove('hidden'); return; }
    im.grid = g;
    preencherGrade(g);
    reanalisar(im);
  });
  $('btnGrid').addEventListener('click', () => $('gridbox').classList.toggle('hidden'));
  $('btnMark').addEventListener('click', () => {
    S.mode = S.mode === 'mark' ? null : 'mark';
    $('btnMark').classList.toggle('on', S.mode === 'mark');
    cv.classList.toggle('marcando', S.mode === 'mark');
    if (S.mode === 'mark') {
      $('gridbox').classList.remove('hidden');
      status('arraste do canto do primeiro slot até o canto do último');
    } else status('');
  });

  cv.addEventListener('mousedown', e => {
    if (S.mode !== 'mark') return;
    const p = posCanvas(e);
    S.dragging = { sx: p.x, sy: p.y, x: p.x, y: p.y, w: 0, h: 0 };
  });
  window.addEventListener('mousemove', e => {
    if (S.dragging) {
      const p = posCanvas(e), d = S.dragging;
      d.x = Math.min(d.sx, p.x); d.y = Math.min(d.sy, p.y);
      d.w = Math.abs(p.x - d.sx); d.h = Math.abs(p.y - d.sy);
      drawCanvas();
      return;
    }
    if (e.target !== cv) return;
    const c = celulaEm(posCanvas(e));
    if (c !== S.hover) {
      S.hover = c;
      drawCanvas();
      document.querySelectorAll('.item.hl').forEach(x => x.classList.remove('hl'));
      if (c) {
        const im = cur(), k = im.cells.filter(x => !x.empty).indexOf(c);
        const el = $('items').querySelector('.item[data-k="' + k + '"]');
        if (el) el.classList.add('hl');
      }
    }
  });
  window.addEventListener('mouseup', e => {
    if (!S.dragging) return;
    const d = S.dragging, im = cur();
    const p = posCanvas(e);
    d.x = Math.min(d.sx, p.x); d.y = Math.min(d.sy, p.y);
    d.w = Math.abs(p.x - d.sx); d.h = Math.abs(p.y - d.sy);
    S.dragging = null;
    if (im && d.w > 20 && d.h > 20) {
      im.mark = { x: d.x, y: d.y, w: d.w, h: d.h };
      S.mode = null;
      $('btnMark').classList.remove('on');
      cv.classList.remove('marcando');
      aplicarMarca();
    } else drawCanvas();
  });
  cv.addEventListener('click', e => {
    if (S.mode) return;
    const c = celulaEm(posCanvas(e));
    if (!c) return;
    const im = cur(), k = im.cells.filter(x => !x.empty).indexOf(c);
    const el = $('items').querySelector('.item[data-k="' + k + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const inp = el.querySelector('input.nm');
      setTimeout(() => inp.focus(), 250);
    }
  });

  $('sumAll').addEventListener('change', renderRelatorio);
  $('btnCopy').addEventListener('click', () => copiar(relatorio($('sumAll').checked).texto));
  $('btnTxt').addEventListener('click', () => baixar('pedras.txt', relatorio($('sumAll').checked).texto, 'text/plain'));
  $('btnAI').addEventListener('click', () => perguntarIA(cur(), true));
  $('btnSave').addEventListener('click', salvar);
  $('btnCancelReview').addEventListener('click', () => { sairRevisao(); mostrarAba('fila'); });

  window.PKAApp = {
    S, api, toast, rot, lbl, corDe, CORES, aplicarSettings, carregarCatalogo, abrirRevisao,
    mostrarAba, baixar, miniatura
  };

  (async function iniciar() {
    try {
      const [me, settings] = await Promise.all([api.get('/api/me'), api.get('/api/settings')]);
      S.me = me;
      aplicarSettings(settings);
      await carregarCatalogo();
      const naArea = /^\/admin\/?$/.test(location.pathname);
      if (naArea && !me.admin) {
        mostrarAba('login');
        if (!me.adminConfigured) {
          $('loginInfo').textContent = 'O login ainda não foi configurado: defina ADMIN_PASSWORD nas variáveis do servidor.';
        }
      } else if (me.admin && window.PKAAdmin) {
        window.PKAAdmin.iniciar();
      }
    } catch (e) {
      toast('Não consegui falar com o servidor: ' + e.message);
    }
  })();

})(window.PKA);
