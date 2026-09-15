// Tests for the weekly recap/preview logic: what a pick was worth in a given
// week, what each player earned out of what was on offer, which results count
// as upsets, and which games carry the most for this league.
//
// Pure logic only — no network. Run: node tools/week-summary.test.mjs
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
function constant(name) {
  const m = html.match(new RegExp(`^const ${name} = ([^;]+);`, "m"));
  assert.ok(m, `const ${name} not found in ${SRC}`);
  return `const ${name} = ${m[1]};`;
}

const { pickResult, weekLines, teamStrength, weekUpsets, keyGames, ownershipMap, UPSET_GAP } =
  (0, eval)(`(() => {
    ${constant("PRIOR_GAMES")} ${constant("UPSET_GAP")}
    ${slice("pickResult")} ${slice("weekLines")} ${slice("teamStrength")}
    ${slice("gameStakes")} ${slice("weekUpsets")} ${slice("keyGames")} ${slice("ownershipMap")}
    return { pickResult, weekLines, teamStrength, weekUpsets, keyGames, ownershipMap, UPSET_GAP };
  })()`);

// ---- helpers ----
const DEN = "Denver Broncos", NYG = "New York Giants", LAR = "Los Angeles Rams",
      KC  = "Kansas City Chiefs", CLE = "Cleveland Browns", SF = "San Francisco 49ers";
const game = (away, home, aS, hS, completed = true) =>
  ({ id: `${away}@${home}`, away, home, awayScore: aS, homeScore: hS, completed, date: new Date("2026-09-20T17:00Z") });

// ---- pickResult ----
// away wins 24-10
const g1 = game(DEN, NYG, 24, 10);
assert.equal(pickResult(g1, DEN, "treasure"), "hit",  "treasure on the winner cashes");
assert.equal(pickResult(g1, DEN, "trash"),    "miss", "trash on the winner does not");
assert.equal(pickResult(g1, NYG, "trash"),    "hit",  "trash on the loser cashes");
assert.equal(pickResult(g1, NYG, "treasure"), "miss", "treasure on the loser does not");
assert.equal(pickResult(undefined, DEN, "treasure"), "bye", "no game that week -> bye");
assert.equal(pickResult(game(DEN, NYG, 0, 0, false), DEN, "treasure"), "pending", "unfinished -> pending");
// a tie is neither a win nor a loss, so nobody scores
assert.equal(pickResult(game(DEN, NYG, 17, 17), DEN, "treasure"), "push", "tie -> push for treasure");
assert.equal(pickResult(game(DEN, NYG, 17, 17), DEN, "trash"),    "push", "tie -> push for trash");

// ---- weekLines ----
const roster = {
  Vince: {
    treasures: { active: [[DEN, null], [KC, null]], locked: [[SF, 3, 1, "Weeks 1-6"]] },
    trash:     { active: [[NYG, null], [CLE, null]], locked: [] },
  },
  Haley: {
    treasures: { active: [[LAR, null]], locked: [] },
    trash:     { active: [[DEN, null]], locked: [] },
  },
};
// DEN beat NYG; KC lost to CLE; LAR on bye (no game this week)
const week = [g1, game(KC, CLE, 13, 20)];
const lines = weekLines(week, roster, ["Vince", "Haley"]);

// Vince: DEN treasure hit, NYG trash hit, KC treasure miss, CLE trash miss
assert.equal(lines.Vince.earned, 2, "Vince cashed DEN (treasure) and NYG (trash)");
assert.equal(lines.Vince.missed, 2, "KC lost as a treasure, CLE won as a trash");
assert.equal(lines.Vince.potential, 4, "all four of Vince's teams played");
assert.equal(lines.Vince.byes, 0);
assert.equal(lines.Vince.pending, 0);
// locked rows are banked history and must not appear in a week's line
assert.ok(!lines.Vince.picks.some(x => x.team === SF), "locked picks must not score a week");

// Haley: DEN trash miss (DEN won), LAR did not play
assert.equal(lines.Haley.earned, 0);
assert.equal(lines.Haley.byes, 1, "LAR had no game");
assert.equal(lines.Haley.potential, 1, "a bye is not a missed point — it never existed");

// a player with no roster entry still gets a zeroed line rather than throwing
const empty = weekLines(week, roster, ["Ghost"]);
assert.deepEqual(
  [empty.Ghost.earned, empty.Ghost.potential, empty.Ghost.picks.length], [0, 0, 0]);

