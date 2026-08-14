# tools/ — preview build

Dev-only tooling to regenerate a self-contained **Artifact preview** from
`index.html`. Not part of the deployed app.

## Why

The real app (`index.html`) loads React/Babel/Firebase from CDNs and calls
Firestore + ESPN over the network. Claude Artifacts run under a strict CSP that
blocks all external hosts, so the app can't run there as-is. This tool produces
one self-contained HTML file — React inlined, JSX pre-compiled, and
Firebase/Auth/ESPN replaced by an in-memory layer seeded from the live (public)
league snapshot — that renders inside an Artifact.

## The iterate → ship loop

`index.html` is the single source of truth. Never hand-edit the generated
preview.

1. Edit `index.html` (the real change).
2. Regenerate the preview and review it:
   ```
   cd tools
   npm install          # first time only
   npm run preview      # writes tools/preview.html
   ```
   Then publish `tools/preview.html` as an Artifact. Publish from the same path
   each time (or pass the existing artifact URL) to keep one stable link.
3. Repeat 1–2 until it looks right.
4. Ship: commit `index.html` and merge to the default branch — GitHub Pages
   deploys the real app.

## Options

```
node build-preview.mjs [--league <id>] [--role admin|viewer] [--out <path>]
                       [--seed <file.json>]
```

- `--league` Firestore league id to seed from (default: the current league).
- `--role`   `admin` shows all tabs; `viewer` shows the read-only view.
- `--out`    output path (default `tools/preview.html`).
- `--seed`   load a league snapshot from disk instead of fetching the live one.

`--seed` exists because some states are hard to reach live — a draft mid-flight,
an empty league, a finished season. `fixtures/draft-in-progress.json` holds a
draft six picks deep, which is how the read-only viewer draft view gets tested
without anyone running a real draft:

```
node build-preview.mjs --role viewer --seed fixtures/draft-in-progress.json
```

The stubbed ESPN feed is season-aware: 2026 returns 0-0 like the real one does
before kickoff, so draft boards exercise their previous-season fallback.

The build self-verifies by mounting the output in jsdom and fails loudly if the
app doesn't render. If the live snapshot can't be fetched, it falls back to a
small empty league so the tool still works offline.
