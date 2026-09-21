(function (P) {
  'use strict';

  const $ = id => document.getElementById(id);
  const A = () => window.PKAApp;
  let filtro = 'pending';
  let aba = 'leitor';
  const imgCache = new Map();

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginMsg').textContent = '';
    try {
      await A().api.post('/api/login', { user: $('loginUser').value, password: $('loginPass').value });
      location.href = '/admin';
    } catch (err) {
      $('loginMsg').textContent = err.message;
    }
  });

  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function botao(txt, cls, fn) {
    const b = el('button', 'btn sm ' + (cls || ''), txt);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  function data(t) {
    return new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function iniciar() {
    $('adminNav').classList.remove('hidden');
    document.querySelectorAll('#adminNav [data-tab]').forEach(b =>
      b.addEventListener('click', () => A().mostrarAba(b.dataset.tab)));
    $('btnLogout').addEventListener('click', async () => {
      try { await A().api.post('/api/logout'); } catch (e) {}
      location.href = '/';
    });
    atualizarContagem();
  }

  async function atualizarContagem() {
    try {
      const l = await A().api.get('/api/admin/samples?status=pending');
      $('filaN').textContent = l.length;
      $('filaN').classList.toggle('hidden', !l.length);
    } catch (e) {}
  }

  function abriu(nome) {
    aba = nome;
    if (nome === 'fila') carregarFila();
    if (nome === 'catalogo') { renderCatalogo(); renderTiers(); }
    if (nome === 'aparencia') preencherAparencia();
    if (nome === 'dados') carregarDados();
  }

  document.querySelectorAll('#filaFiltro button').forEach(b => b.addEventListener('click', () => {
    filtro = b.dataset.s;
    document.querySelectorAll('#filaFiltro button').forEach(x => x.classList.toggle('on', x === b));
    carregarFila();
  }));

  async function carregarFila() {
    const box = $('fila');
    box.innerHTML = '';
    let lista;
    try { lista = await A().api.get('/api/admin/samples?status=' + filtro); }
    catch (e) { box.appendChild(el('div', 'vazia', e.message)); return; }
    if (!lista.length) {
      box.appendChild(el('div', 'vazia', filtro === 'pending' ? 'Nenhum envio esperando revisão.' : 'Nada por aqui.'));
      return;
    }
    lista.forEach(s => {
      const card = el('div', 'envio');
      const img = el('div', 'img');
      const i = el('img');
      i.src = '/api/prints/' + encodeURIComponent(s.id);
      i.alt = 'print enviada';
      i.loading = 'lazy';
      img.appendChild(i);
      card.appendChild(img);
      const meta = el('div', 'meta');
      meta.appendChild(el('span', 'pill', { publico: 'visitante', admin: 'você', semente: 'dados iniciais' }[s.source] || s.source));
      meta.appendChild(el('span', '', data(s.createdAt)));
      meta.appendChild(el('span', '', s.rotuladas + '/' + s.total + ' com nome'));
      card.appendChild(meta);
      const chips = el('div', 'chips');
      Array.from(new Set(s.rotulos)).slice(0, 14).forEach(r => chips.appendChild(el('span', '', r)));
      if (chips.children.length) card.appendChild(chips);
      const acoes = el('div', 'tools');
      acoes.appendChild(botao('Revisar', '', () => A().abrirRevisao(s.id).catch(e => A().toast(e.message))));
      if (s.status !== 'approved') {
        acoes.appendChild(botao('Aprovar', 'ghost', async () => {
          if (s.rotuladas < s.total && !confirm((s.total - s.rotuladas) + ' slot(s) sem nome serão ignorados. Aprovar mesmo assim?')) return;
          await acao(() => A().api.post('/api/admin/samples/' + s.id + '/approve'), 'Aprovado e aprendido');
        }));
      }
      if (s.status !== 'rejected') {
        acoes.appendChild(botao('Rejeitar', 'ghost', () => acao(() => A().api.post('/api/admin/samples/' + s.id + '/reject'), 'Rejeitado')));
      }
      acoes.appendChild(botao('Excluir', 'danger', () => {
        if (!confirm('Excluir esta print de vez?')) return;
        acao(() => A().api.del('/api/admin/samples/' + s.id), 'Excluída');
      }));
      card.appendChild(acoes);
      box.appendChild(card);
    });
  }

  async function acao(fn, msg) {
    try {
      await fn();
      A().toast(msg);
      await A().carregarCatalogo();
      carregarFila();
      atualizarContagem();
    } catch (e) { A().toast(e.message); }
  }

  $('catBusca').addEventListener('input', renderCatalogo);

  function renderCatalogo() {
    if (aba !== 'catalogo') return;
    const box = $('catalog');
    box.innerHTML = '';
    const q = $('catBusca').value.toLowerCase().trim();
    const entradas = P.Catalog.entries.filter(e => !q || A().rot(A().lbl(e)).toLowerCase().indexOf(q) >= 0);
    $('catInfo').textContent = '- ' + P.Catalog.entries.length + ' cadastradas';
    entradas.forEach(e => box.appendChild(cartaoPedra(e)));
    if (!entradas.length) box.appendChild(el('div', 'vazia', 'Nenhuma pedra encontrada.'));
  }

  function cartaoPedra(e) {
    const card = el('div', 'pedra');
    if (e.thumb) { const i = el('img'); i.src = e.thumb; i.alt = ''; card.appendChild(i); }
    else card.appendChild(el('div', 'semimg'));
    const info = el('div');
    info.appendChild(el('div', 'nome', A().rot(A().lbl(e))));
    const sub = el('div', 'sub');
    const dot = el('span', 'd');
    dot.style.background = e.kind === 'ignore' ? 'var(--ig)' : A().corDe(e);
    sub.appendChild(dot);
    if (e.range) sub.appendChild(el('span', '', e.range));
    sub.appendChild(el('span', '', e.sigs.length + ' amostra(s)'));
    info.appendChild(sub);
    card.appendChild(info);
    const acoes = el('div', 'acoes');
    acoes.appendChild(botao('Editar', 'ghost', () => editor(card, e)));
    acoes.appendChild(botao('Amostras', 'ghost', () => amostras(card, e)));
    acoes.appendChild(botao('Juntar', 'ghost', () => juntar(card, e)));
    acoes.appendChild(botao('Excluir', 'danger', async () => {
      if (!confirm('Excluir "' + A().rot(A().lbl(e)) + '"? As prints continuam guardadas, só perdem esse nome.')) return;
      try { await A().api.del('/api/admin/entries/' + e.id); A().toast('Excluída'); await A().carregarCatalogo(); }
      catch (err) { A().toast(err.message); }
    }));
    card.appendChild(acoes);
    return card;
  }

  function limparExtras(card) { card.querySelectorAll('.editor,.usos').forEach(x => x.remove()); }

  function editor(card, e) {
    limparExtras(card);
    const box = el('div', 'editor');
    const l1 = el('div', 'linha');
    const tier = el('select');
    tier.appendChild(new Option('Tier...', ''));
    P.TIERS.forEach(t => tier.appendChild(new Option(t.name + ' (' + t.range + ')', t.name)));
    tier.value = e.tier || '';
    const elem = el('select');
    elem.appendChild(new Option('Elemento...', ''));
    P.ELEMENTS.forEach(x => elem.appendChild(new Option(x, x)));
    elem.value = e.element || '';
    l1.appendChild(tier); l1.appendChild(elem);
    const livre = el('input');
    livre.placeholder = 'ou nome livre';
    livre.value = e.kind === 'ignore' ? '' : (e.customName || '');
    const ign = el('label', 'chk');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = e.kind === 'ignore';
    ign.appendChild(cb); ign.appendChild(document.createTextNode('É um slot para ignorar'));
    const l2 = el('div', 'linha');
    l2.appendChild(botao('Salvar', '', async () => {
      const dados = cb.checked ? { kind: 'ignore' }
        : { kind: 'stone', tier: tier.value, element: elem.value, customName: livre.value.trim() };
      try { await A().api.put('/api/admin/entries/' + e.id, dados); A().toast('Atualizada'); await A().carregarCatalogo(); }
      catch (err) { A().toast(err.message); }
    }));
    l2.appendChild(botao('Cancelar', 'ghost', () => limparExtras(card)));
    box.appendChild(l1); box.appendChild(livre); box.appendChild(ign); box.appendChild(l2);
    card.appendChild(box);
  }

  function juntar(card, e) {
    limparExtras(card);
    const box = el('div', 'editor');
    box.appendChild(el('span', 'muted', 'Mover as amostras desta pedra para:'));
    const sel = el('select');
    P.Catalog.entries.filter(x => x.id !== e.id)
      .forEach(x => sel.appendChild(new Option(A().rot(A().lbl(x)), x.id)));
    box.appendChild(sel);
    const l = el('div', 'linha');
    l.appendChild(botao('Juntar', '', async () => {
      try {
        await A().api.post('/api/admin/entries/' + e.id + '/merge', { into: sel.value });
        A().toast('Juntadas');
        await A().carregarCatalogo();
      } catch (err) { A().toast(err.message); }
    }));
    l.appendChild(botao('Cancelar', 'ghost', () => limparExtras(card)));
    box.appendChild(l);
    card.appendChild(box);
  }

  function imagemDaPrint(id) {
    if (!imgCache.has(id)) {
      imgCache.set(id, new Promise((ok, erro) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = erro;
        i.src = '/api/prints/' + encodeURIComponent(id);
      }));
    }
    return imgCache.get(id);
  }

  async function amostras(card, e) {
    limparExtras(card);
    const box = el('div', 'usos');
    card.appendChild(box);
    let usos;
    try { usos = await A().api.get('/api/admin/entries/' + e.id + '/uses'); }
    catch (err) { box.appendChild(el('span', 'muted', err.message)); return; }
    if (!usos.length) { box.appendChild(el('span', 'muted', 'Nenhuma print aprovada usa esta pedra.')); return; }
    for (const u of usos.slice(0, 60)) {
      const w = el('div', 'uso');
      const c = el('canvas');
      c.width = 44; c.height = 44;
      c.title = 'qtd ' + (u.qty == null ? '?' : u.qty);
      w.appendChild(c);
      const x = el('button', '', '×');
      x.title = 'Tirar esta amostra (nome errado)';
      x.addEventListener('click', async () => {
        if (!confirm('Tirar esta amostra da pedra? Use quando ela estiver com o nome errado.')) return;
        try {
          await A().api.post('/api/admin/samples/' + u.sample + '/unlabel', { r: u.r, c: u.c });
          await A().carregarCatalogo();
          amostras(card, P.Catalog.entries.find(y => y.id === e.id) || e);
        } catch (err) { A().toast(err.message); }
      });
      w.appendChild(x);
      box.appendChild(w);
      imagemDaPrint(u.sample).then(img => {
        const g = c.getContext('2d');
        g.drawImage(img, u.grid.x + u.c * u.grid.pw, u.grid.y + u.r * u.grid.ph, u.grid.pw, u.grid.ph, 0, 0, 44, 44);
      }).catch(() => {});
    }
  }

  function renderTiers() {
    const box = $('tiers');
    box.innerHTML = '';
    P.TIERS.forEach(t => box.appendChild(linhaTier(t.name, t.range)));
  }
  function linhaTier(nome, faixa) {
    const d = el('div', 'tier');
    const n = el('input', 'nm'); n.value = nome; n.placeholder = 'Tier';
    const r = el('input', 'rg'); r.value = faixa; r.placeholder = '+0 a +5';
    const x = el('button', 'x', '×'); x.type = 'button'; x.title = 'remover';
    x.addEventListener('click', () => d.remove());
    d.appendChild(n); d.appendChild(r); d.appendChild(x);
    return d;
  }
  $('btnTierAdd').addEventListener('click', () => { const d = linhaTier('', ''); $('tiers').appendChild(d); d.querySelector('input').focus(); });
  $('btnTierSave').addEventListener('click', async () => {
    const tiers = Array.from($('tiers').querySelectorAll('.tier')).map(d => ({
      name: d.querySelector('.nm').value, range: d.querySelector('.rg').value
    }));
    try { await A().api.put('/api/admin/tiers', { tiers }); A().toast('Tiers salvos'); await A().carregarCatalogo(); renderTiers(); }
    catch (e) { A().toast(e.message); }
  });

  function camposAparencia() { return Array.from($('aparencia').querySelectorAll('[data-k]')); }

  function preencherAparencia() {
    const s = A().S.settings;
    camposAparencia().forEach(i => { i.value = s[i.dataset.k] != null ? s[i.dataset.k] : ''; });
    $('themeMsg').textContent = '';
  }
  function lerAparencia() {
    const out = {};
    camposAparencia().forEach(i => { out[i.dataset.k] = i.type === 'range' ? Number(i.value) : i.value; });
    return out;
  }
  camposAparencia().forEach(i => i.addEventListener('input', () => {
    A().aplicarSettings(Object.assign({}, A().S.settings, lerAparencia()));
    $('themeMsg').textContent = 'alterações não salvas';
  }));
  $('btnThemeSave').addEventListener('click', async () => {
    try {
      const s = await A().api.put('/api/admin/settings', lerAparencia());
      A().aplicarSettings(s);
      $('themeMsg').textContent = 'publicado';
      A().toast('Aparência salva para todo mundo');
    } catch (e) { A().toast(e.message); }
  });
  $('btnThemeReset').addEventListener('click', async () => {
    if (!confirm('Voltar a aparência para o padrão?')) return;
    try { const s = await A().api.post('/api/admin/settings/reset'); A().aplicarSettings(s); preencherAparencia(); }
    catch (e) { A().toast(e.message); }
  });

  function stat(v, rotulo) {
    const d = el('div', 'stat');
    d.appendChild(el('b', '', v));
    d.appendChild(el('span', '', rotulo));
    return d;
  }

  async function carregarDados() {
    const s = A().S.settings;
    $('optAiAuto').checked = !!s.aiAuto;
    $('optPublic').checked = !!s.publicContrib;
    $('optLimit').value = s.aiDailyLimit;
    $('optTol').value = s.tolerance;
    let st;
    try { st = await A().api.get('/api/admin/stats'); } catch (e) { A().toast(e.message); return; }
    $('iaEstado').textContent = st.iaAtiva ? 'ativa' : 'desligada';
    $('iaEstado').style.background = st.iaAtiva ? 'var(--ok)' : 'var(--no)';
    $('iaEstado').style.color = '#07130c';
    const ia = $('iaInfo');
    ia.innerHTML = '';
    if (!st.iaAtiva) {
      const p = el('p', 'muted', 'Para ligar, crie a variável GEMINI_API_KEY no Railway com a sua chave gratuita do Google AI Studio.');
      p.style.gridColumn = '1/-1';
      ia.appendChild(p);
    } else {
      ia.appendChild(stat(st.modelo, 'modelo em uso'));
      ia.appendChild(stat(st.iaHoje, 'consultas hoje'));
      const acc = st.ia.avaliadas ? Math.round(100 * st.ia.certas / st.ia.avaliadas) + '%' : '-';
      ia.appendChild(stat(acc, 'acerto da IA (' + st.ia.avaliadas + ' conferidos)'));
    }
    const box = $('stats');
    box.innerHTML = '';
    box.appendChild(stat(st.entradas, 'pedras cadastradas'));
    box.appendChild(stat(st.amostras, 'amostras aprendidas'));
    box.appendChild(stat(st.aprovadas, 'prints aprovadas'));
    box.appendChild(stat(st.pendentes, 'esperando revisão'));
    box.appendChild(stat(st.digitos || '-', 'dígitos que sabe ler'));
  }

  $('btnOptSave').addEventListener('click', async () => {
    try {
      const s = await A().api.put('/api/admin/settings', {
        aiAuto: $('optAiAuto').checked, publicContrib: $('optPublic').checked,
        aiDailyLimit: Number($('optLimit').value), tolerance: Number($('optTol').value)
      });
      A().aplicarSettings(s);
      $('optMsg').textContent = 'salvo';
    } catch (e) { A().toast(e.message); }
  });

  $('btnRebuild').addEventListener('click', async () => {
    $('dadosMsg').textContent = 'reconstruindo...';
    try { await A().api.post('/api/admin/rebuild'); await A().carregarCatalogo(); $('dadosMsg').textContent = 'pronto'; carregarDados(); }
    catch (e) { $('dadosMsg').textContent = e.message; }
  });
  $('btnExport').addEventListener('click', async () => {
    try {
      const d = await A().api.get('/api/admin/export');
      A().baixar('pka-catalogo-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(d), 'application/json');
    } catch (e) { A().toast(e.message); }
  });
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const fr = new FileReader();
    fr.onload = async () => {
      try {
        const r = await A().api.post('/api/admin/import', JSON.parse(fr.result));
        $('dadosMsg').textContent = r.novas + ' pedra(s) nova(s), ' + r.somadas + ' amostra(s)' +
          (r.compativel ? '' : ' (arquivo de versão antiga: vieram só os nomes)');
        await A().carregarCatalogo();
        carregarDados();
      } catch (err) { $('dadosMsg').textContent = err.message; }
    };
    fr.readAsText(f);
  });

  window.PKAAdmin = {
    iniciar, abriu,
    catalogoMudou() { if (aba === 'catalogo') { renderCatalogo(); } },
    filaMudou() { atualizarContagem(); if (aba === 'fila') carregarFila(); }
  };

})(window.PKA);
