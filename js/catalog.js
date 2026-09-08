(function (P) {
  'use strict';

  var KEY = 'pka_catalog_v1';

  P.TIERS = [
    { name: 'Novice',    range: '+0 a +5' },
    { name: 'Elemental', range: '+6 a +10' },
    { name: 'Common',    range: '+11 a +15' },
    { name: 'Enhanced',  range: '+16 a +20' }
  ];

  P.ELEMENTS = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting',
    'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon',
    'Dark', 'Steel', 'Fairy'];

  function rangeOf(tier) {
    for (var i = 0; i < P.TIERS.length; i++) if (P.TIERS[i].name === tier) return P.TIERS[i].range;
    return '';
  }
  P.rangeOf = rangeOf;

  function l1(a, b) {
    var s = 0, n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
    return s;
  }

  function featDist(a, b) {
    if (!a || !b) return 9;
    var dShape = l1(a.shape, b.shape) / a.shape.length;
    var dHue = l1(a.hue, b.hue) / 2;
    var dGrid = l1(a.grid, b.grid) / a.grid.length;
    var dSize = (Math.abs(a.size[0] - b.size[0]) +
                 Math.abs(a.size[1] - b.size[1]) +
                 Math.abs(a.size[2] - b.size[2]) * 2) / 2;
    return 0.28 * dShape + 0.27 * dHue + 0.33 * dGrid + 0.12 * Math.min(1, dSize);
  }
  P.featDist = featDist;

  var Catalog = {
    entries: [],

    load: function () {
      try {
        var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (raw && Array.isArray(raw.entries)) this.entries = raw.entries;
      } catch (e) { this.entries = []; }
      return this.entries;
    },

    save: function () {
      try {
        localStorage.setItem(KEY, JSON.stringify({ version: 1, entries: this.entries }));
      } catch (e) {
        alert('Nao consegui salvar o catalogo no navegador (armazenamento cheio?).');
      }
    },

    label: function (e) {
      if (e.kind === 'ignore') return e.customName || 'Ignorado';
      if (e.customName) return e.customName;
      return e.tier + ' ' + e.element + ' Stone';
    },

    line: function (e, qty) {
      var q = (qty === null || qty === undefined || !isFinite(qty)) ? '?' : qty;
      if (e.customName) {
        return q + ' ' + e.customName + (e.range ? ' (' + e.range + ')' : '');
      }
      var noun = (q === 1) ? 'Stone' : 'Stones';
      var r = e.range || rangeOf(e.tier);
      return q + ' ' + e.tier + ' ' + e.element + ' ' + noun + (r ? ' (' + r + ')' : '');
    },

    add: function (data, feat, thumb) {
      var e = {
        id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        kind: data.kind || 'stone',
        tier: data.tier || '',
        element: data.element || '',
        customName: data.customName || '',
        range: data.range || (data.customName ? '' : rangeOf(data.tier)),
        thumb: thumb || '',
        sigs: feat ? [feat] : []
      };
      this.entries.push(e);
      this.save();
      return e;
    },

    addSig: function (id, feat) {
      var e = this.byId(id);
      if (!e || !feat) return;
      for (var i = 0; i < e.sigs.length; i++) if (featDist(e.sigs[i], feat) < 0.03) return;
      e.sigs.push(feat);
      if (e.sigs.length > 12) e.sigs.shift();
      this.save();
    },

    byId: function (id) {
      for (var i = 0; i < this.entries.length; i++) if (this.entries[i].id === id) return this.entries[i];
      return null;
    },

    remove: function (id) {
      this.entries = this.entries.filter(function (e) { return e.id !== id; });
      this.save();
    },

    clear: function () { this.entries = []; this.save(); },

    match: function (feat, tol) {
      if (!feat) return null;
      var scored = [];
      for (var i = 0; i < this.entries.length; i++) {
        var e = this.entries[i], bd = 9;
        for (var j = 0; j < e.sigs.length; j++) {
          var d = featDist(e.sigs[j], feat);
          if (d < bd) bd = d;
        }
        scored.push({ entry: e, dist: bd });
      }
      scored.sort(function (a, b) { return a.dist - b.dist; });
      var alts = scored.slice(0, 3);
      if (!scored.length || scored[0].dist > tol) return { entry: null, dist: scored.length ? scored[0].dist : 9, alts: alts };
      return { entry: scored[0].entry, dist: scored[0].dist, alts: alts };
    },
    exportJSON: function () {
      return JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        digits: P.digitExport(),
        entries: this.entries.map(function (e) {
          var c = JSON.parse(JSON.stringify(e));
          c.sigs = c.sigs.map(function (s) {
            return {
              shape: s.shape.map(r3), hue: s.hue.map(r3),
              grid: s.grid.map(r3), size: s.size.map(r3)
            };
          });
          return c;
        })
      }, null, 1);
    },
    importJSON: function (obj, mode) {
      if (!obj || !Array.isArray(obj.entries)) return 0;
      if (mode === 'replace') this.entries = [];
      var have = {};
      this.entries.forEach(function (e) { have[e.id] = 1; });
      var added = 0;
      obj.entries.forEach(function (e) {
        if (!e || !e.id || have[e.id]) return;
        if (!Array.isArray(e.sigs)) e.sigs = [];
        this.entries.push(e); added++;
      }, this);
      if (obj.digits) P.digitImport(obj.digits);
      this.save();
      return added;
    }
  };
  function r3(v) { return Math.round(v * 1000) / 1000; }
  P.Catalog = Catalog;
})(window.PKA);
