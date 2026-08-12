# Trash & Treasures

Dashboard for a custom fantasy football game. Each player drafts 4 **💎 Treasure**
teams (bet they'll be good — score their wins) and 4 **🗑️ Trash** teams (bet
they'll be bad — score their losses). Score = Treasure wins + Trash losses.
Players swap teams at two mid-season checkpoints (after Weeks 1-6 and 7-12);
swapped-out picks bank their stats as locked rows that still count.

## The live app is the source of truth

Deployed to GitHub Pages from `main` (repo root):
**https://invinceable17.github.io/NFL_Trash-Vs-Treasures/**

League data lives in **Firestore**, not in this repo. Standings you see in source
(seed data, docs) are illustrative and go stale — read real numbers off the live
site. Before starting work, `git fetch` and check what Pages actually deployed:

```bash
gh api repos/InVinceable17/NFL_Trash-Vs-Treasures/pages/builds/latest --jq .commit
```

Merging to `main` deploys immediately. There is no staging environment.

## Architecture

Everything is one file: `index.html` (~2.5k lines). React + Babel + Firebase all
load from CDNs; there is no build step for the app itself.

- **`scripts/sync-scores.js`** — hourly GitHub Action (`.github/workflows/sync-scores.yml`)
  that pulls ESPN standings into Firestore for every league. It guards against
  overwriting good data with an unstarted season.
- **`tools/`** — dev-only. `npm run preview` builds a self-contained, CSP-safe
  copy for publishing as an Artifact; `npm test` runs the swap regression test.
  Never hand-edit generated output.

## Auth model

- One admin (`ADMIN_UID` in `index.html`), signed in with Firebase Google auth.
- Everyone else is a viewer: no login, read-only, straight from Firestore.
- The **Firestore security rules are the real enforcement** — the UI gating is
  only UX. Rules live in the Firebase console (project `trash-treasures-2b85a`),
  not in this repo. See `ROADMAP.md` for the rule text.

## Gotcha — records semantics

`st.records[team]` is a team's record **since its last swap**, not its season
total. Each locked row banks the record from one earlier window. So a team's true
full-season record is `records[team]` + every locked row for it.

This is the single easiest thing to get wrong here, and it caused a live data-loss
bug: undoing a swap restored the banked snapshot *alone* and silently dropped
every game played since. Anything that moves teams between categories must go
through `applySwaps()` / `undoSwapWindow()`, which are pure inverses of each
other and covered by `tools/swap-roundtrip.test.mjs`.

Related: admin edits auto-save to Firestore on a 1s debounce, so any state
mutation reaches all viewers almost immediately. Never mutate `st` speculatively
— build a preview and write only on commit.

## Gotcha — single-file React via CDN

`@babel/standalone` defaults to the *automatic* JSX runtime, which compiles JSX
into `import "react/jsx-runtime"` statements that fail in plain inline scripts →
blank screen with no error. Hence the classic-runtime transform:

```html
<script type="text/jsx-source" id="app-source"> ...your JSX... </script>
<script>
  var src = document.getElementById("app-source").textContent;
  var out = Babel.transform(src, { presets: [["react", { runtime: "classic" }]] });
  (0, eval)(out.code);
</script>
```

A TDZ error anywhere in that eval'd blob also yields a silent blank screen. After
touching `index.html`, run `cd tools && npm run preview` — it mounts the app in
jsdom and fails loudly if it doesn't render.
