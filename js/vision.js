window.PKA = window.PKA || {};
(function (P) {
  'use strict';

  P.SIG_VERSION = 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  P.clamp = clamp;

  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d > 0) {
      if (mx === r) h = ((g - b) / d + 6) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, mx === 0 ? 0 : d / mx, mx];
  }
  P.rgb2hsv = rgb2hsv;

  function median(arr) {
    if (!arr.length) return 0;
    arr.sort(function (a, b) { return a - b; });
    return arr[arr.length >> 1];
  }

  function combValues(prof, n, p, o) {
    var vals = [];
    for (var t = o; t < n; t += p) {
      var x = Math.round(t);
      if (x < 0 || x >= n) continue;
      var m = prof[x];
      if (x > 0 && prof[x - 1] > m) m = prof[x - 1];
      if (x + 1 < n && prof[x + 1] > m) m = prof[x + 1];
      vals.push(m);
    }
    return vals;
  }

  function combMean(prof, n, p) {
    var bs = -1;
    for (var o = 0; o < Math.ceil(p); o++) {
      var vals = combValues(prof, n, p, o);
      if (vals.length < 3) continue;
      var s = 0;
      for (var i = 0; i < vals.length; i++) s += vals[i];
      var sc = s / vals.length;
      if (sc > bs) bs = sc;
    }
    return bs;
  }

  function clipProfile(prof, n) {
    var s = Array.prototype.slice.call(prof).sort(function (a, b) { return a - b; });
    var cap = s[Math.min(n - 1, Math.floor(n * 0.90))];
    var out = new Float64Array(n);
    for (var i = 0; i < n; i++) out[i] = prof[i] < cap ? prof[i] : cap;
    return out;
  }

  function autoPitch(prof, n) {
    var minLag = 14, maxLag = Math.floor(n / 2), i, k, x;
    if (maxLag < minLag) return 0;
    var mean = 0;
    for (i = 0; i < n; i++) mean += prof[i];
    mean /= n;
    var f = new Float64Array(n);
    for (i = 0; i < n; i++) f[i] = prof[i] - mean;
    var R = new Float64Array(maxLag + 1), best = -Infinity;
    for (k = minLag; k <= maxLag; k++) {
      var s = 0, c = 0;
      for (x = 0; x + k < n; x++) { s += f[x] * f[x + k]; c++; }
      R[k] = c ? s / c : 0;
      if (R[k] > best) best = R[k];
    }
    if (!(best > 0)) return 0;
    for (k = minLag; k <= maxLag; k++) if (R[k] >= best * 0.90) return k;
    return 0;
  }

  function refinePitch(prof, n, p) {
    var best = p, bs = combMean(prof, n, p);
    for (var d = -0.6; d <= 0.6001; d += 0.05) {
      var q = p + d;
      if (q < 13) continue;
      var s = combMean(prof, n, q);
      if (s > bs) { bs = s; best = q; }
    }
    return Math.round(best * 20) / 20;
  }

  function combPhase(prof, n, p) {
    var o, i, vals, ms = -1, bestMean = -1, o2 = 0;
    var np = Math.ceil(p);
    var meds = new Float64Array(np), means = new Float64Array(np);
    for (o = 0; o < np; o++) {
      vals = combValues(prof, n, p, o);
      if (vals.length < 3) continue;
      meds[o] = median(vals.slice());
      var sm = 0;
      for (i = 0; i < vals.length; i++) sm += vals[i];
      means[o] = sm / vals.length;
      if (meds[o] > ms) ms = meds[o];
    }
    for (o = 0; o < np; o++) {
      if (meds[o] >= ms * 0.98 && means[o] > bestMean) { bestMean = means[o]; o2 = o; }
    }
    vals = combValues(prof, n, p, o2);
    var lim = median(vals.slice()) * 0.45;
    var first = -1, last = -1;
    for (i = 0; i < vals.length; i++) {
      if (vals[i] < lim) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0) { first = 0; last = vals.length - 1; }
    return { offset: o2 + first * p, count: last - first + 1 };
  }

  function gradePorGemas(img, region) {
    var W = img.width, H = img.height, d = img.data;
    var rx = region ? Math.max(0, region.x) : 0;
    var ry = region ? Math.max(0, region.y) : 0;
    var rw = region ? Math.min(W - rx, region.w) : W;
    var rh = region ? Math.min(H - ry, region.h) : H;
    if (rw < 40 || rh < 40) return null;

    var n = rw * rh, i, x, y;
    var lum = new Float32Array(n), amostra = [];
    for (y = 0; y < rh; y++) for (x = 0; x < rw; x++) {
      i = ((y + ry) * W + (x + rx)) * 4;
      var L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      lum[y * rw + x] = L;
      if ((y * rw + x) % 7 === 0) amostra.push(L);
    }
    amostra.sort(function (a, b) { return a - b; });
    var fundo = amostra[Math.floor(amostra.length * 0.35)];

    var mask = new Uint8Array(n);
    for (y = 0; y < rh; y++) for (x = 0; x < rw; x++) {
      var k = y * rw + x;
      i = ((y + ry) * W + (x + rx)) * 4;
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (lum[k] > fundo + 26 && !(mx > 195 && sat < 0.22)) mask[k] = 1;
    }

    var pecas = components(mask, rw, rh, 90);
    var gemas = [];
    for (i = 0; i < pecas.length; i++) {
      var c = pecas[i];
      var bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      if (bw < 11 || bw > 30 || bh < 11 || bh > 30) continue;
      if (c.px.length > 700) continue;
      if (c.px.length / (bw * bh) <= 0.45) continue;
      if (Math.abs(bw - bh) > 9) continue;
      gemas.push({ cx: (c.x0 + c.x1) / 2, cy: (c.y0 + c.y1) / 2 });
    }
    if (gemas.length < 4) return null;

    var dx = [];
    gemas.forEach(function (a) {
      gemas.forEach(function (b) {
        if (a !== b && Math.abs(a.cy - b.cy) < 6 && b.cx > a.cx) dx.push(b.cx - a.cx);
      });
    });
    dx.sort(function (a, b) { return a - b; });
    var pitch = dx.length ? dx[Math.floor(dx.length * 0.25)] : 0;
    if (pitch < 26 || pitch > 44) return null;

    var porY = gemas.slice().sort(function (a, b) { return a.cy - b.cy; });
    var faixas = [[porY[0]]];
    for (i = 1; i < porY.length; i++) {
      if (porY[i].cy - porY[i - 1].cy > pitch * 0.45) faixas.push([porY[i]]);
      else faixas[faixas.length - 1].push(porY[i]);
    }
    var maior = 0;
    faixas.forEach(function (f) { if (f.length > maior) maior = f.length; });
    var minimo = Math.min(2, maior);
    var boas = [];
    faixas.forEach(function (f) { if (f.length >= minimo) boas = boas.concat(f); });
    if (boas.length < 4) return null;

    var cxs = boas.map(function (g) { return g.cx; });
    var cys = boas.map(function (g) { return g.cy; });
    var cx0 = Math.min.apply(null, cxs), cx1 = Math.max.apply(null, cxs);
    var cy0 = Math.min.apply(null, cys), cy1 = Math.max.apply(null, cys);
    var cols = Math.round((cx1 - cx0) / pitch) + 1;
    var rows = Math.round((cy1 - cy0) / pitch) + 1;
    if (cols < 1 || rows < 1 || cols > 40 || rows > 40) return null;

    return {
      x: rx + cx0 - pitch / 2, y: ry + cy0 - pitch / 2,
      pw: pitch, ph: pitch, cols: cols, rows: rows, porGemas: true
    };
  }

  P.detectGrid = function (img, region) {
    var porGemas = gradePorGemas(img, region);
    if (porGemas) return porGemas;
    return gradePorPerfil(img, region);
  };

  function gradePorPerfil(img, region) {
    var w = img.width, d = img.data;
    var rx = region ? region.x : 0, ry = region ? region.y : 0;
    var rw = region ? region.w : img.width, rh = region ? region.h : img.height;
    if (rw < 40 || rh < 40) return null;

    var lum = new Float32Array(rw * rh), x, y, i;
    for (y = 0; y < rh; y++) {
      for (x = 0; x < rw; x++) {
        i = ((y + ry) * w + (x + rx)) * 4;
        lum[y * rw + x] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      }
    }
    var colP = new Float32Array(rw), rowP = new Float32Array(rh);
    for (y = 0; y < rh; y++) for (x = 1; x < rw; x++) colP[x] += Math.abs(lum[y * rw + x] - lum[y * rw + x - 1]);
    for (y = 1; y < rh; y++) for (x = 0; x < rw; x++) rowP[y] += Math.abs(lum[y * rw + x] - lum[(y - 1) * rw + x]);
    for (x = 0; x < rw; x++) colP[x] /= rh;
    for (y = 0; y < rh; y++) rowP[y] /= rw;

    var colC = clipProfile(colP, rw), rowC = clipProfile(rowP, rh);

    var pw = autoPitch(colC, rw), ph = autoPitch(rowC, rh);
    if (!pw || !ph) return null;

    pw = refinePitch(colP, rw, pw);
    ph = refinePitch(rowP, rh, ph);
    if (Math.abs(pw - ph) / Math.max(pw, ph) < 0.18) {
      pw = ph = Math.round((pw + ph) * 10) / 20;
    }
    var cc = combPhase(colP, rw, pw), cr = combPhase(rowP, rh, ph);

    var cols = Math.min(cc.count, Math.floor((rw - cc.offset) / pw));
    var rows = Math.min(cr.count, Math.floor((rh - cr.offset) / ph));
    if (cols < 1 || rows < 1) return null;

    return {
      x: rx + cc.offset, y: ry + cr.offset,
      pw: pw, ph: ph,
      cols: Math.min(cols, 40), rows: Math.min(rows, 40)
    };
  };

  var SH = 10;
  var CG = 4;
  var HB = 24;

  function components(mask, w, h, minPx) {
    var seen = new Uint8Array(w * h), out = [], stack = [];
    for (var s = 0; s < w * h; s++) {
      if (!mask[s] || seen[s]) continue;
      stack.length = 0; stack.push(s); seen[s] = 1;
      var px = [], x0 = w, y0 = h, x1 = -1, y1 = -1;
      while (stack.length) {
        var k = stack.pop(), kx = k % w, ky = (k / w) | 0;
        px.push(k);
        if (kx < x0) x0 = kx;
        if (kx > x1) x1 = kx;
        if (ky < y0) y0 = ky;
        if (ky > y1) y1 = ky;
        if (kx > 0 && mask[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack.push(k - 1); }
        if (kx < w - 1 && mask[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack.push(k + 1); }
        if (ky > 0 && mask[k - w] && !seen[k - w]) { seen[k - w] = 1; stack.push(k - w); }
        if (ky < h - 1 && mask[k + w] && !seen[k + w]) { seen[k + w] = 1; stack.push(k + w); }
      }
      if (px.length >= minPx) out.push({ px: px, x0: x0, y0: y0, x1: x1, y1: y1 });
    }
    return out;
  }

  var DW = 8, DH = 12;
  P.DW = DW; P.DH = DH;

  function toBitmap(comp, w) {
    var bw = comp.x1 - comp.x0 + 1, bh = comp.y1 - comp.y0 + 1;
    var acc = new Float32Array(DW * DH), cnt = new Float32Array(DW * DH);
    var set = {};
    for (var i = 0; i < comp.px.length; i++) set[comp.px[i]] = 1;
    for (var y = 0; y < bh; y++) {
      var gy = Math.min(DH - 1, (y * DH / bh) | 0);
      for (var x = 0; x < bw; x++) {
        var gx = Math.min(DW - 1, (x * DW / bw) | 0);
        var k = gy * DW + gx;
        cnt[k]++;
        if (set[(comp.y0 + y) * w + (comp.x0 + x)]) acc[k]++;
      }
    }
    var out = new Float32Array(DW * DH);
    for (var j = 0; j < out.length; j++) out[j] = cnt[j] ? acc[j] / cnt[j] : 0;
    return out;
  }

  P.analyzeCell = function (img, rect) {
    var W = img.width, d = img.data;
    var mn = Math.min(rect.w, rect.h);
    var padOut = Math.max(1, Math.round(mn * 0.02));
    var padIn = Math.max(padOut + 1, Math.round(mn * 0.10));
    var mg = padIn - padOut;
    var x0 = Math.round(rect.x) + padOut, y0 = Math.round(rect.y) + padOut;
    var cw = Math.round(rect.w) - 2 * padOut, ch = Math.round(rect.h) - 2 * padOut;
    var iw = cw - 2 * mg, ih = ch - 2 * mg;
    if (iw < 6 || ih < 6 || x0 < 0 || y0 < 0 || x0 + cw > img.width || y0 + ch > img.height) return null;
    var n = cw * ch, x, y, i, k, j, hsv;
    var R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n);
    for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) {
      i = ((y0 + y) * W + (x0 + x)) * 4; k = y * cw + x;
      R[k] = d[i]; G[k] = d[i + 1]; B[k] = d[i + 2];
    }
    var rs = [], gs = [], bs = [];
    for (y = mg; y < ch - mg; y++) for (x = mg; x < cw - mg; x++) {
      if (x > mg + 1 && x < cw - mg - 2 && y > mg + 1 && y < ch - mg - 2) continue;
      k = y * cw + x; rs.push(R[k]); gs.push(G[k]); bs.push(B[k]);
    }
    var bg = [median(rs), median(gs), median(bs)];
    var fg = new Uint8Array(n), white = new Uint8Array(n);
    var FGT = 58;
    for (k = 0; k < n; k++) {
      var dist = Math.abs(R[k] - bg[0]) + Math.abs(G[k] - bg[1]) + Math.abs(B[k] - bg[2]);
      if (dist > FGT) fg[k] = 1;
      hsv = rgb2hsv(R[k], G[k], B[k]);
      if (hsv[2] > 0.70 && hsv[1] < 0.42 && dist > 70) white[k] = 1;
    }
    var comps = components(white, cw, ch, Math.max(3, Math.round(n * 0.0012)));
    var digits = [], txt = new Uint8Array(n);
    comps.forEach(function (c) {
      var bh = c.y1 - c.y0 + 1, bw = c.x1 - c.x0 + 1;
      var fill = c.px.length / (bw * bh);
      var ok = bh >= ch * 0.11 && bh <= ch * 0.65 &&
               bw <= cw * 0.45 && fill > 0.15;
      if (ok) {
        digits.push({
          bmp: toBitmap(c, cw), x: c.x0, y: c.y0,
          box: { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }
        });
        for (var q = 0; q < c.px.length; q++) txt[c.px[q]] = 1;
      }
    });
    digits.sort(function (a, b) { return a.x - b.x; });

    var numBox = null;
    if (digits.length) {
      var nx0 = cw, ny0 = ch, nx1 = -1, ny1 = -1;
      digits.forEach(function (dg) {
        if (dg.box.x0 < nx0) nx0 = dg.box.x0;
        if (dg.box.y0 < ny0) ny0 = dg.box.y0;
        if (dg.box.x1 > nx1) nx1 = dg.box.x1;
        if (dg.box.y1 > ny1) ny1 = dg.box.y1;
      });
      var nw = nx1 - nx0 + 1, nh = ny1 - ny0 + 1;
      var nmask = new Uint8Array(nw * nh);
      for (y = ny0; y <= ny1; y++) for (x = nx0; x <= nx1; x++) {
        if (txt[y * cw + x]) nmask[(y - ny0) * nw + (x - nx0)] = 1;
      }
      numBox = { w: nw, h: nh, mask: nmask };
    }
    var txt2 = new Uint8Array(n);
    for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) {
      k = y * cw + x;
      if (!txt[k]) continue;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < cw && yy < ch) txt2[yy * cw + xx] = 1;
      }
    }
    var gem = new Uint8Array(n), gemCount = 0;
    for (y = mg; y < ch - mg; y++) for (x = mg; x < cw - mg; x++) {
      k = y * cw + x;
      if (fg[k] && !txt2[k]) { gem[k] = 1; gemCount++; }
    }
    var inner = iw * ih;
    if (gemCount < inner * 0.02) return { empty: true, digits: digits, cw: cw, ch: ch, ox: x0, oy: y0 };

    var pecas = components(gem, cw, ch, Math.max(10, Math.round(inner * 0.008)));
    if (!pecas.length) return { empty: true, digits: digits, cw: cw, ch: ch, ox: x0, oy: y0 };
    var meioX = cw / 2, meioY = ch / 2, alvo = null, melhor = -1;
    for (var pi = 0; pi < pecas.length; pi++) {
      var pc = pecas[pi];
      var pcx = (pc.x0 + pc.x1) / 2, pcy = (pc.y0 + pc.y1) / 2;
      var dCentro = Math.sqrt((pcx - meioX) * (pcx - meioX) + (pcy - meioY) * (pcy - meioY));
      var nota = pc.px.length / (1 + dCentro);
      if (nota > melhor) { melhor = nota; alvo = pc; }
    }
    var acx = (alvo.x0 + alvo.x1) / 2, acy = (alvo.y0 + alvo.y1) / 2;
    var fora = Math.sqrt((acx - meioX) * (acx - meioX) + (acy - meioY) * (acy - meioY));
    gem = new Uint8Array(n);
    for (var ai = 0; ai < alvo.px.length; ai++) gem[alvo.px[ai]] = 1;
    gemCount = alvo.px.length;
    var coverage = gemCount / inner;
    if (gemCount < inner * 0.08 || fora > Math.min(cw, ch) * 0.34) {
      return { empty: true, digits: digits, cw: cw, ch: ch, ox: x0, oy: y0 };
    }
    var bx0 = cw, by0 = ch, bx1 = -1, by1 = -1;
    for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) if (gem[y * cw + x]) {
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
    var bw2 = bx1 - bx0 + 1, bh2 = by1 - by0 + 1;
    var shape = new Float32Array(SH * SH), scnt = new Float32Array(SH * SH);
    var cgR = new Float32Array(CG * CG), cgG = new Float32Array(CG * CG),
        cgB = new Float32Array(CG * CG), cgN = new Float32Array(CG * CG);
    var hue = new Float32Array(HB), hueSum = 0;
    var mr = 0, mg = 0, mb = 0;
    for (y = by0; y <= by1; y++) {
      var sy = Math.min(SH - 1, ((y - by0) * SH / bh2) | 0);
      var gy2 = Math.min(CG - 1, ((y - by0) * CG / bh2) | 0);
      for (x = bx0; x <= bx1; x++) {
        k = y * cw + x;
        var si = sy * SH + Math.min(SH - 1, ((x - bx0) * SH / bw2) | 0);
        scnt[si]++;
        if (!gem[k]) continue;
        shape[si]++;
        var gi = gy2 * CG + Math.min(CG - 1, ((x - bx0) * CG / bw2) | 0);
        cgR[gi] += R[k]; cgG[gi] += G[k]; cgB[gi] += B[k]; cgN[gi]++;
        mr += R[k]; mg += G[k]; mb += B[k];
        hsv = rgb2hsv(R[k], G[k], B[k]);
        var wgt = hsv[1] * hsv[2];
        hue[Math.min(HB - 1, (hsv[0] * HB) | 0)] += wgt;
        hueSum += wgt;
      }
    }
    var sh = [];
    for (j = 0; j < SH * SH; j++) sh.push(scnt[j] ? shape[j] / scnt[j] : 0);
    var hu = [];
    for (j = 0; j < HB; j++) hu.push(hueSum > 0 ? hue[j] / hueSum : 0);
    var cg = [];
    for (j = 0; j < CG * CG; j++) {
      if (cgN[j]) cg.push(cgR[j] / cgN[j] / 255, cgG[j] / cgN[j] / 255, cgB[j] / cgN[j] / 255);
      else cg.push(bg[0] / 255, bg[1] / 255, bg[2] / 255);
    }
    return {
      empty: false,
      feat: { shape: sh, hue: hu, grid: cg, size: [bw2 / iw, bh2 / ih, coverage] },
      mean: [mr / gemCount, mg / gemCount, mb / gemCount],
      bg: bg, coverage: coverage,
      digits: digits, numBox: numBox, cw: cw, ch: ch, ox: x0, oy: y0
    };
  };
  var DKEY = 'pka_digits_v1';
  var tpl = null;

  function loadTpl() {
    if (tpl) return tpl;
    try { tpl = JSON.parse(localStorage.getItem(DKEY) || '{}'); } catch (e) { tpl = {}; }
    if (!tpl || typeof tpl !== 'object') tpl = {};
    return tpl;
  }
  function saveTpl() { try { localStorage.setItem(DKEY, JSON.stringify(tpl)); } catch (e) {} }
  function bmpDist(a, b) {
    var s = 0;
    for (var i = 0; i < a.length && i < b.length; i++) s += Math.abs(a[i] - b[i]);
    return s / (DW * DH);
  }
  P.digitCount = function () {
    var t = loadTpl(), c = 0;
    for (var k in t) c += t[k].length;
    return c;
  };
  P.digitClearAll = function () { tpl = {}; saveTpl(); };
  P.digitExport = function () { return loadTpl(); };
  P.digitImport = function (obj) {
    if (!obj || typeof obj !== 'object') return;
    var t = loadTpl();
    for (var k in obj) {
      if (!/^[0-9]$/.test(k) || !Array.isArray(obj[k])) continue;
      if (!t[k]) t[k] = [];
      for (var i = 0; i < obj[k].length; i++) {
        var b = obj[k][i];
        if (!Array.isArray(b)) continue;
        var dup = t[k].some(function (o) { return bmpDist(o, b) < 0.05; });
        if (!dup) t[k].push(b);
      }
      if (t[k].length > 10) t[k] = t[k].slice(-10);
    }
    saveTpl();
  };
  P.learnDigits = function (bitmaps, text) {
    if (!bitmaps || !bitmaps.length) return;
    text = String(text == null ? '' : text).replace(/[^0-9]/g, '');
    if (text.length !== bitmaps.length) return;
    var t = loadTpl();
    for (var i = 0; i < bitmaps.length; i++) {
      var ch = text.charAt(i);
      if (!t[ch]) t[ch] = [];
      var b = Array.prototype.slice.call(bitmaps[i]).map(function (v) { return Math.round(v * 100) / 100; });
      var dup = t[ch].some(function (o) { return bmpDist(o, b) < 0.05; });
      if (!dup) {
        t[ch].push(b);
        if (t[ch].length > 10) t[ch].shift();
      }
    }
    saveTpl();
  };
  P.readDigits = function (digits) {
    if (!digits || !digits.length) return null;
    var t = loadTpl(), out = '', worst = 0;
    for (var i = 0; i < digits.length; i++) {
      var best = null, d1 = 9, d2 = 9;
      for (var ch in t) {
        var dc = 9;
        for (var j = 0; j < t[ch].length; j++) {
          var dd = bmpDist(t[ch][j], digits[i].bmp);
          if (dd < dc) dc = dd;
        }
        if (dc < d1) { d2 = d1; d1 = dc; best = ch; }
        else if (dc < d2) d2 = dc;
      }
      if (best === null) return null;
      var confident = d1 <= 0.02 || (d1 <= 0.12 && d2 - d1 >= 0.04);
      if (!confident) return null;
      if (d1 > worst) worst = d1;
      out += best;
    }
    return { text: out, dist: worst };
  };
})(window.PKA);
