## Biometric Login (fingerprint / face) [Planned]

Let staff sign in with the fingerprint or face unlock already set up on their phone, tablet or laptop, instead of typing a
username and password every time. It is an addition: the password stays the way in, and fingerprint is switched on
afterwards from a signed-in device.

Planning only. Nothing is built. Written 17 Nov 2026 against `main` at v1.22.1.

### What exists today (read from the code)

| Area | Today |
| ---- | ----- |
| Sign-in | `POST /api/auth/login` (`LoginHandler`): finds the user by username across all shops (`IgnoreQueryFilters`, usernames are globally unique), checks the BCrypt hash, then `TenantAccess.EnsureActiveAsync` and `UserSeatLookup.EnsureNotBlockedAsync` (plan seat cap), then `db.UseTenant(user.TenantId)`. |
| Tokens | One 60 minute JWT (`sub`, `unique_name`, `role`, `tenant` claim) and one 7 day refresh token row in `dbo.RefreshTokens` (rotated on every refresh, `IsRevoked`). `JwtService` is the only place that signs. |
| Tenancy rule | `TenantTokenRule`: every shop token must carry a tenant id. Legacy no-tenant tokens get 401. Platform admins are separate (`dbo.PlatformAdmins`, `/api/platform/login`, own rate limit policy). |
| Other session rules | `MustChangePassword` flag; `SessionRevocation` revokes all refresh tokens when a password changes; impersonation tokens are read-only/short and separate. |
| Web app | `AuthService` keeps `token` and `refreshToken` in `localStorage`. `authGuard` lets a person in offline when the refresh token is still held and refreshes later. Login page is `features/login`. |
| Android app | Capacitor 8 wrapper (`com.wtf.pos`, WebView served on `http://localhost`, `androidScheme: 'http'`). Same web code. No biometric or secure-storage plugin today. The project notes call the Android app `app.wtf.pos`; the config in the repo says `com.wtf.pos`. Confirm which is current before the native work. |
| Rate limiting | Fixed-window policies exist for platform login (10/min per IP), public links and loyalty. **The shop login has no rate limit and no lockout** (already an open audit item). |
| Audit | `IAuditService`, `AuditAction.UserLogin` / `UserLogout`; Owner-only audit log screen. |
| Plan gating | Features per plan (`ITenantFeatures`, `FeatureRequirement`); shop settings in `TenantSettings`. |
| Staff PIN / shared till | **Does not exist.** Only mention in the repo is an "Admin PIN" idea in `promotions.md`. Nothing to integrate with yet. |

### Decision: what "fingerprint login" means

The fingerprint never leaves the device and the server never sees it. The device proves "the person who unlocked me with
their fingerprint is holding the key I registered earlier" by signing a one-time challenge from the server. The server
checks the signature against a public key it stored at enrolment, then issues the **same** JWT and refresh token a password
login issues. So everything after sign-in (roles, permissions, plan gating, offline sync, tenancy) is unchanged.

Two ways to hold that key, one server flow:

| Device | Key lives in | How the person sees it |
| ------ | ------------ | ---------------------- |
| Web (Chrome, Edge, Safari, Firefox; phone, tablet, laptop) | A **passkey** (WebAuthn, platform authenticator) in Windows Hello, Touch ID / Face ID, Android or iCloud Keychain | "Sign in with fingerprint" opens the system prompt |
| Android app | An **Android Keystore** key pair that needs biometric unlock to sign, made by a small native Capacitor plugin | Same button, native fingerprint sheet |

Why two: the Android WebView inside the Capacitor app cannot be relied on for WebAuthn (no Credential Manager bridge, and the
app runs on `http://localhost`, which is not a real relying-party domain). A native Keystore key avoids both problems and
works the same on Huawei devices without Google services (the app already ships Huawei push). The server treats both as a
"credential" with a type, so there is one table, one challenge flow and one verification entry point.

Options considered and not chosen:

| Option | Why not |
| ------ | ------- |
| Biometric only unlocks a refresh token stored on the phone | Simple, but it is just an app lock: after the 7 day refresh token expires, logout, or on a new device, the person is back to typing the password. It also leaves a long-lived bearer token on the device. Kept only as the offline behaviour (below). |
| Passkeys only, also in the APK, via a Credential Manager plugin | Depends on Google Play Services and an `assetlinks.json` tie to the web domain; fails on Huawei. |
| Third-party sign-in (Google, Microsoft) | Not requested, adds accounts and data sharing. |

