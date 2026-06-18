/*
 * FreeCell — the open-information solitaire (every card visible, nearly always solvable).
 *   • 8 cascades (all face up), 4 free cells, 4 foundations.
 *   • Tableau builds down in alternating colours. A run of N cards can move only if
 *     (1 + free cells) × 2^(empty columns) ≥ N  (the standard "supermove" limit).
 */
(function () {
  "use strict";

  function isRun(group) {
    for (var i = 0; i < group.length - 1; i++) {
      var a = group[i], b = group[i + 1];
      if (b.rank !== a.rank - 1) return false;
      if (Solitaire.isRed(a.suit) === Solitaire.isRed(b.suit)) return false;
    }
    return true;
  }
  function top(p) { return p.cards.length ? p.cards[p.cards.length - 1] : null; }
  function fitsFoundation(card, p) { var t = top(p); return t ? (t.suit === card.suit && card.rank === t.rank + 1) : card.rank === 1; }
  function fitsTableau(card, p) {
    var t = top(p);
    if (!t) return true;
    return card.rank === t.rank - 1 && Solitaire.isRed(card.suit) !== Solitaire.isRed(t.suit);
  }
  function freeOpen(api) { return api.pilesByZone("free").filter(function (p) { return !p.cards.length; }).length; }
  function emptyCols(api) { return api.pilesByZone("tableau").filter(function (p) { return !p.cards.length; }).length; }
  function maxMove(api, destEmpty) {
    var e = emptyCols(api); if (destEmpty) e = Math.max(0, e - 1);
    return (1 + freeOpen(api)) * Math.pow(2, e);
  }

  Solitaire.create({
    key: "fc", name: "FreeCell", emoji: "🃏", seedSalt: 2,

    makeDeck: function () {
      var deck = [], id = 0;
      for (var s = 0; s < 4; s++) for (var r = 1; r <= 13; r++) deck.push({ suit: s, rank: r, faceUp: true, id: "f" + (id++) });
      return deck;
    },

    layout: function () {
      return {
        top: [
          { id: "c0", type: "free", zone: "free" },
          { id: "c1", type: "free", zone: "free" },
          { id: "c2", type: "free", zone: "free" },
          { id: "c3", type: "free", zone: "free" },
          { spacer: true },
          { id: "f0", type: "foundation", zone: "foundations", hint: "A" },
          { id: "f1", type: "foundation", zone: "foundations", hint: "A" },
          { id: "f2", type: "foundation", zone: "foundations", hint: "A" },
          { id: "f3", type: "foundation", zone: "foundations", hint: "A" }
        ],
        tableau: [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return { id: "t" + i, type: "tableau", zone: "tableau" }; })
      };
    },

    deal: function (api, deck) {
      var counts = [7, 7, 7, 7, 6, 6, 6, 6], k = 0;
      for (var col = 0; col < 8; col++) {
        var p = api.pile("t" + col);
        for (var j = 0; j < counts[col]; j++) { var c = deck[k++]; c.faceUp = true; p.cards.push(c); }
      }
    },

    canPickup: function (group, p, api) {
      if (!group.length) return false;
      if (p.type === "free" || p.type === "foundation") return group.length === 1;
      return isRun(group); // tableau run (capacity is checked on drop)
    },

    canDrop: function (group, dest, api) {
      if (dest.type === "free") return group.length === 1 && dest.cards.length === 0;
      if (dest.type === "foundation") return group.length === 1 && fitsFoundation(group[0], dest);
      if (dest.type === "tableau") return fitsTableau(group[0], dest) && group.length <= maxMove(api, dest.cards.length === 0);
      return false;
    },

    autoMove: function (group, src, api) {
      var i, ps;
      if (group.length === 1) {
        ps = api.pilesByZone("foundations");
        for (i = 0; i < ps.length; i++) if (fitsFoundation(group[0], ps[i])) return ps[i];
      }
      ps = api.pilesByZone("tableau");
      for (i = 0; i < ps.length; i++) if (ps[i] !== src && ps[i].cards.length && fitsTableau(group[0], ps[i]) && group.length <= maxMove(api, false)) return ps[i];
      if (group.length === 1) {
        ps = api.pilesByZone("free");
        for (i = 0; i < ps.length; i++) if (!ps[i].cards.length) return ps[i];
      }
      ps = api.pilesByZone("tableau");
      for (i = 0; i < ps.length; i++) if (ps[i] !== src && !ps[i].cards.length && group.length <= maxMove(api, true)) return ps[i];
      return null;
    },

    progress: function (api) {
      var n = 0; api.pilesByZone("foundations").forEach(function (p) { n += p.cards.length; });
      return n + "/52";
    },

    isWon: function (api) {
      var fs = api.pilesByZone("foundations");
      return fs.every(function (p) { return p.cards.length === 13; });
    }
  });
})();
