## Open in App (Android App Links) [Planned]

Goal: when someone taps a link to our site (an order link in a chat, an email, a notification, a browser tab) on an Android
phone or tablet that has the WTF POS app, the link opens in the app and not in the browser, and the browser shows its
"open in app" choice. Decided direction (Pogi, 17 Nov 2026): **no PWA**, because we already ship our own Android app
(`com.wtf.pos`). The PWA route is written up at the end only so the reason is on record.

### What the repo has today (checked on main, 702f94e)

| Piece | State |
| ----- | ----- |
| Web manifest | `public/manifest.webmanifest` exists (standalone, icons 192/512 plus maskable, `start_url` `/`). |
| Service worker | Angular `ngsw-worker.js` (production only, `provideServiceWorker`) plus `firebase-messaging-sw.js` for web push. `ngsw-config.json` has no `navigationUrls` and no data groups. |
| Install prompt | None. No `beforeinstallprompt` handler anywhere. |
| Capacitor app | `appId: com.wtf.pos`, WebView on `http://localhost` (`androidScheme: 'http'`), API called by absolute URL (`https://wtfbyfaith.runasp.net/api`). Flavors: production `com.wtf.pos`, staging `com.wtf.pos.staging`, dev `com.wtf.pos.dev`. |
| App Links | **None.** `AndroidManifest.xml` has only the launcher intent filter, no `https` filter, no `autoVerify`. |
| `assetlinks.json` | **None.** No `.well-known` folder anywhere. |
| Link handling in the app | `@capacitor/app` is installed but only used for `backButton` and `appStateChange`. No `appUrlOpen` listener. |
| Signing | APK is signed with a keystore from GitHub secrets (`ANDROID_KEYSTORE_BASE64` for production, `..._STAGING` for staging), shipped as a GitHub Release APK, not Google Play. |
| Domains | Production `wtfbyfaith.runasp.net`, staging `wtfbyfaith-staging.runasp.net`, both on MonsterASP.NET. The API host serves the built Angular app (`UseStaticFiles` plus `MapFallbackToFile("index.html")`). |

Side effect worth knowing: because of the manifest and the service worker, desktop Chrome and Edge probably already offer
"Install WTF POS" on the production site today. We do not need to remove it, but we should not promote it (see the PWA note).

### What the browser button really is

- **Android Chrome with verified App Links:** there is no button. A tapped https link just opens the app straight away
  (Android 12 and newer treat verified links as "open in this app" by default; older versions ask once). If the user
  turns it off, they can re-enable it in Settings, Apps, WTF POS, Open by default.
- **Desktop Chrome and Edge:** the "open in app" icon beside the address bar belongs to **installed PWAs only**. Without a
  PWA that icon cannot appear. Pogi's screenshot is that desktop PWA icon. There is no Android APK equivalent on desktop.
- **Android Chrome button for a non-Play app:** Chrome's own "Open in app" banner needs the app to be listed on Google Play
  (`related_applications`). We ship by GitHub APK, so that banner is not available.
- **So the button we can offer is our own.** On Android browsers (not inside the app) the site shows a small bar
  "Open in the WTF POS app" with an **Open** button (and "Get the app" linking to the latest APK Release when the app is
  not installed). Open uses the Android intent URL form `intent://<path>#Intent;scheme=https;package=com.wtf.pos;S.browser_fallback_url=<encoded fallback>;end`,
  which opens the app if installed and falls back to the Release page if not. It is hidden on desktop, iOS and inside the app.

### Design

**1. Android manifest: intent filter for our domains**

Add to `MainActivity` in `android/app/src/main/AndroidManifest.xml`:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="${appLinkHost}" />
</intent-filter>
```

`appLinkHost` is a manifest placeholder set per flavor in `build.gradle`: production `wtfbyfaith.runasp.net`, staging
`wtfbyfaith-staging.runasp.net`, dev none (the filter is dropped for dev, or points at the staging host). Optional
`android:pathPrefix` limits which paths open the app (see open question 3). Only `https`; `http` links are not claimed.
Keep `launchMode="singleTask"` so a tap on a link while the app runs reuses the open window.

**2. `assetlinks.json` on each domain**

Android only trusts the app for a host if `https://<host>/.well-known/assetlinks.json` lists the package name and the
SHA-256 fingerprint of the signing certificate:

```json
[{ "relation": ["delegate_permission/common.handle_all_urls"],
   "target": { "namespace": "android_app", "package_name": "com.wtf.pos",
               "sha256_cert_fingerprints": ["AA:BB:..."] } }]
```

Rules that bite: it must be served over https with status 200, no redirect, `Content-Type: application/json`, public
(no login). Fingerprints are public and not secrets (they are not the keystore or its passwords).

Hosting on MonsterASP.NET, found in the repo:

- Do **not** just drop a file in `public/.well-known/`. The API's `UseStaticFiles` uses `PhysicalFileProvider`, which hides
  dot-prefixed folders by default, so the request would fall through to the SPA fallback and return `index.html`. Angular's
  `**/*` asset glob also skips dot folders unless `"dot": true` is set.