### How it maps onto the token flow and tenancy

1. **Enrol (signed in, any device):** `POST /api/auth/credentials/options` (needs the current password again, see Security) returns a challenge and the shop-side settings. The device creates the key, `POST /api/auth/credentials` stores the public key.
2. **Sign in:** the device asks `POST /api/auth/credentials/challenge` (no login yet; returns a random single-use challenge), signs it, and posts the assertion to `POST /api/auth/credentials/login`.
3. The handler looks the credential up by its id **across shops** (`IgnoreQueryFilters`, exactly like `LoginHandler` does for usernames; the credential id is globally unique), reads `UserId` and `TenantId` from the row, and then runs the **same checks as password login**: user active, `TenantAccess.EnsureActiveAsync`, `UserSeatLookup.EnsureNotBlockedAsync`, then `db.UseTenant(user.TenantId)`.
4. Token issuing moves out of `LoginHandler` into one small shared service (for example `SessionIssuer`) used by password login, refresh and biometric login, so the claims (including the tenant claim) and the refresh token row are built in one place. This is a refactor that keeps current tests green and removes the risk of a second path forgetting the tenant claim.
5. Because the tenant comes from the stored credential row, the usernames-are-globally-unique rule is not touched and a legacy no-tenant token can never be produced: `TenantId` on the row is required and non-empty.
6. **Not offered to:** platform admins (their own area stays password only for v1), impersonation tokens, and any user with `MustChangePassword = true` (they must set a new password first, then enrol).
7. If the shop is suspended, the plan seat cap blocks the user, or the user is deactivated, biometric login fails with the same messages the password login shows today.

### Per-device enrolment and removal

