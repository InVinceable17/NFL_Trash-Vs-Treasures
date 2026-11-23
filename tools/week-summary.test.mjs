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

const { pickResult, weekLines, teamStrength, weekUpsets, keyGames, ownershipMap, UPSET_GAP,
        swingLabel, h2hLabel } =
  (0, eval)(`(() => {
    ${constant("PRIOR_GAMES")} ${constant("UPSET_GAP")}
    ${slice("pickResult")} ${slice("weekLines")} ${slice("teamStrength")}
    ${slice("gameStakes")} ${slice("weekUpsets")} ${slice("gameAngles")} ${slice("keyGames")}
    ${slice("swingLabel")} ${slice("h2hLabel")} ${slice("ownershipMap")}
    return { pickResult, weekLines, teamStrength, weekUpsets, keyGames, ownershipMap, UPSET_GAP,
             swingLabel, h2hLabel };
  })()`);

// ---- helpers ----
const DEN = "Denver Broncos", NYG = "New York Giants", LAR = "Los Angeles Rams",
      KC  = "Kansas City Chiefs", CLE = "Cleveland Browns", SF = "San Francisco 49ers",
      CHI = "Chicago Bears", DAL = "Dallas Cowboys";
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
    trash:     { active: [[CHI, null]], locked: [] },
  },
};
// No team is held by two players, as a draft guarantees.
const activeTeams = Object.values(roster)
  .flatMap(r => [...r.treasures.active, ...r.trash.active].map(([t]) => t));
assert.equal(new Set(activeTeams).size, activeTeams.length, "fixture must be a legal draft");
// DEN beat NYG; KC lost to CLE; CHI beat DAL; LAR on bye (no game this week)
const week = [g1, game(KC, CLE, 13, 20), game(CHI, DAL, 24, 10)];
const lines = weekLines(week, roster, ["Vince", "Haley"]);

// Vince: DEN treasure hit, NYG trash hit, KC treasure miss, CLE trash miss
assert.equal(lines.Vince.earned, 2, "Vince cashed DEN (treasure) and NYG (trash)");
assert.equal(lines.Vince.missed, 2, "KC lost as a treasure, CLE won as a trash");
assert.equal(lines.Vince.potential, 4, "all four of Vince's teams played");
assert.equal(lines.Vince.byes, 0);
assert.equal(lines.Vince.pending, 0);
// locked rows are banked history and must not appear in a week's line
assert.ok(!lines.Vince.picks.some(x => x.team === SF), "locked picks must not score a week");

// Haley: CHI trash miss (CHI won), LAR did not play
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

// ---- weekLines: holding both sides of one game ----
// Same category on both sides caps the game at one point however it falls — one
// of the two teams has to win and the other has to lose. The ceiling is 1, not 2.
const bothTrash = {
  Sam: { treasures: { active: [], locked: [] },
         trash:     { active: [[DEN, null], [NYG, null]], locked: [] } },
};
const sam = weekLines([g1], bothTrash, ["Sam"])["Sam"];   // DEN 24, NYG 10
assert.equal(sam.potential, 1, "two trash picks on one game can only yield one point");
assert.equal(sam.earned, 1, "NYG lost, so that half cashed");
assert.equal(sam.missed, 0, "the other half was never winnable — not a miss");
assert.equal(sam.guaranteed, 1, "one point was banked before kickoff");
assert.equal(sam.picks.length, 2, "both picks are still listed for the detail views");

// Same holds for two treasures on one game.
const bothTreasure = {
  Sam: { treasures: { active: [[DEN, null], [NYG, null]], locked: [] },
         trash:     { active: [], locked: [] } },
};
const samT = weekLines([g1], bothTreasure, ["Sam"])["Sam"];
assert.deepEqual([samT.potential, samT.earned, samT.missed], [1, 1, 0],
  "DEN won, so one treasure cashed and the ceiling was 1");

