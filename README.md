# Trash & Treasures

Dashboard for a 4-player fantasy league. Each player has 4 **💎 Treasure** picks (NFL teams they bet will be good) and 4 **🗑️ Trash** picks (bet will be bad). Score = Treasure wins + Trash losses.

## Run it

Double-click `index.html`. No build step — React + Babel load from CDN (needs internet on first load).

## Tabs

- **Dashboard** — mirrors the league spreadsheet: four player columns, each with a Treasures and a Trash table (Team / W / L / Points), greyed **locked** rows for swapped-out picks' banked performance, and pink/teal highlights for teams swapped in after Weeks 1-6 / 7-12. Below: the Standings box (W's from Winners, L's from Losers, Total) and a legend.
- **Edit** — update each active team's W/L weekly; everything recalculates live. Locked (banked) rows are editable too if a correction is needed.

## Scoring model

- Active Treasure row → points = wins. Active Trash row → points = losses.
- Locked rows carry a fixed banked W/L from their swap window (Treasure → banked wins, Trash → banked losses).
- Player total = all Treasure points + all Trash points. Seed data reproduces the real standings exactly (Natalie 87, Kevin 81, Vince 77, Haley 74).

## Data

Saves to `localStorage` on this device only (key `trash-treasures-v2`). **Reset** restores the seeded board.

## Possible next steps

- Pull live W/L from an NFL scores API instead of manual editing.
- Add a snake-draft setup flow for next season.
- Shared state across devices (Firestore) so all 4 players see updates live.
