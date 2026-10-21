# Authentication plan: email/password, Google, and persistent mobile sessions

Accepted on 2026-10-19 at the user's request. This extends the original
email/password-only MVP. It changes planning and database foundations now;
login endpoints and mobile sign-in are not implemented in Issue #6.

Implementation update (Issue #7, 2026-10-20): backend password/Google login,
challenges, explicit linking, session checks/rotation/revocation and cleanup are
implemented with the prerequisite Issue #8 foundation. Mobile work remains #11.
See [the walkthrough](issue-7-implementation-walkthrough.md) for current routes,
configuration, tests and manual provider setup. Earlier future-tense text records
the accepted plan; this update describes the implemented backend boundary.

## User experience

The sign-in screen offers email/password and Continue with Google. Both lead to
the same PocketLedger account model and session mechanism. Closing/reopening the
app normally restores the session without another login. Logout, revocation,
session expiry, or missing secure credentials require authentication again.
Google cancellation leaves the sign-in screen usable; provider failure does not
disable email/password. Biometric app lock, MFA, password recovery, automatic
account merging, and unlinking login methods remain separate work.

## Database responsibilities

| Model | Meaning and invariant |
| --- | --- |
| `User` | Stable owner of finance data. `passwordHash` is nullable for Google-only users. `emailVerifiedAt` records contact verification when established; `disabledAt` blocks access in the future service. |
| `AuthIdentity` | A Google `sub` linked to one user. `(provider, providerSubject)` is unique globally; `(userId, provider)` permits one Google account per PocketLedger user. No Google passwords or provider access/refresh tokens are stored. |
| `Session` | One device login and refresh-token family. `expiresAt`, `revokedAt`, and `lastUsedAt` support expiry, inactivity, logout, and reuse revocation. |
| `RefreshToken` | One issued PocketLedger refresh token, stored only as a unique SHA-256 hex hash. `consumedAt` preserves rotation history; ownership comes through `sessionId`. |

Password hashes use a slow adaptive password algorithm (planned Argon2id).
Refresh tokens instead have at least 256 bits of cryptographically random entropy,
so SHA-256 hashes support lookup without storing the bearer secret. Do not hash
human passwords with plain SHA-256. SQL can enforce hash syntax and uniqueness,
but cannot prove randomness or that the application actually hashed a secret.

The second migration, `20261019000000_auth_sessions`, relaxes the password field
and adds these tables; it preserves the original finance migration and data.
SQL CHECKs reject blank subjects, malformed token hashes, and expiry before
creation. Foreign keys use RESTRICT. Account cleanup must explicitly delete
tokens, sessions and identities in the correct order, plus owned finance data.

The schema allows a user without any login method (for staged creation or disabled
fixtures). The service must create a user and Google identity atomically, reject
disabled accounts, and never issue a session without proving a valid method.
Database fields do not themselves enforce session expiry, revocation, linking
authorization, or at-least-one-login-method rules.

## Password registration and login — Issue #7

- Normalize email by trimming and lowercasing in every registration/login path;
  use the same normalization for Google account email collisions. Current database
  email uniqueness is exact-string; service normalization is mandatory.
- Validate password strength, hash with a maintained adaptive implementation, and
  rate-limit registration and login. Never store plaintext passwords or log bodies.
- Null, malformed, disabled-fixture hashes and disabled users fail closed with
  generic credential errors. Use equivalent failure handling for unknown users.
- First-party email registration does not assert email ownership: leave
  `emailVerifiedAt` null until a separate verified challenge proves it. Email
  verification/recovery flows and their short-lived challenge storage need their
  own implementation/migration; unverified contact email cannot authorize linking.

## Google login and explicit linking — Issues #7, #11, #16

1. The mobile app starts an explicit native Google sign-in flow. Backend-issued,
   short-lived, single-use challenges bind the result to the initiating login or
   link attempt; Issue #7 implements challenge storage and nonce consumption.
2. The backend verifies the ID token with a maintained Google-compatible library:
   signature/trusted keys, Google issuer, configured audience and authorized
   presenter where applicable, expiry, subject, and expected nonce. Reject a
   missing/mismatched/replayed challenge. Never accept a client-supplied user ID.
3. Resolve the verified `(google, sub)` first. Its owner remains stable even if
   Google changes the email claim; do not silently replace a user's contact email.
4. For a new subject with no existing email collision, create the user and identity
   atomically. Require a usable verified email claim for this MVP onboarding;
   never use that claim alone to authorize access to an existing account.
5. If the email matches an existing PocketLedger account, do not create a session
   for it or silently merge data. Return generic guidance to sign in with an
   existing method, then explicitly link Google in Settings after recent
   reauthentication and fresh Google proof. A subject already owned by another
   user cannot be reassigned. Handle uniqueness races without leaking account data.
6. Successful login issues PocketLedger access/refresh credentials. Google ID
   tokens are not PocketLedger API bearer tokens. Request only identity scopes,
   not Gmail, Drive, banking, or financial-record access.

For Google-only users, an email/password attempt fails generically. Adding a
password, recovery, changing providers, and unlinking are deferred; do not show
nonfunctional controls for them. Existing password users can explicitly link
Google, preserving their existing user ID and finance records.

These are application design choices informed by Google's
[OpenID Connect verification guidance](https://developers.google.com/identity/openid-connect/openid-connect).

## Persistent sessions and rotation — Issues #7 and #11

Initial policy: access tokens last **15 minutes**, sessions have a **30-day absolute
lifetime**, and expire after **7 days without successful refresh**. Keep these
server-configurable; refresh never extends the absolute session lifetime. Token
expiry must not exceed session expiry. `lastUsedAt ?? createdAt` supplies the
inactivity anchor. These defaults are now implemented as server configuration.

Access-token claims include PocketLedger user ID and session ID, issuer, audience,
issued time and expiry. Protected routes validate them and check session ownership,
revocation, expiry/inactivity and user disabled state. That lookup makes logout
and disabling effective immediately rather than waiting for a JWT to expire.

During refresh, in one database transaction: verify the session, atomically mark
an unconsumed token consumed, insert its replacement hash, and update session use.
A concurrent loser or replay of a consumed token revokes that session/family.
Commit the revocation before returning an auth error; throwing inside the same
transaction must not accidentally roll it back. Retain consumed hashes until the
session is no longer usable; a cleanup job deletes expired families in dependency
order. No raw refresh token, authorization header, or Google proof belongs in logs.

The mobile app stores persistent credentials in Expo SecureStore and restores
them before displaying authenticated navigation. API requests share a single
in-flight refresh operation and retry at most once. Never store credentials in
AsyncStorage or ordinary persisted state. Logout revokes the server session and
clears local credentials; Google account sign-out alone is insufficient.

A definitive invalid/revoked response clears the session. A network failure or
provider/API outage preserves credentials and presents a retry state. A lost
refresh response is ambiguous: strict rotation may require sign-in again rather
than blindly replaying the old token. Do not implement an unbounded auto-refresh
loop. Offline logout clears local state immediately and explains that server-side
revocation could not be confirmed; server expiry still bounds the old session.

Rotation/reuse decisions follow [OAuth security best current practice](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14).
The token rows added here make that behavior possible but do not implement it.

## Provider setup and mobile builds

Issue #11 selects a maintained native library compatible with the current Expo
SDK and current Android Credential Manager guidance. Native Google sign-in needs
an Expo development build/config plugin; it cannot be tested in Expo Go. See
[Expo's Google authentication guide](https://docs.expo.dev/guides/google-authentication/).
The current bootstrap remains runnable in Expo Go until native auth is added.

Configure a Google project/consent screen with synthetic test users, Android
package name and signing certificate fingerprints, iOS bundle identifier, and
the backend/web audience as required by the chosen library. Keep development and
release client registrations distinct and document their allowed audiences. Public
OAuth client IDs may be app configuration; client secrets/signing keys may not.
No Google project, credential, dependency, or live provider call is created by
this schema task. Browser OAuth fallback, if introduced, uses PKCE, state, exact
redirect validation and a system browser, never an embedded password webview.

Before iOS distribution, Issue #22 must review Apple's
[Login Services guideline 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services).
Google login generally requires an equivalent login option meeting Apple's
privacy requirements unless an exception applies. Ordinary email/password alone
does not establish that exception. Plan Sign in with Apple or a documented
qualifying alternative before submission; this task does not implement Apple.

## Issue sequence and verification

| Issue | Updated responsibility |
| --- | --- |
| [#6](https://github.com/ShokooBid/PocketLedger/issues/6) | Schema, additive migration, disabled synthetic seeds, fresh/upgrade database tests. |
| #8 | Fastify, validated contracts, redaction, configuration foundation before auth routes. |
| [#7](https://github.com/ShokooBid/PocketLedger/issues/7) | Password and Google backend login, challenge verification, explicit linking, session issuance/rotation/replay detection/revocation. Depends on #6 and #8. |
| [#9](https://github.com/ShokooBid/PocketLedger/issues/9) | Authentication/loading navigation placeholders for both methods. |
| [#11](https://github.com/ShokooBid/PocketLedger/issues/11) | Native Google development build, forms/provider flow, secure session restore, single-flight refresh, bounded retries. |
| [#16](https://github.com/ShokooBid/PocketLedger/issues/16) | Show linked method state, explicit Google linking, current/all-device logout, accurate privacy statements. |
| [#20](https://github.com/ShokooBid/PocketLedger/issues/20) | API tests for proofs, linking collisions, rotation races, expiry/revocation and cross-user sessions. |
| [#21](https://github.com/ShokooBid/PocketLedger/issues/21) | Mobile tests for both methods, cancellation, app restart, offline/invalid sessions and concurrent 401 responses. |
| [#22](https://github.com/ShokooBid/PocketLedger/issues/22) | Physical-device and iOS login-policy review; no claim of production readiness from schema tests. |

Schema tests use only synthetic subjects and token hashes; CI never contacts Google
or needs real credentials. Provider verification is tested with local signed
fixtures/mocked key retrieval; separate manual development-build tests verify the
actual Google setup. Future API tests must prove security behavior beyond database
constraints. The initial finance ownership protections remain required for all
login methods.