// Before kickoff the pair is one pending point, not two.
const samPre = weekLines([game(DEN, NYG, 0, 0, false)], bothTrash, ["Sam"])["Sam"];
assert.deepEqual([samPre.potential, samPre.pending], [1, 1],
  "an undecided pair is a single point in the balance");

// A tie pays nobody, so the guaranteed point is the one thing that can be lost.
const samTie = weekLines([game(DEN, NYG, 17, 17)], bothTrash, ["Sam"])["Sam"];
assert.deepEqual([samTie.potential, samTie.earned, samTie.missed], [1, 0, 1],
  "a tie is neither a win nor a loss — the one available point goes unclaimed");

// OPPOSITE categories are untouched: those really do pay 2 or nothing.
const opposed = {
  Sam: { treasures: { active: [[DEN, null]], locked: [] },
         trash:     { active: [[NYG, null]], locked: [] } },
};
const samO = weekLines([g1], opposed, ["Sam"])["Sam"];
assert.deepEqual([samO.potential, samO.earned, samO.guaranteed], [2, 2, 0],
  "treasure on the winner + trash on the loser is a full 2 points");
const samOLost = weekLines([game(DEN, NYG, 10, 24)], opposed, ["Sam"])["Sam"];
assert.deepEqual([samOLost.potential, samOLost.earned, samOLost.missed], [2, 0, 2],
  "...and nothing at all when it goes the other way");

// A full 8-pick roster with one same-category pair tops out at 7, not 8. The
// other six picks each face an opponent nobody holds, so DEN/NYG is the only
// game that collapses.
const capped = {
  Sam: {
    treasures: { active: [[KC, null], [CLE, null], [LAR, null], [SF, null]], locked: [] },
    trash:     { active: [[DEN, null], [NYG, null], ["Chicago Bears", null], ["Dallas Cowboys", null]], locked: [] },
  },
};
const samWeek = weekLines([
  g1,                                             // DEN + NYG, both trash -> collapses
  game(KC, "Miami Dolphins", 30, 3),
  game(CLE, "New York Jets", 10, 17),
  game(LAR, "Buffalo Bills", 21, 20),
  game(SF, "Green Bay Packers", 14, 28),
  game("Chicago Bears", "Minnesota Vikings", 6, 9),
  game("Dallas Cowboys", "Detroit Lions", 24, 21),
], capped, ["Sam"])["Sam"];
assert.equal(samWeek.potential, 7,
  "8 teams playing, but DEN/NYG are both trash in one game — the week's ceiling is 7");
assert.equal(samWeek.guaranteed, 1);
assert.ok(samWeek.earned <= samWeek.potential, "a player can never out-earn their ceiling");

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

const solo2 = (team, kind) => ({
  treasures: { active: kind === "treasure" ? [[team, null]] : [], locked: [] },
  trash:     { active: kind === "trash"    ? [[team, null]] : [], locked: [] },
});

// An upset between two teams nobody holds moved no points, so it is not this
// league's news. (With four players every team is drafted, so this is really a
// guard for smaller leagues.)
assert.deepEqual(
  weekUpsets([game("Las Vegas Raiders", "Pittsburgh Steelers", 30, 3)],
             t => ({ "Pittsburgh Steelers": 0.9, "Las Vegas Raiders": 0.2 })[t] ?? 0.5, own),
  [], "a big upset nobody held is not reported");

// The canonical shape: the favourite is one player's treasure, the underdog is
// another's trash. Both expected a point; the upset takes both away at once.
const bothExpected = ownershipMap({
  Ann: solo2(KC, "treasure"),   // favourite
  Bob: solo2(CLE, "trash"),     // underdog
}, ["Ann", "Bob"]);
const twoLost = weekUpsets([game(KC, CLE, 13, 20)],
  t => ({ [KC]: 0.85, [CLE]: 0.25 })[t] ?? 0.5, bothExpected);
assert.equal(twoLost.length, 1);
assert.deepEqual(twoLost[0].helped, [], "neither of them cashed");
assert.deepEqual(twoLost[0].hurt.sort(), ["Ann", "Bob"], "two expected points lost at once");

