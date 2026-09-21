const fs = require('fs');
const path = require('path');
const vm = require('vm');

function armazenamento() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); }
  };
}

function carregar() {
  const caixa = { console, localStorage: armazenamento(), alert() {} };
  caixa.window = caixa;
  vm.createContext(caixa);
  const dir = path.join(__dirname, '..', 'public', 'js');
  for (const f of ['vision.js', 'catalog.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), caixa, { filename: f });
  }
  return caixa.PKA;
}

module.exports = { P: carregar() };
