/*
 * Klondike Solitaire — the classic "turn one" solitaire.
 * Rules supplied to the shared engine (window.Solitaire).
 *   • 7 tableau piles, 4 foundations (build up by suit from Ace), stock + waste (draw 1).
 *   • Tableau builds down in alternating colours; only a King fills an empty pile.
 */
(function () {
  "use strict";

  function isRun(group) { // descending, alternating colour
    for (var i = 0; i < group.length - 1; i++) {
      var a = group[i], b = group[i + 1];
      if (b.rank !== a.rank - 1) return false;
      if (Solitaire.isRed(a.suit) === Solitaire.isRed(b.suit)) return false;
    }
    return true;
  }
  function top(p) { return p.cards.length ? p.cards[p.cards.length - 1] : null; }

  function fitsFoundation(card, p) {
    var t = top(p);
    if (!t) return card.rank === 1;            // empty foundation takes an Ace
    return t.suit === card.suit && card.rank === t.rank + 1;
  }
  function fitsTableau(card, p) {
    var t = top(p);
    if (!t) return card.rank === 13;           // empty tableau takes a King
    return t.faceUp && card.rank === t.rank - 1 && Solitaire.isRed(card.suit) !== Solitaire.isRed(t.suit);
  }

  Solitaire.create({
    key: "kl", name: "Klondike Solitaire", emoji: "♠", seedSalt: 1,

    makeDeck: function () {
      var deck = [], id = 0;
      for (var s = 0; s < 4; s++) for (var r = 1; r <= 13; r++) deck.push({ suit: s, rank: r, faceUp: false, id: "k" + (id++) });
      return deck;
    },

    layout: function () {
      return {
        top: [
          { id: "f0", type: "foundation", zone: "foundations", hint: "A" },
          { id: "f1", type: "foundation", zone: "foundations", hint: "A" },
          { id: "f2", type: "foundation", zone: "foundations", hint: "A" },
          { id: "f3", type: "foundation", zone: "foundations", hint: "A" },
          { spacer: true },
          { id: "waste", type: "waste", zone: "stockwaste" },
          { id: "stock", type: "stock", zone: "stockwaste" }
        ],
        tableau: [0, 1, 2, 3, 4, 5, 6].map(function (i) { return { id: "t" + i, type: "tableau", zone: "tableau" }; })
      };
    },

    deal: function (api, deck) {
      var k = 0;
      for (var i = 0; i < 7; i++) {
        var p = api.pile("t" + i);
        for (var j = 0; j <= i; j++) { var c = deck[k++]; c.faceUp = (j === i); p.cards.push(c); }
      }
      var stock = api.pile("stock");
      while (k < deck.length) { deck[k].faceUp = false; stock.cards.push(deck[k]); k++; }
    },

    canPickup: function (group, p, api) {
      if (!group.length || p.type === "stock") return false;
      if (p.type === "foundation" || p.type === "waste") return group.length === 1;
      // tableau
      if (group.some(function (c) { return !c.faceUp; })) return false;
      return isRun(group);
    },

    canDrop: function (group, dest, api) {
      if (dest.type === "stock" || dest.type === "waste") return false;
      if (dest.type === "foundation") return group.length === 1 && fitsFoundation(group[0], dest);
      if (dest.type === "tableau") return fitsTableau(group[0], dest);
      return false;
    },

    autoMove: function (group, src, api) {
      // single card: foundation first, then any tableau
      if (group.length === 1) {
        var fs = api.pilesByZone("foundations");
        for (var i = 0; i < fs.length; i++) if (fitsFoundation(group[0], fs[i])) return fs[i];
      }
      var ts = api.pilesByZone("tableau");
      // prefer a non-empty pile so we don't pointlessly shuffle Kings between empties
      for (var k = 0; k < ts.length; k++) if (ts[k] !== src && ts[k].cards.length && fitsTableau(group[0], ts[k])) return ts[k];
      for (var m = 0; m < ts.length; m++) if (ts[m] !== src && !ts[m].cards.length && fitsTableau(group[0], ts[m])) return ts[m];
      return null;
    },

    onStock: function (api) {
      var stock = api.pile("stock"), waste = api.pile("waste");
      if (stock.cards.length) {
        var c = stock.cards.pop(); c.faceUp = true; waste.cards.push(c);
        return true;
      }
      if (waste.cards.length) { // recycle
        while (waste.cards.length) { var w = waste.cards.pop(); w.faceUp = false; stock.cards.push(w); }
        return true;
      }
      return false;
    },

    afterMove: function (api) {
      api.pilesByZone("tableau").forEach(function (p) {
        var t = top(p); if (t && !t.faceUp) t.faceUp = true;
      });
    },

    progress: function (api) {
      var n = 0; api.pilesByZone("foundations").forEach(function (p) { n += p.cards.length; });
      return n + "/52";
    },

    isWon: function (api) {
      var fs = api.pilesByZone("foundations");
      return fs.length === 4 && fs.every(function (p) { return p.cards.length === 13; });
    }
  });
})();