// ---- keyGames ----
const ownerOf = (roster, names) => ownershipMap(roster, names);
const one = (g, roster, names) => keyGames([g], ownerOf(roster, names));
const solo = (team, kind) => ({
  treasures: { active: kind === "treasure" ? [[team, null]] : [], locked: [] },
  trash:     { active: kind === "trash"    ? [[team, null]] : [], locked: [] },
});

// A game is called out only when the result can move something by two points.
// Vince holds both sides of DEN@NYG and both sides of KC@CLE in opposite
// categories, so each pays him 2 or nothing. CHI@DAL carries one lone pick of
// Haley's and is not big news.
const keys = keyGames(week, own);
assert.equal(keys.length, 2, "only the two games Vince can double up on");
assert.deepEqual(keys[0].swings, [{ player: "Vince", wants: DEN }]);
assert.deepEqual(keys[0].h2h, []);
assert.equal(keys[0].weight, 2, "a 2-or-nothing result is two points of movement");
assert.ok(!keys.some(k => k.game.id === `${CHI}@${DAL}`),
  "a game with a single pick on it is not a callout");
// games nobody holds are dropped too. SF is only a LOCKED row of Vince's,
// which ownershipMap treats as history — so this game has no live picks on it.
assert.deepEqual(keyGames([game(SF, "Seattle Seahawks", 0, 0, false)], own), []);

// ---- keyGames: head-to-heads ----
// Two trash picks on opposite sides: one of the two teams has to lose, so
// exactly one player scores and they finish two points apart either way.
const trashVsTrash = { Ann: solo(DEN, "trash"), Bob: solo(NYG, "trash") };
const tvt = one(g1, trashVsTrash, ["Ann", "Bob"]);
assert.deepEqual(tvt[0].h2h, [{ players: ["Ann", "Bob"] }], "trash vs trash is a head-to-head");
assert.equal(tvt[0].weight, 2, "the gap between them swings by two");

// Two treasure picks on opposite sides: same deal, one winner.
assert.deepEqual(one(g1, { Ann: solo(DEN, "treasure"), Bob: solo(NYG, "treasure") },
                      ["Ann", "Bob"])[0].h2h,
  [{ players: ["Ann", "Bob"] }], "treasure vs treasure is a head-to-head");

// ---- keyGames: what must NOT be called out ----
// The reported case. Vince's treasure on one team, Haley's trash on the other:
// both need the same team to win, so they score together or not at all and the
// gap between them is unchanged. Nothing swings, so the game is dropped.
const sameWish = { Vince: solo(DEN, "treasure"), Haley: solo(NYG, "trash") };
assert.deepEqual(one(g1, sameWish, ["Vince", "Haley"]), [],
  "a treasure and a trash that both want the same winner is not a matchup");

// One player holding both sides in the SAME category banks exactly 1 whoever
// wins, so the result moves nothing at all.
const lockedUp = {
  Marcus: { treasures: { active: [], locked: [] },
            trash:     { active: [[DEN, null], [NYG, null]], locked: [] } },
};
assert.deepEqual(one(g1, lockedUp, ["Marcus"]), [], "a lock is the opposite of a callout");

// A locked player is never anyone's rival either — their own total cannot move
// — so a lock plus one outsider still swings nothing.
assert.deepEqual(one(g1, { ...lockedUp, Haley: solo(DEN, "treasure") }, ["Marcus", "Haley"]), [],
  "one point riding on it for one player is not a two-point swing");

// A single pick, with nobody on the other side, is just a point in play.
assert.deepEqual(one(g1, { Ann: solo(DEN, "treasure") }, ["Ann"]), []);

// Two picks on one team cannot happen in a drafted league, and are not opposed
// anyway: both read the same result. Pinned so bad data is never mistaken for
// a rivalry.
assert.deepEqual(one(g1, { Ann: solo(DEN, "treasure"), Bob: solo(DEN, "trash") }, ["Ann", "Bob"]), [],
  "a rivalry needs the two players on opposite teams");

