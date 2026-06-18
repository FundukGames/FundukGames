/*
 * Spider Solitaire — two decks, 10 columns, 1 / 2 / 4 suits.
 *   • Build down by rank regardless of suit, but only same-suit runs move together.
 *   • A complete King→Ace run of one suit is removed automatically (8 to win).
 *   • The stock deals one card to every column at once (only when no column is empty).
 */
(function () {
  "use strict";

  function suitsFor(diff) { return diff === "4-suit" ? [0, 1, 2, 3] : diff === "2-suit" ? [0, 1] : [0]; }

  function sameSuitRun(group) { // descending by 1, all same suit, all face up
    for (var i = 0; i < group.length; i++) if (!group[i].faceUp) return false;
    for (var j = 0; j < group.length - 1; j++) {
      if (group[j + 1].rank !== group[j].rank - 1) return false;
      if (group[j + 1].suit !== group[j].suit) return false;
    }
    return true;
  }
  function top(p) { return p.cards.length ? p.cards[p.cards.length - 1] : null; }

  Solitaire.create({
    key: "sp", name: "Spider Solitaire", emoji: "🕷️", seedSalt: 3, defaultDiff: "1-suit",

    makeDeck: function (diff) {
      var suits = suitsFor(diff), copies = 104 / (13 * suits.length), deck = [], id = 0;
      for (var c = 0; c < copies; c++)
        for (var si = 0; si < suits.length; si++)
          for (var r = 1; r <= 13; r++) deck.push({ suit: suits[si], rank: r, faceUp: false, id: "s" + (id++) });
      return deck;
    },

    layout: function () {
      var top4 = [];
      for (var f = 0; f < 8; f++) top4.push({ id: "f" + f, type: "foundation", zone: "foundations", hint: "K" });
      top4.push({ spacer: true });
      top4.push({ id: "stock", type: "stock", zone: "stockwaste" });
      var tableau = [];
      for (var t = 0; t < 10; t++) tableau.push({ id: "t" + t, type: "tableau", zone: "tableau" });
      return { top: top4, tableau: tableau };
    },

    deal: function (api, deck) {
      var k = 0;
      for (var i = 0; i < 10; i++) {
        var p = api.pile("t" + i), n = i < 4 ? 6 : 5;
        for (var j = 0; j < n; j++) { var c = deck[k++]; c.faceUp = (j === n - 1); p.cards.push(c); }
      }
      var stock = api.pile("stock");
      while (k < deck.length) { deck[k].faceUp = false; stock.cards.push(deck[k]); k++; }
    },

    canPickup: function (group, p) {
      if (p.type !== "tableau") return false;
      return sameSuitRun(group);
    },

    canDrop: function (group, dest) {
      if (dest.type !== "tableau") return false;
      var t = top(dest);
      if (!t) return true;                       // empty column takes anything
      return t.faceUp && t.rank === group[0].rank + 1; // onto any suit one higher
    },

    autoMove: function (group, src, api) {
      var ts = api.pilesByZone("tableau"), i;
      // prefer extending a same-suit run, then any legal column, then an empty one
      for (i = 0; i < ts.length; i++) { var t = top(ts[i]); if (ts[i] !== src && t && t.faceUp && t.rank === group[0].rank + 1 && t.suit === group[0].suit) return ts[i]; }
      for (i = 0; i < ts.length; i++) { var u = top(ts[i]); if (ts[i] !== src && u && u.faceUp && u.rank === group[0].rank + 1) return ts[i]; }
      for (i = 0; i < ts.length; i++) if (ts[i] !== src && !ts[i].cards.length) return ts[i];
      return null;
    },

    onStock: function (api) {
      var stock = api.pile("stock");
      if (!stock.cards.length) return false;
      var tabs = api.pilesByZone("tableau");
      if (tabs.some(function (p) { return p.cards.length === 0; })) {
        api.setMessage("Fill every empty column before dealing.", "warn");
        return false;
      }
      tabs.forEach(function (p) { var c = stock.cards.pop(); if (c) { c.faceUp = true; p.cards.push(c); } });
      return true;
    },

    afterMove: function (api) {
      var changed = true;
      while (changed) {
        changed = false;
        api.pilesByZone("tableau").forEach(function (p) {
          var t = top(p); if (t && !t.faceUp) t.faceUp = true;
          if (p.cards.length >= 13) {
            var seg = p.cards.slice(p.cards.length - 13);
            var ok = seg[0].rank === 13 && seg.every(function (c, i) { return c.faceUp && c.suit === seg[0].suit && c.rank === 13 - i; });
            if (ok) {
              p.cards.splice(p.cards.length - 13, 13);
              var f = api.pilesByZone("foundations").find(function (fp) { return fp.cards.length === 0; });
              if (f) f.cards = seg;
              var nt = top(p); if (nt && !nt.faceUp) nt.faceUp = true;
              changed = true;
            }
          }
        });
      }
    },

    progress: function (api) {
      var n = api.pilesByZone("foundations").filter(function (p) { return p.cards.length === 13; }).length;
      return n + "/8";
    },

    isWon: function (api) {
      return api.pilesByZone("foundations").filter(function (p) { return p.cards.length === 13; }).length === 8;
    }
  });
})();
