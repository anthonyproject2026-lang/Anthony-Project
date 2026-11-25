# SHEMA registry — set-up steps for the committee and the Firebase owner

These are the steps that only the person who owns the Firebase project (`anthony-form`) and the Vercel project can do. The web developer cannot do them. Console menu names are as at November 2026; they may differ slightly.

**Until this pull request is live, administrators should not use "Edit Profile" on the current site.** That screen is where harmful text stored in a registration could run in the administrator's browser. Viewing records in the Firebase console is safe.

---

## Part 1 — Database rules and administrators (do in one sitting, in this order)

Steps 1 to 4 can be done before the website change is approved. The new rules still accept registrations from the current site, so publishing them first causes no outage.

1. **Back up the current rules.** Firebase console → project `anthony-form` → Firestore Database → Rules. Copy the whole of the current rules into a text file and keep it. Send a copy to the web developer.
   **Important:** if the current rules mention any path other than `artifacts/sma-registry-2026/...`, or if any other website or app uses this Firebase project (for example the main SHEMA website), **stop and tell the developer first.** Publishing new rules replaces all of the old ones.
2. **List the administrators.** Authentication → Users. For each person who should be a registry administrator, find their email row and copy the "User UID". Remove any user who should not be there. [COMMITTEE TO CONFIRM: list of administrators]
3. **Create the administrator list.** Firestore Database → Data → Start collection → Collection ID `admins`. For each administrator add a document whose **Document ID is exactly their User UID**. Add one field, for example `name` (string) with the person's name. The content does not matter; the ID does.
4. **Publish the rules.** Rules tab → replace the text with the contents of `firestore.rules` from the pull request → Publish. The live form keeps working. From this moment only the listed administrators can read the register.
   *Side effect until step 5:* on the **old** site, "Edit Profile → Update" will be refused (the old site rewrites the submission date). Marking paid, deleting and public registration keep working.
5. Approve and merge the pull request. Wait for Vercel to show the new version as Ready.
6. **Check it works:** submit one test registration on the live site; log in as an administrator; confirm the test record appears; mark it paid; edit it; delete it. Open the browser console (F12 → Console) and confirm there are no "Content Security Policy" errors. Then press **"Check records for unsafe content"** on the dashboard and send the result to the developer.
7. Authentication → Settings → User actions: if the option is shown, turn **off** "Enable create (sign-up)" so nobody can create their own account. Also in Authentication → Sign-in method, confirm only "Email/Password" and "Anonymous" are enabled.
8. About a week later, ask the developer to remove the block marked `LEGACY` from the rules, and publish again.

**To undo:** the Rules tab keeps a history; pick the previous version and publish it. To undo the website change, revert the merge commit in GitHub.

---

## Part 2 — Further protection

### 2.1 Restrict the web API key (about 10 minutes, free, do after the pull request is live)

1. Go to console.cloud.google.com and choose project `anthony-form` → APIs & Services → Credentials.
2. Under **API keys** open the key used by the website (usually named "Browser key (auto created by Firebase)"; it starts with the same characters as the `apiKey` in `src/app.js`).
3. **Application restrictions → Websites.** Add:
   - `https://smaregistry.vercel.app/*`
   - `https://anthony-form.firebaseapp.com/*`
   - `https://anthony-form.web.app/*`
   - any other address members use to reach the form [COMMITTEE TO CONFIRM: any custom domain or other address]
4. **API restrictions → Restrict key** → tick: Identity Toolkit API, Token Service API, Cloud Firestore API, Firebase Installations API (and Firebase App Check API if 2.2 is done).
5. Save. Wait five minutes, then repeat the check in Part 1 step 6.

Warnings: if another website or app uses the same key it will stop working until its address is added. Test copies of the site (Vercel previews, a developer's computer) will stop working, which is intended. This reduces casual misuse of the key; it is not a complete defence — the database rules in Part 1 are the real protection. To undo, set Application restrictions back to None.

Note for the developer: the site's `Referrer-Policy` must keep sending the origin (it is `strict-origin-when-cross-origin`); `no-referrer` would break a referrer-restricted key.

### 2.2 App Check (optional second stage; needs a follow-up code change)

Not included in this pull request, because it needs a site key that only the Firebase owner can create, extra third-party scripts (reCAPTCHA) and a loosened Content Security Policy.

1. Firebase console → App Check → Apps → select the web app → choose a reCAPTCHA provider and register the site's address(es). Check the current pricing page first and choose an option with no charge. [COMMITTEE TO CONFIRM: no billing account is to be attached]
2. Give the site key to the developer (it is not a secret).
3. Developer follow-up: add `firebase/app-check` to the self-hosted Firebase bundle, call `initializeAppCheck` with the key, extend the CSP for the reCAPTCHA script, frame and App Check endpoints, re-run all tests.
4. After that version is live, watch App Check → APIs → Cloud Firestore metrics for at least a week. Verified requests should be nearly 100%.
5. Only then press **Enforce** for Cloud Firestore. Enforcing before step 3 is live will break the form for everyone.

---

## Part 3 — Facts only the committee can supply

The privacy wording on the form and in the "Privacy information" page contains `[COMMITTEE TO CONFIRM: ...]` placeholders. They are deliberately visible so they cannot be missed. **Do not merge until every one is resolved.** Run `npm run check:placeholders` in `dev/` to list whether any remain.

- the purposes for collecting the details, and any other use (newsletters, events, member directory)
- who can see the register (roles)
- whether details are shared with anyone else
- how long details are kept and how they are deleted
- who to contact to see, correct or delete details, and how quickly you will respond
- what someone can do if they are unhappy with the response to a complaint
- the association's full legal name and any registration number
- the database location (Firebase console → Firestore Database; the location is shown with the database details), and whether the "may be stored outside Australia" sentence stays
- whether there is another way to join (for example a paper form)
- how and when bank details are sent to new members
- whether 12 household members per registration is enough (the limit is in `src/lib.js` and `firestore.rules` and must match)
- the approval date of the privacy information (dd/mm/yyyy)

Points for the committee to decide (not shown on the page):

- One tick box currently covers both consent and the statement about family members' details; you may prefer two.
- Whether profession, spouse's profession and home address are really needed (collect less where possible).
- Whether children need to be listed by name, or whether a count would do.
- Who answers privacy requests.
- Whether members who registered before this notice existed need to be told anything.
- Some existing text on the page has low colour contrast (see `dev/reports/existing-contrast-issues.json` after running the tests). Fixing it changes the look, so it needs a design decision.
