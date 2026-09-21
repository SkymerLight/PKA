const crypto = require('crypto');

const COOKIE = 'pka_s';
const VALIDADE = 30 * 24 * 3600 * 1000;

function criar(segredo) {
  const usuario = process.env.ADMIN_USER || 'admin';
  const senha = process.env.ADMIN_PASSWORD || '';
  const chave = crypto.createHash('sha256').update(segredo + '|' + senha).digest();
  const tentativas = new Map();

  function assinar(dados) {
    const corpo = Buffer.from(JSON.stringify(dados)).toString('base64url');
    const mac = crypto.createHmac('sha256', chave).update(corpo).digest('base64url');
    return corpo + '.' + mac;
  }

  function verificar(token) {
    if (!token || token.indexOf('.') < 0) return null;
    const [corpo, mac] = token.split('.');
    const esperado = crypto.createHmac('sha256', chave).update(corpo).digest('base64url');
    const a = Buffer.from(mac), b = Buffer.from(esperado);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const d = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
      return d.exp > Date.now() ? d : null;
    } catch (e) { return null; }
  }

  function cookies(req) {
    const out = {};
    String(req.headers.cookie || '').split(';').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
    return out;
  }

  function igual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  function seguro(req) {
    return req.headers['x-forwarded-proto'] === 'https' || !!(req.socket && req.socket.encrypted);
  }

  return {
    configurado: () => !!senha,
    isAdmin(req) {
      if (!senha) return false;
      const d = verificar(cookies(req)[COOKIE]);
      return !!(d && d.u === usuario);
    },
    login(req, res, ip, dados) {
      if (!senha) return { ok: false, status: 503, msg: 'defina ADMIN_PASSWORD nas variaveis do servidor' };
      const agora = Date.now();
      const t = (tentativas.get(ip) || []).filter(x => agora - x < 15 * 60 * 1000);
      if (t.length >= 10) return { ok: false, status: 429, msg: 'muitas tentativas, espere alguns minutos' };
      const certo = igual(dados.user || '', usuario) & igual(dados.password || '', senha);
      if (!certo) {
        t.push(agora); tentativas.set(ip, t);
        return { ok: false, status: 401, msg: 'usuario ou senha incorretos' };
      }
      tentativas.delete(ip);
      const token = assinar({ u: usuario, exp: agora + VALIDADE });
      res.setHeader('Set-Cookie', COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' +
        Math.floor(VALIDADE / 1000) + (seguro(req) ? '; Secure' : ''));
      return { ok: true };
    },
    logout(req, res) {
      res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (seguro(req) ? '; Secure' : ''));
    }
  };
}

module.exports = { criar };
