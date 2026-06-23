# Notes & Ops Log

## Firebase Studio Shutdown (email received ~June 2026)

**TL;DR: No changes needed to the NFL app. Firestore is unaffected.**

### What the email is about

Firebase Studio is a web-based AI IDE / vibe-coding tool — separate from the Firebase backend platform. The email announces:

- **June 22, 2026**: No new Firebase Studio workspaces or account registrations
- **March 22, 2027**: Firebase Studio shuts down entirely; any code stored only there becomes inaccessible

### What this means for Trash & Treasures

Nothing. The NFL app uses **Firestore** (Firebase's database service), which the email explicitly says is unaffected:

> "Core Firebase services (Firestore, Auth, App Hosting) are not affected and will continue to operate normally."

The Firebase project `trash-treasures-2b85a` and its Firestore database will keep running.

### Action items

- [ ] **If you ever used Firebase Studio as an IDE** to edit any project code, export/download that workspace before March 22, 2027 using the "Zip & Download" feature. Then open it in a desktop IDE (VS Code, etc.) or Google Antigravity.
- [x] **NFL app** — no action needed. Firestore backend continues as-is.
- [ ] Check if any other projects live only inside a Firebase Studio workspace and haven't been pushed to GitHub.

### Bottom line

The risk is only if you have code *stored inside a Firebase Studio workspace* that isn't backed up elsewhere (e.g., pushed to GitHub). Any code that's already in a GitHub repo is safe regardless.
