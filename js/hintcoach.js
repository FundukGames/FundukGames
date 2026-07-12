/*
 * HintCoach — shared two-stage explanatory hints.
 * --------------------------------------------------------------------------
 * Instead of handing out answers, a hint first TEACHES the deduction:
 *   press 1 → highlight the premise cells (dashed amber), the conclusion
 *             cells (green) and explain the rule that forces the move;
 *   press 2 → apply the move for the player.
 * Any board interaction should call reset() so stale highlights vanish.
 *
 * Each game supplies explain(): null | {
 *   premise: [elements],  // the cells the reasoning starts from
 *   target:  [elements],  // the cells the conclusion lands on
 *   text:    "why this move is forced",
 *   apply:   function     // performs the move
 * }
 * and message(text) to route coach copy into the game's message line.
 */
window.HintCoach = (function () {
  "use strict";

  function create(opts) {
    var current = null;

    function clearMarks() {
      if (!current) return;
      (current.premise || []).forEach(function (el) { if (el) el.classList.remove("hintp"); });
      (current.target || []).forEach(function (el) { if (el) el.classList.remove("hintt"); });
    }
    function reset() {
      clearMarks();
      current = null;
    }
    function press() {
      if (current) { // second press: do the move
        var c = current;
        reset();
        if (c.apply) c.apply();
        return;
      }
      current = opts.explain();
      if (!current) return;
      (current.premise || []).forEach(function (el) { if (el) el.classList.add("hintp"); });
      (current.target || []).forEach(function (el) { if (el) el.classList.add("hintt"); });
      opts.message(current.text + " — Hint again to play it.");
    }
    return { press: press, reset: reset, active: function () { return !!current; } };
  }

  return { create: create };
})();
