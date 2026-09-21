const zlib = require('zlib');

function decode(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('arquivo nao e PNG');
  let p = 8, ihdr = null, plte = null, trns = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        depth: data[8], color: data[9], interlace: data[12]
      };
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr) throw new Error('PNG sem cabecalho');
  if (ihdr.interlace) throw new Error('PNG entrelacado nao suportado');
  if (ihdr.depth !== 8 && ihdr.depth !== 16) throw new Error('profundidade de cor nao suportada');
  if (ihdr.width * ihdr.height > 16e6) throw new Error('imagem grande demais');

  const canais = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color];
  if (!canais) throw new Error('tipo de cor nao suportado');
  const amostra = ihdr.depth / 8;
  const bpp = canais * amostra;
  const rowBytes = ihdr.width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));

  const out = Buffer.alloc(ihdr.height * rowBytes);
  let pos = 0;
  for (let y = 0; y < ihdr.height; y++) {
    const filtro = raw[pos++];
    const base = y * rowBytes, ant = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? out[base + x - bpp] : 0;
      const b = y > 0 ? out[ant + x] : 0;
      const c = (y > 0 && x >= bpp) ? out[ant + x - bpp] : 0;
      let v = raw[pos + x];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filtro !== 0) throw new Error('filtro PNG invalido');
      out[base + x] = v & 0xff;
    }
    pos += rowBytes;
  }

  const W = ihdr.width, H = ihdr.height;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const s = i * bpp, d = i * 4;
    let r, g, b, al = 255;
    if (ihdr.color === 0) { r = g = b = out[s]; }
    else if (ihdr.color === 4) { r = g = b = out[s]; al = out[s + amostra]; }
    else if (ihdr.color === 2) { r = out[s]; g = out[s + amostra]; b = out[s + 2 * amostra]; }
    else if (ihdr.color === 6) { r = out[s]; g = out[s + amostra]; b = out[s + 2 * amostra]; al = out[s + 3 * amostra]; }
    else {
      const k = out[s] * 3;
      r = plte[k]; g = plte[k + 1]; b = plte[k + 2];
      if (trns && out[s] < trns.length) al = trns[out[s]];
    }
    rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = al;
  }
  return { width: W, height: H, data: rgba };
}

let TABELA = null;
function crc32(b) {
  if (!TABELA) {
    TABELA = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABELA[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABELA[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encode(img) {
  const W = img.width, H = img.height, d = img.data;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W * 4; x++) raw[y * (W * 4 + 1) + 1 + x] = d[y * W * 4 + x];
  }
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

function resize(img, rect, outW, outH) {
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const fx = rect.x + (x + 0.5) * rect.w / outW - 0.5;
      const fy = rect.y + (y + 0.5) * rect.h / outH - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const d = (y * outW + x) * 4;
      for (let k = 0; k < 4; k++) {
        const v00 = px(img, x0, y0, k), v10 = px(img, x0 + 1, y0, k);
        const v01 = px(img, x0, y0 + 1, k), v11 = px(img, x0 + 1, y0 + 1, k);
        out[d + k] = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
      }
    }
  }
  return { width: outW, height: outH, data: out };
}

function px(img, x, y, k) {
  x = Math.min(img.width - 1, Math.max(0, x));
  y = Math.min(img.height - 1, Math.max(0, y));
  return img.data[(y * img.width + x) * 4 + k];
}

function dataURL(img) {
  return 'data:image/png;base64,' + encode(img).toString('base64');
}

function fromDataURL(s) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ''));
  return m ? Buffer.from(m[1], 'base64') : null;
}

module.exports = { decode, encode, resize, dataURL, fromDataURL };
