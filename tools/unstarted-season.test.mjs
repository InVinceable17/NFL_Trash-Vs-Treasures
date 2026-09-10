// Tests the decision the sync job makes when ESPN reports no completed games.
//
// This is the branch that decides whether last season's records stay on the
// board or get cleared, so it has to separate three lookalike situations: a
// fetch that told us nothing, a season that genuinely hasn't kicked off, and a
// league whose swap history can't be reconstructed from an empty season. Only
// the middle one may write, and only when nothing is banked — clearing a
// league with locked rows would discard real season history, the same class of
// bug the swap round-trip test guards.
//
// Run: node tools/unstarted-season.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const SRC = fileURLToPath(new URL("../scripts/sync-scores.js", import.meta.url));
const src = readFileSync(SRC, "utf8");

function slice(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} not found in ${SRC}`);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const planUnstarted = (0, eval)(`(${slice("planUnstarted")})`);

const full  = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`Team ${i}`, [0, 0]]));
const clean = { roster: { Vince: { treasures: { active: [], locked: [] }, trash: { active: [], locked: [] } } } };

// A full slate at 0-0 is real: the season hasn't started, so zeros are correct
// and another season's leftovers must go.
assert.equal(planUnstarted(full, clean, 2026).action, "reset");
assert.equal(planUnstarted(full, {}, 2026).action, "reset", "a league with no roster yet still clears");

// Already zeroed for this season — don't rewrite the same doc every 15 minutes.
assert.equal(planUnstarted(full, { ...clean, syncedSeason: 2026 }, 2026).action, "skip");

// A failed or partial fetch teaches us nothing; the stored records stand.
assert.equal(planUnstarted({}, clean, 2026).action, "skip");
assert.equal(planUnstarted({ "Team 0": [0, 0] }, clean, 2026).action, "skip");

// Banked swap windows are season history this job can't rebuild from an empty
// season, so it must not clear them — that's the admin's call.
const banked = { roster: { Vince: {
  treasures: { active: [], locked: [{ team: "Chicago Bears", w: 2, l: 4, period: "Weeks 1-6" }] },
  trash:     { active: [], locked: [] } } } };
assert.equal(planUnstarted(full, banked, 2026).action, "skip");

// Every skip explains itself — these lines are the only trace in the run log.
for (const [cum, data] of [[{}, clean], [full, banked], [full, { ...clean, syncedSeason: 2026 }]]) {
  const p = planUnstarted(cum, data, 2026);
  assert.ok(p.why && p.why.length > 10, `skip reason missing: ${JSON.stringify(p)}`);
}

console.log("PASS — unstarted-season decisions (reset vs. skip)");
