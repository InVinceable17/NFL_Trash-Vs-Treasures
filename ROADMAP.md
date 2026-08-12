# Roadmap

The soft-launch plan (single admin, everyone else watches) is **built and
deployed**. What follows is the model as shipped, plus what's left.

## The model

- **Auth:** Firebase Auth with Google sign-in. Exactly one admin (Vince), whose
  UID is hardcoded as `ADMIN_UID` in `index.html` *and* in the security rules.
- **Everyone else:** read-only, **no login ever**. Viewers read straight from
  Firestore with no auth.
- **Draft:** the admin makes every pick live; viewers watch the board update in
  real time on their own devices.
- **Consequence:** because friends only ever *read* — even during the draft — we
  need no anonymous auth and no looser write rules. One rule covers everything:
  public read, writes only by the admin UID.

## Security rules — the whole enforcement

These live in the Firebase console (project `trash-treasures-2b85a`), not in this
repo. The UI gating is only UX; **these rules are what actually stops anyone
else writing.**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /leagues/{league} {
      allow read:  if true;                               // anyone with the link
      allow write: if request.auth != null
                   && request.auth.uid == "YOUR_UID_HERE"; // only Vince
    }
  }
}
```

If draft state lives in its own collection, it needs a matching block.

## Shipped

- [x] Firebase Google sign-in wired up; `ADMIN_UID` set to a real UID.
- [x] Admin-only tabs (Edit / Swap / Draft) hidden from viewers; sign-in control
      shown only in the admin context.
- [x] Draft state moved from localStorage into Firestore, synced live so viewers
      watch picks land in real time.
- [x] Central league registry — all leagues listed from Firestore, with rename
      and a landing page.
- [x] Hourly ESPN score sync via GitHub Action, plus in-browser auto-sync.
- [x] Paired swaps enforced (rosters stay 4 & 4), banked values regenerated from
      real per-window game results.
- [x] Swap re-edit no longer destroys data — `undoSwapWindow()` is a pure
      inverse of `applySwaps()`, guarded by `tools/swap-roundtrip.test.mjs`.

## Open

- [ ] **Verify the published Firestore rules** match the block above and carry
      the real UID. This can only be checked in the Firebase console, and it is
      the only thing actually preventing a stranger from writing to the leagues.
- [ ] Decide what happens to any leftover `localStorage` draft from before the
      Firestore migration (migrate or ignore).

## Out of scope for now

- Friends running their *own* independent leagues (full multi-tenant + per-user
  ownership). Revisit only if there's demand.
- Friends drafting from their own devices (would need anonymous auth + a
  sandboxed draft doc). Not needed under the "admin picks, others watch" model.
