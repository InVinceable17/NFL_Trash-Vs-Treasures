# Trash & Treasures

Dashboard for a custom fantasy football game. Each player has 4 **💎 Treasure**
picks (NFL teams they bet will be good) and 4 **🗑️ Trash** picks (bet will be
bad). Score = Treasure wins + Trash losses.

**Live:** https://invinceable17.github.io/NFL_Trash-Vs-Treasures/

## How it works

Open the link and pick a league — no login needed to watch. Scores update
themselves: a scheduled job pulls NFL results from ESPN every hour and pushes
them to every viewer in real time.

One admin (Vince) signs in with Google to make changes. Everyone else is
read-only, including during the draft — viewers watch picks land live.

## Tabs

- **Dashboard** — four player columns, each with a Treasures and a Trash table
  (Team / W / L / Points). Greyed **locked** rows are swapped-out picks' banked
  performance; they still count. Pink/teal highlights mark teams swapped in after
  Weeks 1-6 / 7-12. Below: standings and a legend. *(Everyone)*
- **Edit** — correct any team's W/L by hand, or pull a full season from ESPN with
  one click (undoable, with a backup button). *(Admin)*
- **Swap** — make the two mid-season checkpoint swaps. Each swap moves one
  Treasure **and** one Trash so every player stays 4 & 4. Shows a live preview of
  the resulting board before you commit, and applied swaps can be re-edited
  safely. *(Admin)*
- **Draft** — snake draft for a new season, synced live to viewers. *(Admin)*

There's also a **replay** mode that scrubs the season week by week from Week 0.

## Scoring model

- Active Treasure row → points = wins. Active Trash row → points = losses.
- Locked rows carry a fixed banked W/L from their swap window (Treasure → banked
  wins, Trash → banked losses).
- Player total = all Treasure points + all Trash points.

## Data

League data lives in Firestore (project `trash-treasures-2b85a`) and syncs across
devices. `localStorage` is only an admin-side cache for instant first paint.

## Development

`index.html` is the whole app — React and Firebase load from CDNs, no build step.
Editing it and merging to `main` deploys straight to GitHub Pages.

```bash
cd tools
npm install       # first time
npm test          # swap logic regression test
npm run preview   # self-contained preview build, mounts in jsdom to verify
```

See `CLAUDE.md` for architecture notes and the two gotchas that bite hardest, and
`ROADMAP.md` for what's next.

## Possible next steps

- Let friends run their own independent leagues (full multi-tenant ownership).
- Let friends draft from their own devices.
