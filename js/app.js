(function (P) {
  'use strict';

  var Cat = P.Catalog;

  var state = {
    images: [],
    active: -1,
    tol: 0.16,
    dragging: null,
    mode: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), ctx = cv.getContext('2d', { willReadFrequently: true });

  function readFiles(files) {
    var list = Array.prototype.slice.call(files).filter(function (f) {
      return f && /^image\//.test(f.type);
    });
    if (!list.length) return;
    var pending = list.length;
    list.forEach(function (f) {
      var url = URL.createObjectURL(f);
      var im = new Image();
      im.onload = function () {
        var c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        c.getContext('2d').drawImage(im, 0, 0);
        var data = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        state.images.push({
          name: f.name || 'print.png', el: im, w: c.width, h: c.height,
          data: data, grid: null, region: null, cells: []
        });
        URL.revokeObjectURL(url);
        if (--pending === 0) prepararTodas();
      };
      im.onerror = function () {
        URL.revokeObjectURL(url);
        if (--pending === 0) prepararTodas();
      };
      im.src = url;
    });
  }

  function prepararTodas() {
    var pendentes = state.images.filter(function (im) { return !im.cells || !im.cells.length; });
    if (!pendentes.length) { setActive(state.images.length - 1); renderStrip(); return; }
    $('work').classList.remove('hidden');
    status('analisando ' + pendentes.length + ' imagem(ns)...');
    var i = 0;
    (function passo() {
      if (i >= pendentes.length) {
        rematchAll();
        setActive(state.images.length - 1);
        renderStrip();
        status(state.images.length + ' imagem(ns) prontas');
        return;
      }
      var im = pendentes[i++];
      setTimeout(function () {
        if (prepararImagem(im) < 0) im.falhou = true;
        status('analisando ' + i + '/' + pendentes.length + '...');
        passo();
      }, 5);
    })();
  }

  $('drop').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function (e) { readFiles(e.target.files); e.target.value = ''; });

  ['dragenter', 'dragover'].forEach(function (ev) {
    $('drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    $('drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.remove('over'); });
  });
  $('drop').addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) readFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', function (e) {
    if (!e.clipboardData) return;
    var items = e.clipboardData.items, fs = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') { var f = items[i].getAsFile(); if (f) fs.push(f); }
    }
    if (fs.length) { e.preventDefault(); readFiles(fs); }
  });

  function renderStrip() {
    var box = $('strip');
    box.innerHTML = '';
    state.images.forEach(function (im, i) {
      var d = document.createElement('div');
      d.className = 'th' + (i === state.active ? ' on' : '');
      var img = document.createElement('img');
      img.src = im.el.src;
      var b = document.createElement('b');
      b.textContent = im.name;
      d.appendChild(img); d.appendChild(b);
      d.addEventListener('click', function () { setActive(i); });
      box.appendChild(d);
    });
  }

  function cur() { return state.images[state.active] || null; }

  function setActive(i) {
    if (i < 0 || i >= state.images.length) return;
    state.active = i;
    var im = cur();
    cv.width = im.w; cv.height = im.h;
    $('work').classList.remove('hidden');
    renderStrip();
    if (!im.grid) autoDetect();
    else {
      fillGridInputs(im.grid);
      drawCanvas(); renderCells(); renderOutput();
      maybeOcr();
    }
  }

  function autoDetect() {
    var im = cur();
    if (!im) return;
    status('detectando grade...');
    setTimeout(function () {
      var g = P.detectGrid(im.data, im.region);
      if (!g) { status('nao consegui detectar a grade - ajuste na mao'); $('gridbox').classList.remove('hidden'); drawCanvas(); return; }
      im.grid = g;
      var known = analisarImagem(im);
      rematchAll();
      if (im === cur()) {
        fillGridInputs(g);
        drawCanvas(); renderCells(); renderOutput();
        status(known + ' celulas com item');
        maybeOcr();
      }
    }, 10);
  }

  function fillGridInputs(g) {
    $('gx').value = g.x; $('gy').value = g.y;
    $('gpx').value = g.pw; $('gpy').value = g.ph;
    $('gcols').value = g.cols; $('grows').value = g.rows;
  }

  function applyMark() {
    var im = cur();
    if (!im || !im.mark) return;
    var cols = Math.max(1, +$('gcols').value || 1);
    var rows = Math.max(1, +$('grows').value || 1);
    im.grid = {
      x: im.mark.x, y: im.mark.y,
      pw: im.mark.w / cols, ph: im.mark.h / rows,
      cols: cols, rows: rows
    };
    fillGridInputs(im.grid);
    analyze();
  }

  function readGridInputs() {
    var im = cur();
    if (!im) return;
    im.mark = null;
    im.grid = {
      x: +$('gx').value || 0, y: +$('gy').value || 0,
      pw: Math.max(8, +$('gpx').value || 32), ph: Math.max(8, +$('gpy').value || 32),
      cols: Math.max(1, +$('gcols').value || 1), rows: Math.max(1, +$('grows').value || 1)
    };
    analyze();
  }
  ['gx', 'gy', 'gpx', 'gpy'].forEach(function (id) {
    $(id).addEventListener('change', readGridInputs);
  });
  ['gcols', 'grows'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      var im = cur();
      if (im && im.mark) applyMark(); else readGridInputs();
    });
  });

  $('thr').value = state.tol; $('thrv').textContent = state.tol.toFixed(2);
  $('thr').addEventListener('input', function () {
    state.tol = +this.value;
    $('thrv').textContent = state.tol.toFixed(2);
    rematchAll(); renderCells(); renderOutput(); drawCanvas();
  });

  $('btnAuto').addEventListener('click', autoDetect);
  $('btnGrid').addEventListener('click', function () { $('gridbox').classList.toggle('hidden'); });
  $('btnReanalyze').addEventListener('click', analyze);
  $('btnRegion').addEventListener('click', function () {
    state.mode = state.mode === 'region' ? null : 'region';
    syncModeButtons();
    status(state.mode === 'region' ? 'arraste em volta da area da bag' : '');
  });
  $('btnMark').addEventListener('click', function () {
    state.mode = state.mode === 'mark' ? null : 'mark';
    syncModeButtons();
    if (state.mode === 'mark') {
      $('gridbox').classList.remove('hidden');
      status('arraste do canto superior esquerdo do PRIMEIRO slot ate o canto inferior direito do ULTIMO');
    } else status('');
  });
  function syncModeButtons() {
    $('btnRegion').classList.toggle('on', state.mode === 'region');
    $('btnMark').classList.toggle('on', state.mode === 'mark');
  }
  $('btnClearRegion').addEventListener('click', function () {
    var im = cur(); if (!im) return;
    im.region = null; im.mark = null;
    state.mode = null; syncModeButtons();
    autoDetect();
  });

  function analisarImagem(im) {
    if (!im || !im.grid) return 0;
    var g = im.grid, cells = [];
    for (var r = 0; r < g.rows; r++) {
      for (var c = 0; c < g.cols; c++) {
        var rect = { x: g.x + c * g.pw, y: g.y + r * g.ph, w: g.pw, h: g.ph };
        if (rect.x + rect.w > im.w || rect.y + rect.h > im.h) continue;
        var res = P.analyzeCell(im.data, rect);
        if (!res) continue;
        var cell = {
          r: r, c: c, rect: rect, res: res,
          empty: !!res.empty,
          feat: res.feat || null,
          qty: '', qtySrc: '', qtyConf: 0,
          match: null
        };
        if (!cell.empty) {
          var d = P.readDigits(res.digits);
          if (d) { cell.qty = String(parseInt(d.text, 10)); cell.qtySrc = 'auto'; cell.qtyConf = 100; }
        }
        cells.push(cell);
      }
    }
    im.cells = cells;
    return cells.filter(function (x) { return !x.empty; }).length;
  }

  function prepararImagem(im) {
    if (!im) return 0;
    if (!im.grid) {
      var g = P.detectGrid(im.data, im.region);
      if (!g) return -1;
      im.grid = g;
    }
    return analisarImagem(im);
  }

  function analyze() {
    var im = cur();
    if (!im || !im.grid) return;
    status('analisando celulas...');
    setTimeout(function () {
      var known = analisarImagem(im);
      rematchAll();
      if (im === cur()) {
        drawCanvas(); renderCells(); renderOutput();
        status(known + ' celulas com item');
        maybeOcr();
      }
    }, 10);
  }

  function rematchAll() {
    state.images.forEach(function (im) {
      (im.cells || []).forEach(function (cell) {
        if (cell.empty || !cell.feat) return;
        cell.match = Cat.match(cell.feat, state.tol);
      });
    });
  }

  var tessWorker = null, tessBusy = false;

  function digitStrip(numBox) {
    var s = 6, pad = 14;
    var w = numBox.w * s + pad * 2, h = numBox.h * s + pad * 2;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    var id = g.getImageData(0, 0, w, h), d = id.data;
    for (var y = 0; y < numBox.h * s; y++) {
      for (var x = 0; x < numBox.w * s; x++) {
        if (!numBox.mask[((y / s) | 0) * numBox.w + ((x / s) | 0)]) continue;
        var px = ((pad + y) * w + pad + x) * 4;
        d[px] = d[px + 1] = d[px + 2] = 0; d[px + 3] = 255;
      }
    }
    g.putImageData(id, 0, 0);
    return c;
  }

  function loadTesseract() {
    return new Promise(function (res) {
      if (window.Tesseract) return res(true);
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js';
      s.onload = function () { res(!!window.Tesseract); };
      s.onerror = function () { res(false); };
      document.head.appendChild(s);
    });
  }

  async function getWorker() {
    if (tessWorker) return tessWorker;
    var ok = await loadTesseract();
    if (!ok) return null;
    try {
      tessWorker = await window.Tesseract.createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0'
      });
      await tessWorker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7'
      });
      return tessWorker;
    } catch (e) { tessWorker = null; return null; }
  }

  async function maybeOcr() {
    if (!$('useOcr').checked || tessBusy) return;
    var im = cur();
    if (!im) return;
    var todo = (im.cells || []).filter(function (c) {
      return !c.empty && !c.qty && c.res.numBox;
    });
    if (!todo.length) return;

    tessBusy = true;
    status('carregando OCR...');
    var w = await getWorker();
    if (!w) {
      tessBusy = false;
      status('OCR indisponivel (offline?) - digite as quantidades e o app aprende os numeros');
      return;
    }
    for (var i = 0; i < todo.length; i++) {
      status('OCR ' + (i + 1) + '/' + todo.length + '...');
      try {
        var out = await w.recognize(digitStrip(todo[i].res.numBox));
        var txt = (out.data.text || '').replace(/[^0-9]/g, '');
        if (txt) {
          todo[i].qty = String(parseInt(txt, 10));
          todo[i].qtySrc = 'ocr';
          todo[i].qtyConf = out.data.confidence || 0;
        }
      } catch (e) {  }
    }
    tessBusy = false;
    var low = todo.filter(function (c) { return c.qtySrc === 'ocr' && c.qtyConf < 80; }).length;
    status('OCR concluido' + (low ? ' - ' + low + ' quantidade(s) com leitura duvidosa, confira as amarelas' : ''));
    renderCells(); renderOutput(); drawCanvas(); renderCatalog();
  }

  $('useOcr').addEventListener('change', function () { if (this.checked) maybeOcr(); });

  function drawCanvas() {
    var im = cur();
    if (!im) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im.el, 0, 0);

    if (im.region) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.rect(0, 0, cv.width, cv.height);
      ctx.rect(im.region.x, im.region.y, im.region.w, im.region.h);
      ctx.fill('evenodd');
      ctx.restore();
    }

    (im.cells || []).forEach(function (cell) {
      var col;
      if (cell.empty) return;
      else if (!cell.match || !cell.match.entry) col = '#ff6b6b';
      else if (cell.match.entry.kind === 'ignore') col = '#5b6675';
      else if (!cell.qty || (cell.qtySrc === 'ocr' && (cell.qtyConf || 0) < 80)) col = '#f5c451';
      else col = '#3fd08a';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.strokeRect(cell.rect.x + 1, cell.rect.y + 1, cell.rect.w - 2, cell.rect.h - 2);
    });

    if (state.dragging) {
      var d = state.dragging;
      ctx.strokeStyle = '#4ea3ff'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(d.x, d.y, d.w, d.h);
      ctx.setLineDash([]);
    }
  }

  function canvasPos(e) {
    var r = cv.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - r.left) * (cv.width / r.width)),
      y: Math.round((e.clientY - r.top) * (cv.height / r.height))
    };
  }

  cv.addEventListener('mousedown', function (e) {
    if (!state.mode) return;
    var p = canvasPos(e);
    state.dragging = { sx: p.x, sy: p.y, x: p.x, y: p.y, w: 0, h: 0 };
  });
  window.addEventListener('mousemove', function (e) {
    if (!state.dragging) return;
    var p = canvasPos(e), d = state.dragging;
    d.x = Math.min(d.sx, p.x); d.y = Math.min(d.sy, p.y);
    d.w = Math.abs(p.x - d.sx); d.h = Math.abs(p.y - d.sy);
    drawCanvas();
  });
  window.addEventListener('mouseup', function (e) {
    if (!state.dragging) return;
    var d = state.dragging, im = cur();
    if (e && typeof e.clientX === 'number') {
      var p = canvasPos(e);
      d.x = Math.min(d.sx, p.x); d.y = Math.min(d.sy, p.y);
      d.w = Math.abs(p.x - d.sx); d.h = Math.abs(p.y - d.sy);
    }
    state.dragging = null;
    if (im && d.w > 20 && d.h > 20) {
      if (state.mode === 'mark') {
        im.mark = { x: d.x, y: d.y, w: d.w, h: d.h };
        im.region = null;
        state.mode = null; syncModeButtons();
        applyMark();
      } else {
        im.region = { x: d.x, y: d.y, w: d.w, h: d.h };
        im.mark = null;
        state.mode = null; syncModeButtons();
        autoDetect();
      }
    } else drawCanvas();
  });

  function thumbOf(cell, img) {
    var im = img || cur(), c = document.createElement('canvas');
    c.width = 52; c.height = 52;
    c.getContext('2d').drawImage(im.el, cell.rect.x, cell.rect.y, cell.rect.w, cell.rect.h, 0, 0, 52, 52);
    return c;
  }

  function pos(cell) { return 'Linha ' + (cell.r + 1) + ', Coluna ' + (cell.c + 1); }

  function renderCells() {
    var im = cur(), box = $('cells');
    box.innerHTML = '';
    if (!im) return;
    var items = (im.cells || []).filter(function (c) { return !c.empty; });
    $('cellsCard').classList.toggle('hidden', !items.length);
    $('outCard').classList.toggle('hidden', !items.length);

    var unk = 0, noqty = 0;
    items.forEach(function (cell) {
      var known = cell.match && cell.match.entry;
      if (!known) unk++;
      else if (known.kind !== 'ignore' &&
               (!cell.qty || (cell.qtySrc === 'ocr' && (cell.qtyConf || 0) < 80))) noqty++;
      box.appendChild(cellCard(cell));
    });
    $('cellsInfo').textContent = items.length + ' itens - ' + unk + ' nao identificados - ' + noqty + ' sem quantidade';
  }

  function cellCard(cell) {
    var known = cell.match && cell.match.entry;
    var el = document.createElement('div');
    var qtyOk = cell.qty && !(cell.qtySrc === 'ocr' && (cell.qtyConf || 0) < 80);
    el.className = 'cell ' + (!known ? 'no' : (known.kind === 'ignore' ? 'ig' : (qtyOk ? 'ok' : 'q')));

    el.appendChild(thumbOf(cell));

    var body = document.createElement('div');
    body.className = 'body';

    var p = document.createElement('div');
    p.className = 'pos';
    p.textContent = pos(cell) + (cell.match ? ' - dist ' + cell.match.dist.toFixed(3) : '');
    body.appendChild(p);

    var nm = document.createElement('div');
    nm.className = 'nm' + (known ? '' : ' unk');
    nm.textContent = known ? Cat.label(known) : 'Nao identificada';
    body.appendChild(nm);

    var row = document.createElement('div');
    row.className = 'row';
    if (!known || known.kind !== 'ignore') {
      var lab = document.createElement('span');
      lab.className = 'pos'; lab.textContent = 'Qtd';
      var q = document.createElement('input');
      q.type = 'number'; q.min = '0'; q.value = cell.qty;
      q.addEventListener('change', function () {
        cell.qty = this.value === '' ? '' : String(Math.max(0, parseInt(this.value, 10) || 0));
        cell.qtySrc = 'manual'; cell.qtyConf = 100;
        if (cell.qty) P.learnDigits(cell.res.digits.map(function (d) { return d.bmp; }), cell.qty);
        renderCells(); renderOutput(); drawCanvas(); renderCatalog();
      });
      row.appendChild(lab); row.appendChild(q);
    }
    var edit = document.createElement('button');
    edit.className = 'btn ghost mini';
    edit.textContent = known ? 'Corrigir' : 'Registrar';
    edit.addEventListener('click', function () { toggleForm(body, cell); });
    row.appendChild(edit);
    body.appendChild(row);

    if (!known && cell.match && cell.match.alts && cell.match.alts.length) {
      var alts = document.createElement('div');
      alts.className = 'alts';
      cell.match.alts.forEach(function (a) {
        if (a.dist > 0.45) return;
        var b = document.createElement('button');
        b.textContent = Cat.label(a.entry) + ' (' + a.dist.toFixed(2) + ')';
        b.addEventListener('click', function () {
          Cat.addSig(a.entry.id, cell.feat);
          rematchAll(); renderCells(); renderOutput(); drawCanvas(); renderCatalog();
        });
        alts.appendChild(b);
      });
      if (alts.children.length) body.appendChild(alts);
    }

    el.appendChild(body);
    return el;
  }

  function toggleForm(body, cell) {
    var old = body.querySelector('.form');
    if (old) { old.remove(); return; }

    var f = document.createElement('div');
    f.className = 'form';

    var selEntry = document.createElement('select');
    selEntry.appendChild(opt('', '-- nova pedra --'));
    Cat.entries.forEach(function (e) { selEntry.appendChild(opt(e.id, Cat.label(e))); });
    if (cell.match && cell.match.entry) selEntry.value = cell.match.entry.id;

    var selTier = document.createElement('select');
    selTier.appendChild(opt('', 'Tier...'));
    P.TIERS.forEach(function (t) { selTier.appendChild(opt(t.name, t.name + ' (' + t.range + ')')); });

    var selEl = document.createElement('select');
    selEl.appendChild(opt('', 'Elemento...'));
    P.ELEMENTS.forEach(function (e) { selEl.appendChild(opt(e, e)); });

    var custom = document.createElement('input');
    custom.type = 'text';
    custom.placeholder = 'ou nome livre (ex: Rare Candy)';

    var row = document.createElement('div');
    row.className = 'row';
    var save = document.createElement('button');
    save.className = 'btn mini'; save.textContent = 'Salvar';
    var ign = document.createElement('button');
    ign.className = 'btn ghost mini'; ign.textContent = 'Ignorar este';
    var can = document.createElement('button');
    can.className = 'btn ghost mini'; can.textContent = 'Cancelar';
    row.appendChild(save); row.appendChild(ign); row.appendChild(can);

    function refresh() {
      var usingExisting = !!selEntry.value;
      selTier.disabled = usingExisting;
      selEl.disabled = usingExisting;
      custom.disabled = usingExisting;
    }
    selEntry.addEventListener('change', refresh);
    refresh();

    save.addEventListener('click', function () {
      if (selEntry.value) {
        Cat.addSig(selEntry.value, cell.feat);
      } else if (custom.value.trim()) {
        Cat.add({ kind: 'stone', customName: custom.value.trim() }, cell.feat, thumbOf(cell).toDataURL('image/png'));
      } else if (selTier.value && selEl.value) {
        Cat.add({ kind: 'stone', tier: selTier.value, element: selEl.value }, cell.feat, thumbOf(cell).toDataURL('image/png'));
      } else {
        alert('Escolha tier + elemento, ou digite um nome livre.');
        return;
      }
      rematchAll(); renderCells(); renderOutput(); drawCanvas(); renderCatalog();
    });

    ign.addEventListener('click', function () {
      Cat.add({ kind: 'ignore', customName: 'Ignorado' }, cell.feat, thumbOf(cell).toDataURL('image/png'));
      rematchAll(); renderCells(); renderOutput(); drawCanvas(); renderCatalog();
    });

    can.addEventListener('click', function () { f.remove(); });

    f.appendChild(selEntry);
    f.appendChild(selTier);
    f.appendChild(selEl);
    f.appendChild(custom);
    f.appendChild(row);
    body.appendChild(f);
  }

  function opt(v, t) {
    var o = document.createElement('option');
    o.value = v; o.textContent = t;
    return o;
  }

  function buildReport(sumAll) {
    var imgs = sumAll ? state.images : [cur()];
    var order = [], map = {}, unknown = [], noqty = [];

    imgs.forEach(function (im, ii) {
      if (!im) return;
      (im.cells || []).forEach(function (cell) {
        if (cell.empty) return;
        var where = (imgs.length > 1 ? im.name + ': ' : '') + pos(cell);
        var e = cell.match && cell.match.entry;
        if (!e) { unknown.push(where); return; }
        if (e.kind === 'ignore') return;
        var q = cell.qty === '' ? null : parseInt(cell.qty, 10);
        if (q === null) noqty.push(where + ' (' + Cat.label(e) + ')');
        if (!map[e.id]) { map[e.id] = { entry: e, qty: 0, some: false }; order.push(e.id); }
        if (q !== null) { map[e.id].qty += q; map[e.id].some = true; }
      });
    });

    var lines = order.map(function (id) {
      var m = map[id];
      return Cat.line(m.entry, m.some ? m.qty : null);
    });
    var w = [];
    if (unknown.length) w.push('Nao identificadas (' + unknown.length + '): ' + unknown.join(' | '));
    if (noqty.length) w.push('Sem quantidade (' + noqty.length + '): ' + noqty.join(' | '));
    return { text: lines.join('\n'), warn: w.join('\n'), count: lines.length };
  }

  function renderOutput() {
    var r = buildReport($('sumAll').checked);
    $('output').textContent = r.text || '(nada identificado ainda)';
    $('warn').textContent = r.warn;
    $('warn').classList.toggle('hidden', !r.warn);
    if (!$('reportModal').classList.contains('hidden')) fillReport();
  }

  function fillReport() {
    var r = buildReport($('reportSumAll').checked);
    $('reportText').textContent = r.text || '(nada identificado ainda)';
    $('reportWarn').textContent = r.warn;
    $('reportWarn').classList.toggle('hidden', !r.warn);
    $('reportMsg').textContent = r.count ? r.count + ' item(ns)' : '';
  }

  function openReport() {
    $('reportSumAll').checked = $('sumAll').checked;
    fillReport();
    $('reportModal').classList.remove('hidden');
  }
  function closeReport() {
    $('reportModal').classList.add('hidden');
    $('reportMsg').textContent = '';
  }

  $('btnReport').addEventListener('click', openReport);
  $('btnReportClose').addEventListener('click', closeReport);
  $('reportModal').addEventListener('click', function (e) {
    if (e.target === this) closeReport();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('reportModal').classList.contains('hidden')) closeReport();
  });
  $('reportSumAll').addEventListener('change', function () {
    $('sumAll').checked = this.checked;
    fillReport();
    renderOutput();
  });
  $('btnReportCopy').addEventListener('click', function () {
    copyText($('reportText').textContent, function () { $('reportMsg').textContent = 'copiado'; });
  });
  $('btnReportTxt').addEventListener('click', function () {
    download('pedras.txt', $('reportText').textContent, 'text/plain');
  });

  $('sumAll').addEventListener('change', renderOutput);

  function copyText(t, done) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(t).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    }
  }

  $('btnCopy').addEventListener('click', function () {
    copyText($('output').textContent, function () { status('copiado'); });
  });

  $('btnTxt').addEventListener('click', function () {
    download('pedras.txt', $('output').textContent, 'text/plain');
  });

  function download(name, content, type) {
    var b = new Blob([content], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  $('btnBatch').addEventListener('click', function () {
    $('batchBox').classList.toggle('hidden');
    if (!$('batchBox').classList.contains('hidden')) $('batchText').focus();
  });
  $('btnBatchCancel').addEventListener('click', function () {
    $('batchBox').classList.add('hidden');
    $('batchInfo').textContent = '';
  });
  function aplicarLote(imx, itens, soNovas) {
    var todas = (imx.cells || []).filter(function (c) { return !c.empty; });
    var cells = soNovas ? todas.filter(function (c) { return !(c.match && c.match.entry); }) : todas;
    if (!cells.length) return { n: 0, alvo: 0 };
    var n = Math.min(itens.length, cells.length);
    for (var i = 0; i < n; i++) {
      var it = itens[i], cell = cells[i];
      var label = it.tier + ' ' + it.element + ' Stone';
      var e = Cat.findByLabel(label);
      if (e) Cat.addSig(e.id, cell.feat);
      else e = Cat.add({ kind: 'stone', tier: it.tier, element: it.element, range: it.range },
                       cell.feat, thumbOf(cell, imx).toDataURL('image/png'));
      if (it.qty !== null) {
        cell.qty = String(it.qty);
        cell.qtySrc = 'manual';
        cell.qtyConf = 100;
        P.learnDigits(cell.res.digits.map(function (d) { return d.bmp; }), String(it.qty));
      }
    }
    return { n: n, alvo: cells.length };
  }

  $('btnBatchApply').addEventListener('click', function () {
    var im = cur();
    if (!im) return;
    var parsed = P.parseList($('batchText').value);
    if (!parsed.items.length) {
      $('batchInfo').textContent = 'nenhuma linha reconhecida - use o formato "6 Common Flying Stones (+11 a +15)"';
      return;
    }
    var soNovas = $('batchOnlyNew').checked;
    var alvos = $('batchAllImages').checked ? state.images : [im];
    var total = 0, avisos = [], usadas = 0;
    alvos.forEach(function (imx) {
      if (!imx || !imx.cells || !imx.cells.length) return;
      rematchAll();
      var r = aplicarLote(imx, parsed.items, soNovas);
      if (!r.alvo) return;
      usadas++;
      total += r.n;
      if (parsed.items.length !== r.alvo) {
        avisos.push(imx.name + ' (' + parsed.items.length + ' linhas para ' + r.alvo + ')');
      }
    });
    if (!total) {
      $('batchInfo').textContent = soNovas ? 'nenhuma celula nao identificada' : 'nenhuma celula com item';
      return;
    }
    var msg = total + ' cadastro(s) em ' + usadas + ' imagem(ns)';
    if (avisos.length) {
      msg += ' - ATENCAO, contagem diferente em: ' + avisos.join('; ') +
             ', confira a ordem e o alinhamento da grade';
    }
    if (parsed.ignored.length) msg += ' - ' + parsed.ignored.length + ' linha(s) ignorada(s)';
    $('batchInfo').textContent = msg;
    rematchAll(); renderCells(); renderOutput(); drawCanvas(); renderCatalog();
  });

  function editEntry(e, card) {
    card.innerHTML = '';
    var f = document.createElement('div');
    f.className = 'form';
    f.style.width = '100%';

    var selTier = document.createElement('select');
    selTier.appendChild(opt('', 'Tier...'));
    P.TIERS.forEach(function (t) { selTier.appendChild(opt(t.name, t.name + ' (' + t.range + ')')); });
    selTier.value = e.tier || '';

    var selEl = document.createElement('select');
    selEl.appendChild(opt('', 'Elemento...'));
    P.ELEMENTS.forEach(function (x) { selEl.appendChild(opt(x, x)); });
    selEl.value = e.element || '';

    var custom = document.createElement('input');
    custom.type = 'text';
    custom.placeholder = 'ou nome livre';
    custom.value = e.customName || '';

    var row = document.createElement('div');
    row.className = 'row';
    var save = document.createElement('button');
    save.className = 'btn mini'; save.textContent = 'Salvar';
    var can = document.createElement('button');
    can.className = 'btn ghost mini'; can.textContent = 'Cancelar';
    row.appendChild(save); row.appendChild(can);

    save.addEventListener('click', function () {
      if (custom.value.trim()) Cat.update(e.id, { customName: custom.value.trim() });
      else if (selTier.value && selEl.value) Cat.update(e.id, { tier: selTier.value, element: selEl.value });
      else { alert('Escolha tier + elemento, ou digite um nome livre.'); return; }
      rematchAll(); renderCells(); renderOutput(); renderCatalog();
    });
    can.addEventListener('click', renderCatalog);

    f.appendChild(selTier); f.appendChild(selEl); f.appendChild(custom); f.appendChild(row);
    card.appendChild(f);
  }

  function renderTiers() {
    var box = $('tiers');
    box.innerHTML = '';
    P.TIERS.forEach(function (t, idx) {
      var d = document.createElement('div');
      d.className = 'tier';
      var nm = document.createElement('input');
      nm.type = 'text'; nm.className = 'nm'; nm.value = t.name; nm.placeholder = 'Tier';
      var rg = document.createElement('input');
      rg.type = 'text'; rg.className = 'rg'; rg.value = t.range; rg.placeholder = '+0 a +5';
      var x = document.createElement('button');
      x.className = 'x'; x.textContent = 'x'; x.title = 'remover';
      x.addEventListener('click', function () {
        var lista = lerTiers();
        lista.splice(idx, 1);
        P.saveTiers(lista);
        renderTiers(); renderCatalog(); renderCells(); renderOutput();
        $('tierMsg').textContent = 'removido';
      });
      d.appendChild(nm); d.appendChild(rg); d.appendChild(x);
      box.appendChild(d);
    });
  }

  function lerTiers() {
    return [].map.call($('tiers').querySelectorAll('.tier'), function (d) {
      return {
        name: d.querySelector('.nm').value,
        range: d.querySelector('.rg').value
      };
    });
  }

  $('btnTierAdd').addEventListener('click', function () {
    var lista = lerTiers();
    lista.push({ name: '', range: '' });
    $('tiers').innerHTML = '';
    P.TIERS = lista;
    renderTiers();
    var ins = $('tiers').querySelectorAll('.tier .nm');
    if (ins.length) ins[ins.length - 1].focus();
  });

  $('btnTierSave').addEventListener('click', function () {
    P.saveTiers(lerTiers());
    renderTiers(); renderCatalog(); renderCells(); renderOutput();
    $('tierMsg').textContent = P.TIERS.length + ' tiers salvos';
  });

  $('btnTierReset').addEventListener('click', function () {
    if (!confirm('Voltar os tiers para o padrao do jogo?')) return;
    P.resetTiers();
    renderTiers(); renderCatalog(); renderCells(); renderOutput();
    $('tierMsg').textContent = 'padrao restaurado';
  });

  function renderCatalog() {
    var box = $('catalog');
    box.innerHTML = '';
    $('catInfo').textContent = Cat.entries.length + ' registradas - ' + P.digitCount() + ' modelos de digito';
    Cat.entries.forEach(function (e) {
      var d = document.createElement('div');
      d.className = 'cat';
      var c = document.createElement('canvas');
      c.width = 38; c.height = 38;
      if (e.thumb) {
        var i2 = new Image();
        i2.onload = function () { c.getContext('2d').drawImage(i2, 0, 0, 38, 38); };
        i2.src = e.thumb;
      }
      var t = document.createElement('div');
      t.className = 't';
      var b = document.createElement('b');
      b.textContent = Cat.label(e);
      var s = document.createElement('span');
      s.textContent = (e.range || '') + ' - ' + e.sigs.length + ' amostra(s)';
      t.appendChild(b); t.appendChild(s);
      var ed = document.createElement('button');
      ed.className = 'x'; ed.textContent = '✎'; ed.title = 'editar';
      ed.addEventListener('click', function () { editEntry(e, d); });
      var x = document.createElement('button');
      x.className = 'x'; x.textContent = 'x'; x.title = 'remover';
      x.addEventListener('click', function () {
        if (!confirm('Remover "' + Cat.label(e) + '" do catalogo?')) return;
        Cat.remove(e.id);
        rematchAll(); renderCells(); renderOutput(); drawCanvas(); renderCatalog();
      });
      d.appendChild(c); d.appendChild(t); d.appendChild(ed); d.appendChild(x);
      box.appendChild(d);
    });
  }

  $('btnExport').addEventListener('click', function () {
    download('catalog.json', Cat.exportJSON(), 'application/json');
    status('exportado - substitua data/catalog.json no repositorio');
  });
  $('btnImport').addEventListener('click', function () { $('importFile').click(); });
  $('importFile').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var n = Cat.importJSON(JSON.parse(fr.result), 'merge');
        status(resumoImport(n) || 'nada novo no arquivo');
        rematchAll(); renderCells(); renderOutput(); drawCanvas(); renderCatalog();
      } catch (err) { alert('JSON invalido'); }
    };
    fr.readAsText(f);
    e.target.value = '';
  });
  $('btnRepo').addEventListener('click', function () { loadRepoCatalog(true); });
  $('btnWipe').addEventListener('click', function () {
    if (!confirm('Apagar todo o catalogo salvo neste navegador?')) return;
    Cat.clear(); P.digitClearAll();
    rematchAll(); renderCells(); renderOutput(); drawCanvas(); renderCatalog();
  });

  function resumoImport(n) {
    var p = [];
    if (n.added) p.push(n.added + ' pedra(s) nova(s)');
    if (n.merged) p.push(n.sigs + ' amostra(s) somada(s) a ' + n.merged + ' pedra(s) que ja existiam');
    return p.join(' - ');
  }

  function loadRepoCatalog(force) {
    if (!force && Cat.entries.length) { renderCatalog(); return; }
    fetch('data/catalog.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) { renderCatalog(); return; }
        var n = Cat.importJSON(j, 'merge');
        var msg = resumoImport(n);
        if (msg) status(msg + ' (do repositorio)');
        rematchAll(); renderCells(); renderOutput(); drawCanvas(); renderCatalog();
      })
      .catch(function () { renderCatalog(); });
  }

  var statusTimer = null;
  function status(t) {
    $('status').textContent = t || '';
    clearTimeout(statusTimer);
    if (t) statusTimer = setTimeout(function () { $('status').textContent = ''; }, 6000);
  }

  P.loadTiers();
  Cat.load();
  renderTiers();
  renderCatalog();
  loadRepoCatalog(false);

})(window.PKA);