- **Plan: serve it from the API** with one minimal endpoint, `GET /.well-known/assetlinks.json`, anonymous, built from
  configuration `AppLinks:Packages` (list of package name plus fingerprints per environment, appsettings per host). It
  returns JSON from config, so staging lists `com.wtf.pos.staging` with the staging keystore and production lists
  `com.wtf.pos` with the production keystore, and a key change is a config edit without a rebuild. Add `Cache-Control: public, max-age=3600`.
- Add `/.well-known/**` and `/api/**` to `navigationUrls` exclusions in `ngsw-config.json` so the service worker never
  answers them with `index.html`. (URLs ending in `.json` are already skipped by default, but make it explicit.)

Getting the fingerprint: `keytool -list -v -keystore wtf-pos-release.keystore -alias wtf-pos`, copy the `SHA256:` line.
Pogi (or the CI, printed once in a build step) does this for the production keystore and the staging keystore. If we ever
move to Google Play with Play App Signing, add the Play signing fingerprint as a second entry; the file allows several.

**3. Routing the opened link inside the app**

The WebView runs on `http://localhost`, so the Angular router will not see the incoming URL by itself. Add an
`AppLinkService` (in `core/services`) that listens to `@capacitor/app` `appUrlOpen`, takes the path, query and fragment
from the incoming https URL, checks the host against an allow-list (the app's own API host from `environment.apiUrl`),
and calls `router.navigateByUrl(path)`. Also handle the cold start case with `App.getLaunchUrl()`. Rules:

- Only same-host links; anything else is ignored.
- Paths that need a login go through the normal `authGuard`, so a signed-out user lands on login with a return URL, then the target.
- Public customer order links (`/shop/:token`, the customer ordering links feature) are for customers on their own phones,
  not staff. **Open question 3** decides whether the app claims them or leaves them in the browser (a customer who happens
  to have the staff app would otherwise see the staff app, which is wrong). The default in this plan: **claim staff routes
  only** (orders, management, reports), and exclude `/shop/` and `/api/`.

**4. The "Open in app" bar on the website**

A small shared component `app-open-in-app-bar`: shown only when the user agent is Android, `Capacitor.getPlatform() === 'web'`,
and it has not been dismissed (remember "Not now" for 7 days in `localStorage`). Two actions: **Open** (intent URL with the
current path) and **Get the app** (latest Release APK, reusing the URL logic in `UpdateService`). It sits under the header,
not over the sign-in form. Buttons follow `docs/BUTTONS.md`.

### Staging versus production

- Two verified hosts, two packages, two keystores. Staging APK (`com.wtf.pos.staging`) claims only the staging host, so a
  tester with both apps never has links stolen across environments.
- The staging APK is signed with the staging keystore; its fingerprint goes in staging's `AppLinks:Packages`.
- Verification happens when the app is installed (and re-checked later). After first publishing `assetlinks.json`, the app
  must be reinstalled or updated, or verification is triggered with `adb shell pm verify-app-links --re-verify com.wtf.pos`.
- Check with `adb shell pm get-app-links com.wtf.pos` (state `verified` for the host) and Google's Digital Asset Links
  tester URL `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<host>&relation=delegate_permission/common.handle_all_urls`.

### Multi-tenancy

The multi-tenant plan says each shop gets `{slug}.<our domain>`; today there is one pilot shop on `wtfbyfaith.runasp.net`.

- An intent filter can claim a wildcard host (`android:host="*.<our domain>"`), but **Android verifies every subdomain
  separately**, each one must serve its own `assetlinks.json`. Because the endpoint above lives in the API, and the API
  answers every host, one wildcard certificate plus this one endpoint covers all shops. This is another reason to serve the
  file from the API and not as a static file.
- Custom domains (later paid extra) would each need to be added to the manifest at build time, which is impossible for a
  generic shared APK. Plan: custom domains do **not** open the app (no App Links); they keep the browser plus our own bar.
- The tenant comes from the host, so a link to `moonbrew.<domain>/orders/123` carries the shop. The app has a single
  "shop code" login today (the multi-tenant plan). If the app is signed in to a different shop than the link's host,
  `AppLinkService` shows a notice "This link is for another shop" and does not navigate. Open question 5.
- The branded Android build (a paid extra in the multi-tenant plan) has its own package name, so it needs its own
  `assetlinks.json` entry and its own host filter. Not in the first cut; keep `AppLinks:Packages` a list so it fits.

### Passkeys and the fingerprint login plan

- Web passkeys are tied to the domain (`rpId`). App Links do not change the domain, so nothing here affects them.
- The fingerprint plan's Android path uses a native Keystore key, not WebAuthn, and says the app on `http://localhost` is
  not a real relying-party domain. Opening links in the app therefore does not need or break passkeys.
- Both plans do depend on **one decision: the permanent production domain**. A changed domain orphans web passkeys and
  also needs a new intent filter plus a new `assetlinks.json` host in a new APK. Settle the domain first (open question 1).
  If the app ever moves to Credential Manager passkeys, the same `assetlinks.json` file would also carry the
  `delegate_permission/common.get_login_creds` relation; add it then, not now.

### UI at 375 / 820 / 1440

- **Bar:** shown on Android browsers only, so mainly 375 and 820 (tablets). At 375: one line of text, two buttons side by
  side, full width, 44 px high. At 820: same bar, content centred with the usual page max width. At 1440 it is never shown
  (desktop is not Android); nothing to check except that it stays hidden.
- Same animation as the rest of the app (200 ms ease-out slide in). Dismissed state remembered.
- In the app there is no UI change except the "another shop" notice, which is the standard `app-alert` dialog.
- Screenshots go in `plans/open-in-app/` (the bar needs an emulated Android user agent in Playwright, since the real
  intent hand-off cannot run in a desktop browser).

### Tests

- **.NET (`WTF.Tests`):** `assetlinks.json` endpoint returns 200, `application/json`, no auth, no redirect, the configured
  package and fingerprints; staging and production configs give different packages; an empty config returns `[]`; the
  SPA fallback does not swallow `/.well-known/assetlinks.json` (regression test for the dot-folder trap).
- **Angular (vitest):** `AppLinkService` (same-host path navigates; other host ignored; `/shop/` and `/api/` ignored;
  launch URL on cold start; signed-out user keeps the return URL; wrong-shop notice); bar visibility rules (Android UA on
  web shows; desktop, iOS, inside the app, dismissed within 7 days all hide); intent URL builder (encoding of path, query and fallback).
- **Playwright (separate port, throwaway database, 3 workers, no skips):** bar at 375 and 820 with an Android UA, hidden at
  1440, dismiss remembered, `/.well-known/assetlinks.json` is served as JSON and not HTML.
- **Manual on real devices (cannot run in CI), a short checklist:** install production APK, `pm get-app-links` shows
  `verified`, tap a production link from Chrome, WhatsApp and a notification, cold and warm start, signed-out case; repeat on
  the staging APK with the staging host; one Huawei phone without Google services (link verification and Chrome-less browsers differ there);
  tablet in landscape.

### Rough size

| Slice | Work | Days |
| ----- | ---- | ---- |
| 1 | Manifest filter and flavor placeholders, API `assetlinks.json` endpoint and config, ngsw exclusions, tests | 1 |
| 2 | `AppLinkService` (warm and cold start, guards, allow-list, wrong-shop notice) and tests | 1 to 1.5 |
| 3 | Browser "Open in app" bar, intent URL, dismiss memory, Playwright at 375/820/1440 | 1 |
| 4 | Fingerprints, staging then production verification on real devices, checklist, docs | 0.5 to 1 |

About **3.5 to 4.5 focused days**. Needs on Pogi's side: the two keystore fingerprints (or let CI print them) and a phone to
test with. No SQL, so no dbsync.

### Staging demo data

No new tables, columns or settings, so the seed does not change. On staging the demo is the staging APK opening
`wtfbyfaith-staging.runasp.net` links. Nothing to add to `tools/staging/reset_staging_data.sql`.

### Not recommended: installable web app (PWA)

Not chosen, on Pogi's steer, for these reasons:

- We already ship the real app (push, printing, file saving, offline sync, update flow through GitHub Releases). A second
  installed copy of the same shop splits what staff see (two icons, two offline stores, two update paths, two push registrations).
- On Android a PWA and the APK would **compete for the same links**; Chrome would build a WebAPK for the same origin.
- iOS has no `beforeinstallprompt` and no "open in app"; Safari only offers Add to Home Screen by hand, so the web route
  helps desktop most, and desktop is not where the pain is.
- The existing service worker setup is built for fast loading, not as an install feature; promoting install adds support
  load (stale versions, cache after a sign-out) without a gain for APK users.
- What we keep: the existing manifest and service worker stay as they are (they power update checks and web push). If desktop
  staff later ask for an icon, the cheap step is an install button; roughly 1 to 1.5 days, noted here, not planned.

### Open questions for Pogi

1. **Final production domain.** Is `wtfbyfaith.runasp.net` the permanent address? App Links, web passkeys and the APK
   filter are all tied to it. A custom or branded domain later means a new APK release.
2. Can you run `keytool` on the production and staging keystores and send the two SHA-256 fingerprints (they are not secret),
   or should CI print them once in the build log?
3. Which links should open the app: staff pages only (orders, management, reports; my recommendation), or also the public
   customer order links (`/shop/:token`)? Customers should probably stay in the browser.
4. Is a small "Open in the WTF POS app / Get the app" bar on the website (Android only) what you meant by the "open in app"
   button, or did you only want the browser to hand links to the app silently?
5. If staff are signed in to shop A and tap a link for shop B (once subdomains exist), is "this link is for another shop" fine?
6. Will you ever list the app on Google Play? That would add the Play signing fingerprint and the official Chrome "Open in app" banner.
7. Do any staff use phones without Google services (Huawei)? Link verification is least predictable there; we would test one device.
