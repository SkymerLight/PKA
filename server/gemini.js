const MODELOS = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash']
  .filter((m, i, a) => m && a.indexOf(m) === i);

let modeloBom = null;

function ativo() { return !!process.env.GEMINI_API_KEY; }
function modelo() { return modeloBom || MODELOS[0]; }

function falha(status, msg) { const e = new Error(msg); e.status = status; return e; }

function b64(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  return m ? m[1] : null;
}

function rotulo(e) {
  if (e.customName) return e.customName;
  return e.tier + ' ' + e.element + ' Stone';
}

const ESQUEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      index: { type: 'INTEGER' },
      reference: { type: 'STRING' },
      tier: { type: 'STRING' },
      element: { type: 'STRING' },
      quantity: { type: 'INTEGER', nullable: true },
      confidence: { type: 'NUMBER' }
    },
    required: ['index', 'reference', 'tier', 'element', 'confidence']
  }
};

async function chamar(nome, corpo) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(nome) + ':generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(corpo),
      signal: ctl.signal
    });
    const txt = await r.text();
    return { status: r.status, txt };
  } finally { clearTimeout(t); }
}

async function identificar(consultas, entradas, tiers, elementos) {
  if (!ativo()) throw falha(503, 'IA desativada: defina GEMINI_API_KEY');
  const refs = entradas.filter(e => e.kind === 'stone' && b64(e.thumb)).slice(0, 48);
  const partes = [{
    text:
      'Voce ajuda a ler o inventario (bag) do jogo Poke Alliance.\n' +
      'Cada imagem marcada CONSULTA e um slot da bag: uma pedra de evolucao no centro e, num canto, ' +
      'um numero branco que e a quantidade.\n' +
      'As imagens marcadas REFERENCIA sao pedras ja identificadas, com o nome exato.\n' +
      'Regras:\n' +
      '- A mesma pedra tem o mesmo desenho, a mesma cor e o mesmo tamanho relativo. O desenho e o tamanho ' +
      'indicam o tier; a cor indica o elemento.\n' +
      '- Se a consulta for a mesma pedra de uma referencia, devolva em "reference" o nome EXATO da referencia ' +
      'e repita o tier e o elemento dela.\n' +
      '- Se nenhuma referencia for igual, deixe "reference" vazio e deduza tier e elemento. Tiers validos: ' +
      tiers.join(', ') + '. Elementos validos: ' + elementos.join(', ') + '.\n' +
      '- "quantity" e o numero branco do slot, ou null se nao for legivel.\n' +
      '- "confidence" de 0 a 1: seja honesto, use valores baixos quando estiver em duvida.\n' +
      'Responda somente o JSON, um objeto por consulta, usando o "index" de cada consulta.'
  }];
  for (const e of refs) {
    partes.push({ text: 'REFERENCIA: ' + rotulo(e) });
    partes.push({ inlineData: { mimeType: 'image/png', data: b64(e.thumb) } });
  }
  consultas.forEach((q, i) => {
    partes.push({ text: 'CONSULTA ' + i + ':' });
    partes.push({ inlineData: { mimeType: 'image/png', data: b64(q.image) } });
  });

  const corpo = {
    contents: [{ role: 'user', parts: partes }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: ESQUEMA }
  };

  const tentar = modeloBom ? [modeloBom] : MODELOS;
  let ultimo = null;
  for (const nome of tentar) {
    const r = await chamar(nome, corpo);
    if (r.status === 404) { ultimo = falha(502, 'modelo ' + nome + ' indisponivel'); continue; }
    if (r.status === 429) throw falha(429, 'limite gratuito da IA atingido, tente mais tarde');
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      if (/API key|PERMISSION|API_KEY/i.test(r.txt)) throw falha(502, 'chave da IA invalida ou sem permissao');
      ultimo = falha(502, 'a IA recusou o pedido');
      continue;
    }
    if (r.status >= 500) { ultimo = falha(502, 'a IA esta instavel, tente de novo'); continue; }
    modeloBom = nome;
    let dados;
    try {
      const j = JSON.parse(r.txt);
      const txt = j.candidates[0].content.parts.map(p => p.text || '').join('');
      dados = JSON.parse(txt);
    } catch (e) { throw falha(502, 'resposta da IA ilegivel'); }
    const porNome = new Map(refs.map(e => [rotulo(e).toLowerCase(), e]));
    return (Array.isArray(dados) ? dados : []).map(d => {
      const ref = d.reference ? porNome.get(String(d.reference).toLowerCase()) : null;
      const label = ref
        ? { kind: 'stone', tier: ref.tier, element: ref.element, customName: ref.customName || '' }
        : { kind: 'stone', tier: String(d.tier || ''), element: String(d.element || ''), customName: '' };
      const q = d.quantity == null ? null : Math.round(Number(d.quantity));
      return {
        index: Math.round(Number(d.index)),
        label: label.customName || (label.tier && label.element) ? label : null,
        reference: !!ref,
        qty: q != null && q >= 0 && q < 100000 ? q : null,
        conf: Math.max(0, Math.min(1, Number(d.confidence) || 0))
      };
    }).filter(x => x.index >= 0 && x.index < consultas.length);
  }
  throw ultimo || falha(502, 'IA indisponivel');
}

module.exports = { ativo, modelo, identificar };