- Enrolment is per person per device. One person can have several devices (phone, till tablet, laptop). Suggest a cap of 5 per person (setting in code, not a screen).
- Each credential has a name the person can edit (default from the device, for example "Samsung Galaxy A54" or "Windows laptop").
- **My account** page: a "Fingerprint sign-in" card listing the person's devices (name, added, last used), **Add this device**, and **Remove** per row. Removing the device you are using asks for confirmation.
- **Management > Users** (Owner / roles with user management): on a user's detail page, "Fingerprint devices: 2" with **Remove all**, for a lost phone or a staff member who left. Needs a new permission key `users.manage-credentials`, added to the same permission catalog and role editor as other keys; Owner has it by default.
- Automatic removal: a user's credentials are deleted when the user is deleted or deactivated, when an admin resets their password (`ResetTenantUserPasswordHandler`, `UpdateUserHandler` password path), and when the person's own password change runs (`SessionRevocation` already ends other sessions; credentials on other devices go too, the current device's stays). Open question below.
- Removal is soft (`RevokedAt`) so the audit log keeps the history; revoked rows can never sign in.

### Password fallback

- The password form is always on screen. The fingerprint button sits above it, and only shows when this device has a credential for a remembered username (web: stored credential hint in `localStorage`; Android: a Keystore alias).
- Any failure (cancelled prompt, new fingerprint added to the phone, key invalidated, server says no) falls back to the password form with a short message. No dead ends.
- On Android, a key that is invalidated because the phone's fingerprints changed is a normal case: show "Fingerprint changed on this phone. Sign in with your password to set it up again", and drop the old credential on the server at the next password login.
- The password is also always the way to reset everything: signing in with the password and removing the device works the same as today.

### Relation to shared till and staff PIN

There is no staff PIN or quick-switch feature today, so nothing here depends on one. The design leaves room:

- A shared till tablet is where fingerprint is **risky**: whoever has a fingerprint enrolled on that tablet's lock screen can sign in as the enrolled person. The shop setting (below) lets the Owner turn fingerprint off for the shop, and the enrol screen warns "Only add devices that only you use".
- A future PIN or "switch user" feature should reuse the same `UserCredentials` table with another type (`Pin`) and the same challenge/lockout code, so one security model covers all quick sign-in methods. Not planned here.
- Fingerprint never replaces the stepped-up checks other roadmap features want (for example an Admin PIN for large discounts): those are separate, per-action prompts.

### Offline behaviour

Sign-in itself needs the server (to verify the signature and issue tokens). Offline, the app already works from the stored session. Proposed:

- **Offline unlock (Android and web with a stored session):** if the refresh token is still held, an optional "Lock the app with fingerprint" turns the biometric prompt into the gate when the app opens or comes back from the background. It reuses the existing offline rules (the same ones `authGuard` applies today) and does not give anyone new access. No credentials are checked by the server in this path.
- **Offline fresh login:** not possible, same as today with a password. The button is disabled with "You are offline. Connect to sign in" and the existing offline banner copy.
- The signed challenge is single use and short lived, so a queued offline sign-in can never be replayed later.
- Offline order sync (phase 7 of `offline.md`) is unaffected; synced orders still use the access token the normal way.

### Plan gating and shop setting

- Recommended: **not** a paid feature. It is a security and convenience feature, and gating it makes weaker passwords more likely. All three plans have it.
- A shop setting on **Settings** (Owner only): "Allow fingerprint sign-in", default on. Off blocks new enrolment and rejects biometric logins for the whole shop, without deleting credentials, so it can be switched back on. Stored as a new column on `TenantSettings`.
- If Pogi would rather sell it, the hook is one plan feature key plus a `FeatureRequirement` on the endpoints, and the "Not in your plan" page already handles the web side.

### Security

- **Library:** use the maintained `Fido2NetLib` for WebAuthn parsing and verification (attestation `none`, user verification required, resident/discoverable credential preferred, algorithms ES256 and RS256). Do not hand-roll CBOR or signature checks. The Android Keystore path verifies an ECDSA P-256 signature over `challenge || rpId || credentialId` with the standard .NET crypto API.
- **Relying party:** WebAuthn ties a passkey to the web domain (`rpId`). Configuration `Fido2:ServerDomain` and `Fido2:Origins` per environment (production, staging, `localhost` for dev). **Changing the production domain later orphans every web passkey** (people must re-enrol), so pick the final domain before launch. The Android Keystore credential is not tied to the domain.
- **Challenges:** 32 random bytes, single use, expire in 2 minutes, stored server side keyed by an opaque id (table `dbo.AuthChallenges`, or `IMemoryCache` if the site stays on one instance; the host is a single IIS site today, so memory cache is acceptable but note the assumption).
- **Step-up to enrol:** adding a device requires the person's current password in the same request, even though they are signed in. A stolen unlocked session cannot silently add the attacker's fingerprint.
- **Sign count / replay:** WebAuthn sign counter must increase; a decrease marks the credential suspect and revokes it.
- **Rate limiting:** a new `biometric-login` fixed-window policy: 10 requests per minute per IP (same shape as the platform login policy, multiplied by `RateLimiting:Multiplier` for tests), plus a per-credential counter.
- **Lockout:** 5 consecutive failed assertions on a credential revokes it (person re-enrols with the password). The shop password login has no lockout today. Recommend adding a matching password lockout and rate limit **as a separate small task before or alongside this one**, because biometric sign-in is only as strong as the weakest door, and the same audit item already lists the login rate limit as open.
- **Errors:** one generic "Fingerprint sign-in failed" message to the client; the reason (unknown credential, revoked, counter regression, shop suspended) goes to the audit log only. No user enumeration.
- **Audit log:** new `AuditAction` values `BiometricEnrolled`, `BiometricRemoved`, `BiometricRemovedByAdmin`, `BiometricLogin`, `BiometricLoginFailed`, `BiometricLockedOut`, and `AuditEntityType.UserCredential`. Records name, credential type, device name and IP (not the key).
- **No secrets in the repo:** the Android key and passkey private keys never leave the device. Nothing new to put in a secret store; only configuration for `rpId` and origins.
- **Tokens:** biometric login issues the same 60 minute access token and 7 day refresh token. No longer-lived token is introduced.

### Schema

New SQL script `tools/sql/<date>_add_user_credentials.sql`, idempotent. **Pick a date that does not collide with the three other open branches** (offline phase 7, multiple branches, kitchen view); suggest `20261125_add_user_credentials.sql` and re-check against their scripts when starting. Run on the real `WTF` database on `.\SQLEXPRESS` first, then `tools\dbsync.bat` (laptop). Do not edit old scripts. Keep dbsync output as generated.

`dbo.UserCredentials` (tenant-owned, global EF query filter like the other shop tables)

| Column | Type | Notes |
| ------ | ---- | ----- |
| `Id` | uniqueidentifier, default `newid()` | |
| `TenantId` | uniqueidentifier, not null | Required, never empty |
| `UserId` | uniqueidentifier, FK `Users` | |
| `CredentialType` | tinyint | 1 = WebAuthn passkey, 2 = Android Keystore key (3 reserved for a later PIN) |
| `CredentialId` | varbinary(1024), **unique index** across all shops | Lookup key at sign-in |
| `PublicKey` | varbinary(max) | |
| `SignCount` | bigint | WebAuthn only |
| `DeviceName` | nvarchar(100) | Editable |
| `Transports` | nvarchar(100) null | WebAuthn hint |
| `FailedAttempts` | int, default 0 | Reset on success |
| `CreatedAt`, `LastUsedAt` | datetime2 | UTC |
| `RevokedAt`, `RevokedBy` | datetime2 null, uniqueidentifier null | Soft removal |

`dbo.AuthChallenges` only if the database route is chosen over memory: `Id`, `Challenge`, `Purpose`, `ExpiresAt`, `UsedAt`.

`dbo.TenantSettings`: add `BiometricLoginEnabled bit not null default 1`.

Code touch points: `TenantOwnedEntities.cs` and `WTFDbContext.Tenancy.cs` (register the filter), `Platform/TenantTables.cs` (so tenant export and delete include the new table), `AuditAction` enum, `PermissionCatalog`.

### API (new feature folder `Features/Auth/Credentials/`)

| Endpoint | Auth | Purpose |
| -------- | ---- | ------- |
| `POST /api/auth/credentials/options` | signed in + current password | Enrolment challenge |
| `POST /api/auth/credentials` | signed in | Store the new credential |
| `GET /api/auth/credentials` | signed in | My devices |
| `PUT /api/auth/credentials/{id}` | signed in | Rename |
| `DELETE /api/auth/credentials/{id}` | signed in (own) | Remove |
| `POST /api/auth/credentials/challenge` | anonymous, rate limited | Sign-in challenge |
| `POST /api/auth/credentials/login` | anonymous, rate limited | Assertion in, `LoginDto` out |
| `DELETE /api/users/{id}/credentials` | `users.manage-credentials` | Admin remove all |

Handlers follow the existing vertical-slice and MediatR style. Counting, "is the cap reached" and "is the shop allowed" rules are small and have no arithmetic, so `WTF.Calculations` is not involved.

### UI (375 / 820 / 1440)

Follow existing styles: shared components, POS classes, dialogs, 200ms ease-out, mobile bottom bar where the page already uses one.

- **Login page:** primary "Sign in with fingerprint" button above the form when the device has a credential; below it a divider "or use your password". On 375 the button is full width and 48px tall (thumb size); on 820 and 1440 it stays inside the existing centred card. Face unlock devices say "Sign in with Face ID / Windows Hello" where the system tells us; the default label is generic ("Sign in with fingerprint or face").
- **After a password login on a device with no credential:** a one-time dismissible card "Sign in faster next time. Use your fingerprint on this device?" with **Set up** and **Not now** (Not now remembers for 30 days).
- **My account:** "Fingerprint sign-in" section: list (cards on 375, table rows on 820/1440 using the existing sortable-list style), **Add this device** opens a dialog that asks for the password, then the system prompt, then names the device. Remove uses the existing confirm dialog.
- **Management > Users > edit user:** read-only count and **Remove all fingerprint devices** (confirm dialog, audited).
- **Settings:** the "Allow fingerprint sign-in" toggle with one line of help about shared tablets.
- States to design: unsupported browser (hide, no error), prompt cancelled (silent), prompt failed (inline message), offline (disabled with the offline copy), revoked credential (inline message plus password form focused).
- Edit pages that ask "Discard Changes?" are unaffected (these forms are dialogs).

### Seed (staging demo)

Real passkey public keys cannot be faked honestly and a seeded credential would not match anyone's device, so the staging seed does **not** invent credentials. For the demo:

- Seed turns the shop setting on (`BiometricLoginEnabled = 1`).
- The Owner demo account has the new permission key, and an "Owner" role with it so the Users page shows the new section.
- Pogi demos by enrolling his own phone live (about 20 seconds). `tools/staging/reset_staging_data.sql` empties the new table with the rest of the shop data automatically; no keep-list entry is needed because credentials are not fixed setup.
- Note in the release notes that every staging deploy clears enrolled devices, so people re-add them after a deploy.

### Tests

- **.NET (`WTF.Tests`):** token issuing shared service (claims incl. tenant; unchanged output for password and refresh); assertion verification with recorded fixtures (valid, wrong challenge, replayed challenge, expired challenge, sign-count regression, wrong rpId or origin, unknown credential, revoked credential); suspended shop, seat-blocked user, deactivated user, `MustChangePassword` all rejected; tenant filter (a credential never resolves across shops except at sign-in lookup, which then pins the tenant); enrol needs password and respects the device cap; lockout after 5 failures; deletion on user delete and password reset; audit rows written; endpoint authorisation and rate-limit tests.
- **Angular (Vitest):** `CredentialService` and the `AuthService` path that stores tokens after biometric login (same side effects as `login()`); login component states; account card; offline and unsupported states; shared `calculation-cases.json` is not involved.
- **Playwright (separate port, tag and stop file, throwaway DB, at least 3 workers, 375/820/1440):** Chromium's virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator` with an internal, user-verifying authenticator) drives enrol, sign-in, remove, password fallback, shop setting off, revoked device, and offline-disabled button. No skipped or flaky specs.
- **Android:** the Keystore plugin cannot run in CI. A written manual checklist on one Google device and one Huawei device (enrol, sign in, fingerprint change invalidates the key, remove, airplane mode), run before each release that touches it.

### Phases and rough size

Sizes are focused working days for one developer including tests and screenshots; native Android is the least predictable part.

| Phase | Scope | Size |
| ----- | ----- | ---- |
| 1 | Prep: extract `SessionIssuer`; password login rate limit and lockout (recommended separate task); SQL script, entities, dbsync, audit actions, permission key, settings column | 2 to 3 days |
| 2 | Web passkeys end to end: Fido2 verification, endpoints, login button, enrol prompt, My account card, shop setting, API and Angular tests | 5 to 6 days |
| 3 | Android native: Keystore plugin (Kotlin, `BiometricPrompt` + key signing, Huawei check), enrol and sign-in through the same endpoints, fingerprint-change handling, offline app lock | 4 to 5 days |
| 4 | Admin side: Users page removal, auto-removal on password reset and delete, audit screen labels, Playwright suite at three widths, staging seed, docs | 3 days |

Total about 14 to 17 working days; phase 1 and 2 alone (web only) are usable and about 7 to 9 days. Phases are separate commits on one branch, and each phase can ship on its own behind the shop setting.

### Risks

- Changing the production domain loses web passkeys.
- Shared tablets: any fingerprint enrolled on the device unlocks the person's account, so the Owner needs the shop setting and the warning copy.
- Huawei and older Android versions: Keystore biometric key behaviour varies; needs real devices.
- iPhone Safari passkeys sync through iCloud Keychain, so a passkey can show up on the person's other Apple devices. That is normal for passkeys but should be said in the enrol dialog. (There is no iOS app today.)
- Without a login lockout and rate limit, an attacker can still go after the password door. Hence phase 1.

### Open questions for Pogi

1. **Web and Android both, or Android first?** The plan treats them as one flow. If most staff use the APK on a shared tablet, Android (phase 3) matters more than web passkeys.
2. **Shared till tablets:** do staff share one device and one lock screen? If yes, should fingerprint be limited to the Owner and Manager roles by default (setting per role), or allowed for everyone with the shop-level on/off only?
3. **Which package name is current for Android,** `app.wtf.pos` or the repo's `com.wtf.pos`? And do any shops run the APK on Huawei devices without Google services?
4. **Final production domain:** passkeys are tied to it. Is `wtfbyfaith` the permanent name?
5. **Plan gating:** keep it in every plan (recommended) or make it a paid plan feature?
6. **Password change behaviour:** should a person changing their own password remove fingerprint devices on all other devices (recommended, safer) but keep the one they are using, or keep every device?
7. **Password lockout:** OK to add a login rate limit and lockout (phase 1) as part of this, or keep that as its own audit task and only protect the biometric endpoints here?
8. **Offline app lock** with fingerprint: wanted now, or later?
9. **Platform admins:** keep password only (as planned), or include them later?
10. **Staff PIN / quick switch:** is that a real upcoming need? If yes, plan it together so the credential table and lockout code are shared.
