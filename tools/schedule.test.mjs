// Tests for the Schedule tab's pure logic, plus a live integration check.
//
// The integration check is the one that matters most: team names in the roster
// are stored as ESPN displayNames, and the owner tags only appear if they match
// the schedule feed exactly. A silent rename upstream would render every game
// untagged with no error anywhere.
//
// Run: node tools/schedule.test.mjs   (hits ESPN + Firestore; needs network)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const SRC = process.env.TT_INDEX || fileURLToPath(new URL("../index.html", import.meta.url));
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

const { ownershipMap, gameStakes, weekForDate } = (0, eval)(
  `(() => { ${slice("ownershipMap")} ${slice("gameStakes")} ${slice("weekForDate")}
    return { ownershipMap, gameStakes, weekForDate }; })()`
);

// ---- weekForDate ----
const weeks = [
  { week: 1, start: new Date("2026-09-06T07:00Z"), end: new Date("2026-09-16T06:59Z") },
  { week: 2, start: new Date("2026-09-16T07:00Z"), end: new Date("2026-09-23T06:59Z") },
  { week: 3, start: new Date("2026-09-23T07:00Z"), end: new Date("2026-09-30T06:59Z") },
];
assert.equal(weekForDate(weeks, new Date("2026-08-12T00:00Z")), 1, "before kickoff -> week 1");
assert.equal(weekForDate(weeks, new Date("2026-09-18T00:00Z")), 2, "mid-week 2 -> week 2");
assert.equal(weekForDate(weeks, new Date("2026-09-16T06:00Z")), 1, "last hour of week 1 -> week 1");
assert.equal(weekForDate(weeks, new Date("2027-03-01T00:00Z")), 3, "after season -> final week");
assert.equal(weekForDate([], new Date()), 1, "empty calendar -> week 1");

// ---- ownershipMap: active picks only, locked rows are history ----
const roster = {
  Vince: {
    treasures: { active: [["Denver Broncos", null]], locked: [["Arizona Cardinals", 2, 4, "Weeks 1-6"]] },
    trash:     { active: [["New York Giants", null]], locked: [] },
  },
  Haley: {
    treasures: { active: [["Los Angeles Rams", "wk6"]], locked: [] },
    trash:     { active: [["Denver Broncos", null]], locked: [] },
  },
};
const own = ownershipMap(roster, ["Vince", "Haley"]);
assert.deepEqual(own["New York Giants"], [{ player: "Vince", kind: "trash" }]);
assert.equal(own["Arizona Cardinals"], undefined, "locked rows must not tag games");
assert.equal(own["Denver Broncos"].length, 2, "a team can be held by two players");
assert.ok(own["Los Angeles Rams"], "swap-marked picks still count as active");

// ---- gameStakes ----
const g = (away, home) => ({ away, home, id: "x" });
// same category both sides -> exactly 1 pt guaranteed
assert.deepEqual(
  gameStakes(g("Denver Broncos", "Los Angeles Rams"), {
    "Denver Broncos":   [{ player: "Haley", kind: "treasure" }],
    "Los Angeles Rams": [{ player: "Haley", kind: "treasure" }],
  }),
  [{ player: "Haley", locked: true, wants: null }]);
// treasure away + trash home -> both payouts ride on the away team winning
assert.deepEqual(
  gameStakes(g("Denver Broncos", "New York Giants"), {
    "Denver Broncos":  [{ player: "Vince", kind: "treasure" }],
    "New York Giants": [{ player: "Vince", kind: "trash" }],
  }),
  [{ player: "Vince", locked: false, wants: "Denver Broncos" }]);
// trash away + treasure home -> rides on the home team winning
assert.deepEqual(
  gameStakes(g("New York Giants", "Denver Broncos"), {
    "New York Giants": [{ player: "Vince", kind: "trash" }],
    "Denver Broncos":  [{ player: "Vince", kind: "treasure" }],
  }),
  [{ player: "Vince", locked: false, wants: "Denver Broncos" }]);
// different players on each side is not a stake for either
assert.deepEqual(
  gameStakes(g("Denver Broncos", "New York Giants"), {
    "Denver Broncos":  [{ player: "Vince", kind: "treasure" }],
    "New York Giants": [{ player: "Haley", kind: "trash" }],
  }), []);

console.log("PASS — schedule logic (weekForDate, ownershipMap, gameStakes)");

// ---- live integration: roster names must match the ESPN schedule feed ----
if (process.env.TT_SKIP_LIVE) {
  console.log("SKIP — live name-match check (TT_SKIP_LIVE set)");
  process.exit(0);
}

const SEASON = Number((html.match(/const ESPN_SEASON = (\d{4})/) || [])[1]);
assert.ok(SEASON, "could not read ESPN_SEASON from index.html");

const scheduleTeams = new Set();
for (const wk of [1, 2, 3, 4]) {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${wk}&dates=${SEASON}`);
  assert.ok(r.ok, `ESPN week ${wk} returned ${r.status}`);
  const d = await r.json();
  for (const ev of (d.events || []))
    for (const c of (ev.competitions?.[0]?.competitors || []))
      if (c.team?.displayName) scheduleTeams.add(c.team.displayName);
}
assert.ok(scheduleTeams.size >= 30, `expected ~32 teams across 4 weeks of ${SEASON}, saw ${scheduleTeams.size}`);

const fr = await fetch("https://firestore.googleapis.com/v1/projects/trash-treasures-2b85a/databases/(default)/documents/leagues");
assert.ok(fr.ok, `Firestore returned ${fr.status}`);
const docs = (await fr.json()).documents || [];
assert.ok(docs.length, "no leagues readable — viewers would see nothing");

let checked = 0, missing = [];
for (const doc of docs) {
  const rosterField = doc.fields?.roster?.mapValue?.fields || {};
  for (const [player, pv] of Object.entries(rosterField)) {
    for (const sec of ["treasures", "trash"]) {
      const active = pv.mapValue?.fields?.[sec]?.mapValue?.fields?.active?.arrayValue?.values || [];
      for (const entry of active) {
        const team = entry.mapValue?.fields?.team?.stringValue
                  ?? entry.arrayValue?.values?.[0]?.stringValue;
        if (!team) continue;
        checked++;
        if (!scheduleTeams.has(team)) missing.push(`${doc.name.split("/").pop()}/${player}: "${team}"`);
      }
    }
  }
}
assert.ok(checked > 0, "parsed zero roster teams — the Firestore shape may have changed");
assert.deepEqual(missing, [], `roster teams absent from the ${SEASON} schedule feed (they would render untagged)`);
console.log(`PASS — live name match: ${checked} active roster picks all found in the ${SEASON} schedule feed`);
