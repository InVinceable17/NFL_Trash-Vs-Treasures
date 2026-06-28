// Scheduled score sync — runs in GitHub Actions, not the browser.
// Pulls live NFL standings from ESPN and writes each league's active-period
// records (cumulative minus banked swap periods) into Firestore, so viewers
// see fresh scores without anyone clicking. Mirrors the client's sync logic.
//
// Requires the FIREBASE_SERVICE_ACCOUNT secret (a Firebase service-account
// JSON). Writes via the Admin SDK, which bypasses security rules by design.

import admin from "firebase-admin";

const DEFAULT_SEASON = 2025;

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (!sa.project_id) {
  console.error("Missing or invalid FIREBASE_SERVICE_ACCOUNT secret.");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// Cumulative W/L per team for a season: { "Team Name": [wins, losses] }
async function fetchTeamData(season) {
  const url = `https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=${season}&seasontype=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  const data = await res.json();
  const out = {};
  for (const conf of (data.children || [])) {
    for (const entry of (conf.standings?.entries || [])) {
      const name = entry.team?.displayName;
      if (!name) continue;
      const s = Object.fromEntries((entry.stats || []).map(x => [x.name, x.value]));
      out[name] = [s.wins ?? 0, s.losses ?? 0];
    }
  }
  return out;
}

// Subtract banked swap periods (stored on roster locked rows) from cumulative
// totals, so records reflect only the current active period — same as the app.
function computeAdjusted(cumulative, roster) {
  const bank = {};
  for (const pr of Object.values(roster || {})) {
    if (!pr) continue;
    for (const sec of ["treasures", "trash"]) {
      for (const lk of (pr[sec]?.locked || [])) {
        const team = lk.team;
        if (!team) continue;
        if (!bank[team]) bank[team] = [0, 0];
        bank[team][0] += lk.w || 0;
        bank[team][1] += lk.l || 0;
      }
    }
  }
  const adjusted = {};
  for (const [team, [w, l]] of Object.entries(cumulative)) {
    const b = bank[team];
    adjusted[team] = b ? [Math.max(0, w - b[0]), Math.max(0, l - b[1])] : [w, l];
  }
  return adjusted;
}

async function main() {
  const snap = await db.collection("leagues").get();
  const cache = {}; // season -> cumulative (fetch each season once)
  let updated = 0, skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const season = data.season || DEFAULT_SEASON;

    if (!(season in cache)) {
      try { cache[season] = await fetchTeamData(season); }
      catch (e) { console.log(`Season ${season} fetch failed: ${e.message}`); cache[season] = {}; }
    }
    const cumulative = cache[season];
    const games = Object.values(cumulative).reduce((a, [w, l]) => a + w + l, 0);

    // Guard: never overwrite good data with an unstarted/empty season
    if (!Object.keys(cumulative).length || games === 0) {
      console.log(`Skip ${doc.id}: no completed games for ${season}`);
      skipped++;
      continue;
    }

    const records = computeAdjusted(cumulative, data.roster);
    await doc.ref.update({ records, lastSyncedAt: Date.now() });
    updated++;
    console.log(`Updated ${doc.id} (season ${season})`);
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped}.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
