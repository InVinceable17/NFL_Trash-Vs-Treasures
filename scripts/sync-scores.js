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

// Per-week W/L deltas for one week: { "Team Name": [wins, losses] }
async function fetchWeekScores(season, week) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${res.status} wk${week}`);
  const data = await res.json();
  const deltas = {};
  for (const event of (data.events || [])) {
    const comp = event.competitions?.[0];
    if (!comp?.status?.type?.completed) continue;
    for (const c of (comp.competitors || [])) {
      const name = c.team?.displayName;
      if (!name) continue;
      if (!deltas[name]) deltas[name] = [0, 0];
      if (c.winner) deltas[name][0]++; else deltas[name][1]++;
    }
  }
  return deltas;
}

// Real per-window records: { "Weeks 1-6": {team:[w,l]}, "Weeks 7-12": {team:[w,l]} }
async function fetchWindowRecords(season) {
  const ranges = { "Weeks 1-6": [1, 6], "Weeks 7-12": [7, 12] };
  const out = { "Weeks 1-6": {}, "Weeks 7-12": {} };
  for (const [period, [a, b]] of Object.entries(ranges)) {
    for (let w = a; w <= b; w++) {
      const deltas = await fetchWeekScores(season, w);
      for (const [team, [wins, losses]] of Object.entries(deltas)) {
        if (!out[period][team]) out[period][team] = [0, 0];
        out[period][team][0] += wins;
        out[period][team][1] += losses;
      }
    }
  }
  return out;
}

// Regenerate banked (locked) values from real per-window results. Roster is in
// Firestore format (locked rows are objects {team,w,l,period}).
function recomputeLocked(roster, windows) {
  const out = JSON.parse(JSON.stringify(roster || {}));
  for (const pr of Object.values(out)) {
    if (!pr) continue;
    for (const sec of ["treasures", "trash"]) {
      pr[sec].locked = (pr[sec]?.locked || []).map(lk => {
        const rec = windows[lk.period] && windows[lk.period][lk.team];
        return rec ? { team: lk.team, w: rec[0], l: rec[1], period: lk.period } : lk;
      });
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
  const cumCache = {};    // season -> cumulative standings
  const windowCache = {}; // season -> per-window records
  let updated = 0, skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const season = data.season || DEFAULT_SEASON;

    if (!(season in cumCache)) {
      try { cumCache[season] = await fetchTeamData(season); }
      catch (e) { console.log(`Season ${season} standings fetch failed: ${e.message}`); cumCache[season] = {}; }
    }
    const cumulative = cumCache[season];
    const games = Object.values(cumulative).reduce((a, [w, l]) => a + w + l, 0);

    // Guard: never overwrite good data with an unstarted/empty season
    if (!Object.keys(cumulative).length || games === 0) {
      console.log(`Skip ${doc.id}: no completed games for ${season}`);
      skipped++;
      continue;
    }

    if (!(season in windowCache)) {
      try { windowCache[season] = await fetchWindowRecords(season); }
      catch (e) { console.log(`Season ${season} per-week fetch failed: ${e.message}`); windowCache[season] = { "Weeks 1-6": {}, "Weeks 7-12": {} }; }
    }

    // Regenerate banked values from real games, then derive active records.
    const roster = recomputeLocked(data.roster, windowCache[season]);
    const records = computeAdjusted(cumulative, roster);
    await doc.ref.update({ roster, records, lastSyncedAt: Date.now() });
    updated++;
    console.log(`Updated ${doc.id} (season ${season})`);
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped}.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
