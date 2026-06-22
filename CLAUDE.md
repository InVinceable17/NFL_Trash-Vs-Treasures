# ClaudeProjects

Meta-repo for tracking app ideas. Each app gets its own dedicated GitHub repo.

## Current apps

- **[NFL_Trash-Vs-Treasures](../NFL_Trash-Vs-Treasures)** — fantasy league tracker for a 4-player NFL league
  - **What it is:** A custom fantasy football game Vince plays with Natalie, Kevin, and Haley. Each player drafts 4 "Treasure" NFL teams (bet they'll be good — score their wins) and 4 "Trash" teams (bet they'll be bad — score their losses). Players can swap teams at two checkpoints mid-season (after Weeks 1-6 and 7-12); swapped-out picks bank their stats as locked rows. Total score = Treasure wins + Trash losses.
  - **Why it exists:** The group tracked this in a spreadsheet, but needed a real dashboard that auto-calculates standings, shows logos, highlights swapped picks, and has a built-in draft tool for future seasons.
  - **Status:** Active — current standings: Natalie 87 pts, Kevin 81, Vince 77, Haley 74
  - **Tech:** Single-file HTML + React (CDN) + localStorage. Three tabs: Dashboard (live standings), Edit (update W/L weekly), Draft (snake-draft setup with live ESPN standings).

## Backlog

See `IDEAS.md` for ideas in progress.

## Conventions for new apps

- Each app is its own GitHub repo (not a subfolder here)
- Entry point is usually `index.html`
- Data stays local (localStorage, IndexedDB, flat files) unless specified
- Keep it simple: one file is better than five

## Gotchas — Single-file React via CDN

The current `@babel/standalone` defaults to the *automatic* JSX runtime, which compiles JSX into `import "react/jsx-runtime"` statements that fail in plain inline scripts → blank screen with no error. Fix:

```html
<script type="text/jsx-source" id="app-source"> ...your JSX... </script>
<script>
  var src = document.getElementById("app-source").textContent;
  var out = Babel.transform(src, { presets: [["react", { runtime: "classic" }]] });
  (0, eval)(out.code);
</script>
```

See [NFL_Trash-Vs-Treasures/index.html](../NFL_Trash-Vs-Treasures/index.html) for a working example.