// ---- keyGames: ordering ----
// Under one owner per team a game carries at most one angle, so every callout
// weighs the same two points and kickoff order decides.
const mixed = {
  Ann: { treasures: { active: [[DEN, null]], locked: [] },
         trash:     { active: [[NYG, null]], locked: [] } },      // swing on g1
  Bob: solo(KC, "treasure"),
  Cid: solo(CLE, "treasure"),                                      // rivalry on KC@CLE
};
const mixedTeams = Object.values(mixed)
  .flatMap(r => [...r.treasures.active, ...r.trash.active].map(([t]) => t));
assert.equal(new Set(mixedTeams).size, mixedTeams.length, "fixture must be a legal draft");
const ranked = keyGames([g1, game(KC, CLE, 0, 0, false)], ownerOf(mixed, ["Ann", "Bob", "Cid"]));
assert.deepEqual(ranked.map(x => x.weight), [2, 2], "a swing and a rivalry weigh the same");
assert.ok(ranked.every(x => x.h2h.length || x.swings.length),
  "every callout has a reason attached");
// No cap: every qualifying game comes back, however many there are.
const manyOwn = ownerOf({
  Ann: solo(DEN, "trash"), Bob: solo(NYG, "trash"),       // rivalry
  Cid: solo(KC, "treasure"), Dee: solo(CLE, "treasure"),  // rivalry
  Eve: { treasures: { active: [[LAR, null]], locked: [] },
         trash:     { active: [[SF, null]], locked: [] } },  // swing on LAR@SF
}, ["Ann", "Bob", "Cid", "Dee", "Eve"]);
const manyGames = [g1, game(KC, CLE, 0, 0, false), game(LAR, SF, 0, 0, false),
                   game(CHI, DAL, 0, 0, false)];           // CHI/DAL held by nobody
assert.equal(keyGames(manyGames, manyOwn).length, 3,
  "all three swing games are listed, not just a top few");

// ---- labels: a decided game must not still be asking ----
// g1 is final, DEN 24 NYG 10.
assert.equal(swingLabel(g1, { player: "Ann", wants: DEN }), "Ann took 2",
  "the side she needed won, so she doubled up");
assert.equal(swingLabel(g1, { player: "Ann", wants: NYG }), "Ann got none",
  "the other way round pays nothing");
assert.equal(swingLabel(game(DEN, NYG, 0, 0, false), { player: "Ann", wants: DEN }),
  "2 pts or none for Ann", "before kickoff it states the stake");
assert.equal(swingLabel(game(DEN, NYG, 17, 17), { player: "Ann", wants: DEN }),
  "Ann got none — tied", "a tie pays nobody");

const rivals = [{ player: "Ann", kind: "trash", team: DEN },
                { player: "Bob", kind: "trash", team: NYG }];
const pair = { players: ["Ann", "Bob"] };
assert.equal(h2hLabel(g1, pair, rivals), "Bob took it from Ann",
  "NYG lost, so Bob's trash pick cashed");
assert.equal(h2hLabel(game(DEN, NYG, 0, 0, false), pair, rivals), "head-to-head: Ann vs Bob",
  "before kickoff it just names the two");
assert.equal(h2hLabel(game(DEN, NYG, 17, 17), pair, rivals),
  "head-to-head: Ann vs Bob — tied, no points", "a tie resolves nothing");

// ---- the section must survive a finished week ----
// Every game final: the callouts stay, which is what keeps the dashboard's
// expand toggle on screen once the week is done.
const finishedWeek = keyGames(week, own);
assert.ok(finishedWeek.length > 0, "a completed week still lists its big games");
assert.ok(finishedWeek.every(k => k.game.completed));

console.log("PASS — weekly summary logic (pickResult, weekLines, teamStrength, weekUpsets, keyGames)");
