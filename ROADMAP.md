# Roadmap — Path to Soft Launch

Decided architecture for locking the app down so **Vince is the only admin** and
everyone else views (including watching the draft live).

## Decided model

- **Auth:** Firebase Auth with Google sign-in. Exactly one admin (Vince). Your
  user ID (UID) is hardcoded in the security rules.
- **Everyone else:** read-only, **no login ever**. Viewers read straight from
  Firestore with no auth.
- **Draft:** you make every pick live in the app on a group call; viewers watch
  the draft board update in real time on their own (non-admin) devices.
- **Consequence:** because friends only ever *read* — even during the draft —
  we do **not** need anonymous auth or any looser write rules. One rule covers
  everything: public read, writes only by your UID.

## Security rules (the whole enforcement)

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

If draft state lives in its own collection, add a matching block with the same
read/write rule.

## Work items

### 1. Firebase console (manual, ~10 min)
- [ ] Enable **Google** as a sign-in provider.
- [ ] Sign in once in the app, capture your UID (`auth.currentUser.uid`).
- [ ] Paste your UID into the rules above and **publish** them.

### 2. App — auth integration (`index.html`)
- [ ] Add the `firebase-auth-compat.js` CDN script.
- [ ] Add a **Sign in / Sign out** control, shown only in the admin context
      (`?admin=1`). Viewers never see it.
- [ ] Gate admin writes on being signed in as the admin UID. If someone opens
      `?admin=1` but isn't signed in, show "Sign in to edit" instead of the
      edit tabs. (The rule is the real enforcement; this is just UX.)

### 3. App — draft goes live to viewers
> Today the Draft tab is localStorage-only and doesn't sync at all, so this is
> the prerequisite for viewers seeing anything.
- [ ] Move draft state from localStorage into Firestore (debounced save, same
      pattern as the main board).
- [ ] Admin makes picks → writes to Firestore (allowed only for your UID).
- [ ] Viewers subscribe to draft state and render the board **read-only**
      (reuse `DraftRosterPreview` + the on-the-clock banner) while a draft is in
      progress.

### 4. Cleanup / known bugs
- [ ] Fix the undo-swap record bug (`index.html` ~L1169): restoring a swapped
      team rewinds its record to the banked snapshot instead of keeping the live
      total.
- [ ] Decide what happens to any existing localStorage draft (migrate or ignore).

## Rough effort
- Auth lock (items 1–2): ~1–2 hours.
- Draft → Firestore + live viewer board (item 3): ~2–4 hours.
- **Total: roughly half a day.**

## Explicitly out of scope (for now)
- Friends running their *own* independent leagues (full multi-tenant + per-user
  ownership). Revisit only if there's demand.
- Friends drafting from their own devices (would need anonymous auth + a
  sandboxed draft doc). Not needed under the "admin picks, others watch" model.
