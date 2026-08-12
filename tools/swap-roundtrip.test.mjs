// Regression test for the swap undo arithmetic.
//
// Extracts the two pure swap functions straight out of index.html (no build
// step, no imports to keep in sync) and checks that re-editing an applied swap
// window round-trips. The bug this guards against: undo used to restore a
// team's record to the *banked window snapshot alone*, silently discarding
// every game played since the swap — and that corruption auto-saved to
// Firestore, so it reached every viewer.
//
// Run: node tools/swap-roundtrip.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const SRC = process.env.TT_INDEX
  || fileURLToPath(new URL("../index.html", import.meta.url));
const html = readFileSync(SRC, "utf8");

function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} not found in ${SRC}`);
  let i = html.indexOf("{", start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const { applySwaps, undoSwapWindow } = (0, eval)(
  `(() => { ${slice("applySwaps")} ${slice("undoSwapWindow")}
    return { applySwaps, undoSwapWindow }; })()`
);

const players = ["Vince"];
const base = {
  roster: {
    Vince: {
      treasures: { active: [["NE", null], ["DEN", null]], locked: [] },
      trash:     { active: [["NYG", null], ["DAL", null]], locked: [] },
    },
  },
  records: { NE: [6, 0], DEN: [8, 2], NYG: [1, 5], DAL: [3, 4] },
};
const sel = { Vince: { treasureOut: "NE", trashOut: "NYG" } };

// 1. apply banks the pre-swap record and zeroes the active one
const applied = applySwaps(base, sel, "wk6", "Weeks 1-6", base.records, players);
assert.deepEqual(applied.roster.Vince.treasures.locked, [["NE", 6, 0, "Weeks 1-6"]]);
assert.deepEqual(applied.roster.Vince.trash.locked,     [["NYG", 1, 5, "Weeks 1-6"]]);
assert.deepEqual(applied.records.NE,  [0, 0]);
assert.deepEqual(applied.records.NYG, [0, 0]);

// 2. exact round-trip when no games have elapsed since the swap
const immediate = undoSwapWindow(applied, "wk6", "Weeks 1-6", players);
assert.deepEqual(immediate.records.NE,  [6, 0], "NE record restored");
assert.deepEqual(immediate.records.NYG, [1, 5], "NYG record restored");
assert.deepEqual(immediate.roster.Vince.treasures.locked, [], "NE locked row cleared");
assert.deepEqual(immediate.roster.Vince.trash.locked,     [], "NYG locked row cleared");
assert.deepEqual([...immediate.roster.Vince.treasures.active].sort(),
                 [...base.roster.Vince.treasures.active].sort(), "treasures back to original");
assert.deepEqual([...immediate.roster.Vince.trash.active].sort(),
                 [...base.roster.Vince.trash.active].sort(), "trash back to original");

// 3. THE REGRESSION: games played *after* the swap must survive the undo
const later  = { ...applied, records: { ...applied.records, NE: [2, 3], NYG: [4, 1] } };
const undone = undoSwapWindow(later, "wk6", "Weeks 1-6", players);
assert.deepEqual(undone.records.NE,  [8, 3], "NE = banked 6-0 + since-swap 2-3");
assert.deepEqual(undone.records.NYG, [5, 6], "NYG = banked 1-5 + since-swap 4-1");

// 4. undoing one window leaves the other window's banked rows alone
const twoWindow = applySwaps(undone,
  { Vince: { treasureOut: "DEN", trashOut: "DAL" } }, "wk12", "Weeks 7-12", undone.records, players);
const undoneWk12 = undoSwapWindow(twoWindow, "wk12", "Weeks 7-12", players);
assert.deepEqual(undoneWk12.records.DEN, [8, 2], "DEN restored");
assert.deepEqual(undoneWk12.records.NE,  [8, 3], "wk6 result untouched by wk12 undo");

// 5. purity: opening the editor must never mutate the saved state
const before = JSON.stringify(later);
undoSwapWindow(later, "wk6", "Weeks 1-6", players);
assert.equal(JSON.stringify(later), before, "undoSwapWindow must not mutate its input");

console.log("PASS — all 5 swap round-trip checks");
