// Guards the season default the scheduled sync writes with.
//
// index.html's ESPN_SEASON is the current season everywhere a league doc
// hasn't set its own. scripts/sync-scores.js used to keep a second copy of
// that year, and the copy rotted: the app had moved to 2026 while the hourly
// job kept pulling 2025 standings and writing them into every league that
// never picked a season — so live boards filled up with last year's records.
//
// The job now reads ESPN_SEASON out of index.html at startup. This checks that
// the read still works, and that its offline fallback hasn't fallen behind.
//
// Run: node tools/season-default.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const SRC  = process.env.TT_INDEX || fileURLToPath(new URL("../index.html", import.meta.url));
const html = readFileSync(SRC, "utf8");
const sync = readFileSync(fileURLToPath(new URL("../scripts/sync-scores.js", import.meta.url)), "utf8");

const appSeason = /const ESPN_SEASON\s*=\s*(\d{4})\s*;/.exec(html);
assert.ok(appSeason, `ESPN_SEASON not found in ${SRC}`);

// The sync job's own regex, lifted from its source, run against index.html —
// so renaming or reformatting the constant fails here instead of silently
// dropping the job onto its fallback.
const pattern = /const m = \/(.+?)\/\.exec\(src\);/.exec(sync);
assert.ok(pattern, "season regex not found in scripts/sync-scores.js");
const found = new RegExp(pattern[1]).exec(html);
assert.ok(found, "sync-scores.js can no longer find ESPN_SEASON in index.html");
assert.equal(found[1], appSeason[1], "sync-scores.js reads a different season than the app");

// The fallback only fires if index.html can't be read, but a stale one would
// still write the wrong year's standings into Firestore.
const fallback = /const FALLBACK_SEASON = (\d{4})\s*;/.exec(sync);
assert.ok(fallback, "FALLBACK_SEASON not found in scripts/sync-scores.js");
assert.equal(fallback[1], appSeason[1],
  `FALLBACK_SEASON (${fallback[1]}) is behind ESPN_SEASON (${appSeason[1]})`);

console.log(`✓ sync season default resolves to ${appSeason[1]} (app and job agree)`);