// unfinished games count as pending, not as misses
const midWeek = weekLines([game(DEN, NYG, 7, 3, false)], roster, ["Vince"]);
assert.equal(midWeek.Vince.pending, 2, "both sides of an unfinished game are pending");
assert.equal(midWeek.Vince.earned + midWeek.Vince.missed, 0, "nothing is decided yet");

// ---- teamStrength ----
const prev = { [KC]: { pct: 0.875 }, [CLE]: { pct: 0.188 } };
// With no games played, the previous season carries the whole estimate.
assert.ok(Math.abs(teamStrength(KC, {}, prev) - 0.875) < 1e-9, "week 1 leans entirely on last season");
assert.equal(teamStrength("Unknown Team", {}, {}), 0.5, "no history anywhere -> even");
// A full season of evidence should dominate the prior.
const fullCur = { [CLE]: { w: 14, l: 3, pct: 14 / 17 } };
assert.ok(teamStrength(CLE, fullCur, prev) > 0.65,
  "17 games at .824 must outweigh a 6-game prior at .188");
// ...and the blend must sit between the two inputs, never outside them.
const blended = teamStrength(CLE, { [CLE]: { w: 2, l: 2, pct: 0.5 } }, prev);
assert.ok(blended > 0.188 && blended < 0.5, "a blend stays between prior and current");

// ---- weekUpsets ----
const strengthOf = t => ({ [KC]: 0.85, [CLE]: 0.25, [DEN]: 0.55, [NYG]: 0.5 })[t] ?? 0.5;
const own = ownershipMap(roster, ["Vince", "Haley"]);
// CLE (weak) beat KC (strong) -> a 0.60 gap, comfortably an upset
const ups = weekUpsets(week, strengthOf, own);
assert.equal(ups.length, 1, "only the KC/CLE result is an upset");
assert.equal(ups[0].winner, CLE);
assert.equal(ups[0].loser, KC);
assert.equal(ups[0].margin, 7);
// Vince held KC as a treasure and CLE as trash — this result hurt him twice
assert.deepEqual(ups[0].helped, [], "nobody was on the right side of it");
assert.deepEqual(ups[0].hurt.sort(), ["Vince", "Vince"], "Vince's treasure and trash both burned");
// an even matchup is never an upset however lopsided the score
assert.deepEqual(weekUpsets([game(DEN, NYG, 45, 3)], strengthOf, own), [],
  "a blowout between evenly rated teams is not an upset");
// unfinished and tied games are never upsets
assert.deepEqual(weekUpsets([game(KC, CLE, 0, 20, false)], strengthOf, own), []);
assert.deepEqual(weekUpsets([game(KC, CLE, 20, 20)], strengthOf, own), []);
// biggest surprise leads, and the limit is honoured
const many = weekUpsets(
  [game(KC, CLE, 10, 20), game(NYG, DEN, 30, 3)],
  t => ({ [KC]: 0.9, [CLE]: 0.1, [DEN]: 0.75, [NYG]: 0.5 })[t] ?? 0.5, own, 1);
assert.equal(many.length, 1, "limit caps the list");
assert.equal(many[0].winner, CLE, "the 0.8 gap outranks the 0.25 gap");

// ---- keyGames ----
// Vince holds DEN (treasure) and NYG (trash) — both sides of g1, a 2-pt swing.
const keys = keyGames(week, own);
assert.equal(keys[0].game.id, g1.id, "the game one player holds both sides of leads");
assert.equal(keys[0].stakes.length, 1, "Vince has a stake in it");
assert.equal(keys[0].stakes[0].locked, false, "opposite categories -> a real swing");
assert.equal(keys[0].stakes[0].wants, DEN, "he needs the treasure side to win");
// weight = 3 picks on it (Vince DEN, Vince NYG, Haley DEN) + 2 for the swing
assert.equal(keys[0].weight, 5);
// games nobody holds are dropped entirely. SF is only a LOCKED row of Vince's,
// which ownershipMap treats as history — so this game has no live picks on it.
assert.deepEqual(keyGames([game(SF, "Chicago Bears", 0, 0, false)], own), []);

console.log("PASS — weekly summary logic (pickResult, weekLines, teamStrength, weekUpsets, keyGames)");
