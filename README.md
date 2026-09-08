# PKA Stone Reader

Leitor de print da bag do **Poke Alliance**: você joga a captura de tela e ele devolve a lista
de pedras com as quantidades, no formato:

```
6 Common Flying Stones (+11 a +15)
4 Common Poison Stones (+11 a +15)
8 Common Normal Stones (+11 a +15)
6 Elemental Ice Stones (+6 a +10)
```

Site estático, roda 100% no navegador (nenhuma imagem sai do seu PC).

## Como usar

1. Abra o site (GitHub Pages) ou o `index.html` local.
2. Arraste a print, escolha o arquivo, ou cole com `Ctrl+V`.
3. O app detecta a grade da bag sozinho. Se pegar área errada (barra de título, etc.),
   clique em **Selecionar área** e arraste em volta só dos slots — ou abra **Ajustar grade**
   e acerte X/Y/tamanho da célula na mão.
4. Cada célula vira um cartão:
   - **verde** — pedra reconhecida e quantidade lida;
   - **amarelo** — pedra reconhecida, quantidade não lida (digite);
   - **vermelho** — pedra desconhecida (aparece a posição: `Linha 2, Coluna 3`);
   - **cinza** — item marcado como ignorado.
5. Nos vermelhos, clique em **Registrar**, escolha *tier* + *elemento* (ou digite um nome livre)
   e salve. Todas as células iguais na imagem são reconhecidas na hora, e as próximas prints
   já saem prontas.
6. **Copiar** ou **Baixar .txt** para levar a lista.

## Como ele reconhece

Para cada célula o app calcula uma assinatura com quatro partes:

| parte | o que captura |
|---|---|
| máscara de forma 10×10 | o recorte/lapidação da pedra (separa os tiers) |
| histograma de matiz (24 bins) | a cor, ou seja o elemento |
| grade de cor 4×4 | onde estão as facetas claras/escuras |
| tamanho relativo | largura, altura e área ocupada |

A comparação é vizinho-mais-próximo com tolerância ajustável (slider **Tolerância**).
Aumente se pedras iguais estiverem vindo como desconhecidas; diminua se ele estiver
confundindo pedras parecidas.

### Os números

Os dígitos são recortados por componentes conectados e lidos em duas etapas:

1. **Modelos próprios** — comparação com os glifos já aprendidos. Instantâneo, offline, e só
   devolve um valor quando o casamento é confiável; na dúvida deixa em branco, porque
   preencher a quantidade errada em silêncio seria pior.
2. **Tesseract.js** (via CDN, opcional) — palpite inicial quando ainda não há modelo. Leituras
   com confiança baixa ficam marcadas em amarelo para você conferir.

O app **só memoriza os números que você digita ou corrige** — nunca os palpites do Tesseract.
Um erro do OCR virado modelo se propagaria como "certeza" nas próximas prints. Na prática:
confirme cada dígito uma vez e daí em diante a leitura é local e imediata.

## Catálogo

O que você registra fica no `localStorage` do navegador. Para que o catálogo acompanhe o
repositório (e funcione em outro PC / outro navegador):

1. **Exportar JSON**
2. substitua `data/catalog.json` pelo arquivo baixado
3. commit + push

O site carrega e mescla esse arquivo no primeiro acesso.

## Tiers

| tier | range |
|---|---|
| Novice | +0 a +5 |
| Elemental | +6 a +10 |
| Common | +11 a +15 |
| Enhanced | +16 a +20 |

Para editar, mude `P.TIERS` em [`js/catalog.js`](js/catalog.js).

## Rodar local

Abrir o `index.html` direto funciona (o catálogo vem do `localStorage`), mas para que
`data/catalog.json` seja carregado é preciso um servidor:

```bash
python -m http.server 8000
```

## Publicar no GitHub Pages

No repositório: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `/ (root)`**.
O site fica em `https://skymerlight.github.io/PKA/`.

## Estrutura

```
index.html          página
css/style.css       estilo
js/vision.js        detecção de grade, segmentação da célula, assinatura, OCR próprio
js/catalog.js       catálogo, distância entre assinaturas, formatação das linhas
js/app.js           interface e fluxo
data/catalog.json   catálogo versionado no repositório
```
