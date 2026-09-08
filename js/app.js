/* PKA Stone Reader - aplicacao */
(function (P) {
  'use strict';

  var Cat = P.Catalog;

  var state = {
    images: [],      // { name, el, w, h, data(ImageData), grid, region, cells }
    active: -1,
    tol: 0.16,
    dragging: null,
    regionMode: false
  };

  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), ctx = cv.getContext('2d', { willReadFrequently: true });

  /* ================= carregamento de imagens ================= */

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
        if (--pending === 0) {
          setActive(state.images.length - 1);
          renderStrip();
        }
      };
      im.onerror = function () {
        URL.revokeObjectURL(url);
        if (--pending === 0) { setActive(state.images.length - 1); renderStrip(); }
      };
      im.src = url;
    });
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
    if (!im.grid) autoDetect(); else { drawCanvas(); renderCells(); renderOutput(); }
  }

  /* ================= grade ================= */

  function autoDetect() {
    var im = cur();
    if (!im) return;
    status('detectando grade...');
    setTimeout(function () {
      var g = P.detectGrid(im.data, im.region);
      if (!g) { status('nao consegui detectar a grade - ajuste na mao'); $('gridbox').classList.remove('hidden'); drawCanvas(); return; }
      im.grid = g;
      fillGridInputs(g);
      analyze();
    }, 10);
  }

  function fillGridInputs(g) {
    $('gx').value = g.x; $('gy').value = g.y;
    $('gpx').value = g.pw; $('gpy').value = g.ph;
    $('gcols').value = g.cols; $('grows').value = g.rows;
  }

  function readGridInputs() {
    var im = cur();
    if (!im) return;
    im.grid = {
      x: +$('gx').value || 0, y: +$('gy').value || 0,
      pw: Math.max(8, +$('gpx').value || 32), ph: Math.max(8, +$('gpy').value || 32),
      cols: Math.max(1, +$('gcols').value || 1), rows: Math.max(1, +$('grows').value || 1)
    };
    analyze();
  }
  ['gx', 'gy', 'gpx', 'gpy', 'gcols', 'grows'].forEach(function (id) {
    $(id).addEventListener('change', readGridInputs);
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
    state.regionMode = !state.regionMode;
    this.classList.toggle('on', state.regionMode);
    status(state.regionMode ? 'arraste sobre a area da bag' : '');
  });
  $('btnClearRegion').addEventListener('click', function () {
    var im = cur(); if (!im) return;
    im.region = null; autoDetect();
  });

  /* ================= analise ================= */

  function analyze() {
    var im = cur();
    if (!im || !im.grid) return;
    status('analisando celulas...');
    setTimeout(function () {
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
            // modelos proprios: vieram de quantidades que voce confirmou, entao valem 100%
            var d = P.readDigits(res.digits);
            if (d) { cell.qty = String(parseInt(d.text, 10)); cell.qtySrc = 'auto'; cell.qtyConf = 100; }
          }
          cells.push(cell);
        }
      }
      im.cells = cells;
      rematchAll();
      drawCanvas(); renderCells(); renderOutput();
      var known = cells.filter(function (x) { return !x.empty; }).length;
      status(known + ' celulas com item');
      maybeOcr();
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

  /* ================= OCR opcional (Tesseract) ================= */

  var tessWorker = null, tessBusy = false;

  // Monta a imagem que vai para o Tesseract a partir do recorte ORIGINAL do
  // numero (numBox), so ampliado. Usar os bitmaps normalizados 8x12 aqui
  // deformaria os digitos e o OCR nao reconheceria nada.
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
        // De proposito NAO aprendemos com o Tesseract: ele erra as vezes, e um
        // erro virado modelo se propagaria como "certeza" nas proximas prints.
        // So o que voce confirma no campo de quantidade vira modelo.
      } catch (e) { /* segue sem OCR nessa celula */ }
    }
    tessBusy = false;
    var low = todo.filter(function (c) { return c.qtySrc === 'ocr' && c.qtyConf < 80; }).length;
    status('OCR concluido' + (low ? ' - ' + low + ' quantidade(s) com leitura duvidosa, confira as amarelas' : ''));
    renderCells(); renderOutput(); drawCanvas(); renderCatalog();
  }

  $('useOcr').addEventListener('change', function () { if (this.checked) maybeOcr(); });

  /* ================= desenho ================= */

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
    if (!state.regionMode) return;
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
  window.addEventListener('mouseup', function () {
    if (!state.dragging) return;
    var d = state.dragging, im = cur();
    state.dragging = null;
    if (im && d.w > 30 && d.h > 30) {
      im.region = { x: d.x, y: d.y, w: d.w, h: d.h };
      state.regionMode = false;
      $('btnRegion').classList.remove('on');
      autoDetect();
    } else drawCanvas();
  });

  function thumbOf(cell) {
    var im = cur(), c = document.createElement('canvas');
    c.width = 52; c.height = 52;
    c.getContext('2d').drawImage(im.el, cell.rect.x, cell.rect.y, cell.rect.w, cell.rect.h, 0, 0, 52, 52);
    return c;
  }

  /* ================= lista de celulas ================= */

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

    // sugestoes proximas (top 3) quando nao identificou
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

  /* ================= saida ================= */

  function renderOutput() {
    var imgs = $('sumAll').checked ? state.images : [cur()];
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
    $('output').textContent = lines.join('\n') || '(nada identificado ainda)';

    var w = [];
    if (unknown.length) w.push('Nao identificadas (' + unknown.length + '): ' + unknown.join(' | '));
    if (noqty.length) w.push('Sem quantidade (' + noqty.length + '): ' + noqty.join(' | '));
    $('warn').textContent = w.join('\n');
    $('warn').classList.toggle('hidden', !w.length);
  }

  $('sumAll').addEventListener('change', renderOutput);

  $('btnCopy').addEventListener('click', function () {
    var t = $('output').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { status('copiado'); });
    else {
      var ta = document.createElement('textarea');
      ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); status('copiado');
    }
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

  /* ================= catalogo ================= */

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
      var x = document.createElement('button');
      x.className = 'x'; x.textContent = 'x'; x.title = 'remover';
      x.addEventListener('click', function () {
        if (!confirm('Remover "' + Cat.label(e) + '" do catalogo?')) return;
        Cat.remove(e.id);
        rematchAll(); renderCells(); renderOutput(); drawCanvas(); renderCatalog();
      });
      d.appendChild(c); d.appendChild(t); d.appendChild(x);
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
        status(n + ' entradas importadas');
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

  function loadRepoCatalog(force) {
    if (!force && Cat.entries.length) { renderCatalog(); return; }
    fetch('data/catalog.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) { renderCatalog(); return; }
        var n = Cat.importJSON(j, 'merge');
        if (n) status(n + ' entradas carregadas do repositorio');
        rematchAll(); renderCells(); renderOutput(); drawCanvas(); renderCatalog();
      })
      .catch(function () { renderCatalog(); });
  }

  /* ================= util ================= */

  var statusTimer = null;
  function status(t) {
    $('status').textContent = t || '';
    clearTimeout(statusTimer);
    if (t) statusTimer = setTimeout(function () { $('status').textContent = ''; }, 6000);
  }

  Cat.load();
  renderCatalog();
  loadRepoCatalog(false);

})(window.PKA);
