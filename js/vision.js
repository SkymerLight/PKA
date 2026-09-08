window.PKA = window.PKA || {};
(function (P) {
  'use strict';

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
    for (var x = o; x < n; x += p) {
      var m = prof[x];
      if (x > 0 && prof[x - 1] > m) m = prof[x - 1];
      if (x + 1 < n && prof[x + 1] > m) m = prof[x + 1];
      vals.push(m);
    }
    return vals;
  }

  function bestPitch(prof, n) {
    var minP = 14, maxP = Math.floor(n / 2);
    if (maxP < minP) return 0;
    var scores = new Float64Array(maxP + 1);
    var best = 0, bestP = 0, p, o, vals, i;
    for (p = minP; p <= maxP; p++) {
      var bs = -1;
      for (o = 0; o < p; o++) {
        vals = combValues(prof, n, p, o);
        if (vals.length < 3) continue;
        var s = 0;
        for (i = 0; i < vals.length; i++) s += vals[i];
        var sc = s / vals.length;
        if (sc > bs) bs = sc;
      }
      scores[p] = bs;
      if (bs > best) { best = bs; bestP = p; }
    }
    if (!bestP) return 0;
    var thr = best * 0.90;
    for (var q = minP; q <= bestP; q++) {
      if (scores[q] >= thr) return q;
    }
    return bestP;
  }

  function combPhase(prof, n, p) {
    var o, i, vals, ms = -1, bestMean = -1, o2 = 0;
    var meds = new Float64Array(p), means = new Float64Array(p);
    for (o = 0; o < p; o++) {
      vals = combValues(prof, n, p, o);
      if (vals.length < 3) continue;
      meds[o] = median(vals.slice());
      var sm = 0;
      for (i = 0; i < vals.length; i++) sm += vals[i];
      means[o] = sm / vals.length;
      if (meds[o] > ms) ms = meds[o];
    }
    for (o = 0; o < p; o++) {
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

  P.detectGrid = function (img, region) {
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

    var pw = bestPitch(colP, rw), ph = bestPitch(rowP, rh);
    if (!pw || !ph) return null;

    if (Math.abs(pw - ph) / Math.max(pw, ph) < 0.18) {
      pw = ph = Math.round((pw + ph) / 2);
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
               bw <= cw * 0.45 && c.y0 <= ch * 0.60 && fill > 0.15;
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
    var coverage = gemCount / inner;
    if (gemCount < inner * 0.02) return { empty: true, digits: digits, cw: cw, ch: ch, ox: x0, oy: y0 };
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
      t[k] = (t[k] || []).concat(obj[k]).slice(-10);
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
