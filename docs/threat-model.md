# Lightweight threat model

## Scope and assumptions

This is the initial threat model for the PocketLedger MVP. It covers the Expo
mobile app, Fastify API, PostgreSQL database, CSV import, logs, and deployment
configuration. It intentionally excludes bank connections, third-party AI
providers, receipt uploads, and voice processing because those features are not
part of the MVP.

Google sign-in is an additional identity-provider trust boundary as of 2026-10-19.
Only identity information crosses it; financial records are not sent to Google.

Protected assets include transaction data, categories, account identity, password
hashes, sessions, refresh tokens, database credentials, and operational logs.

## Threats and mitigations

| Threat | Primary mitigation | Residual risk / verification |
| --- | --- | --- |
| Account takeover through password guessing or credential stuffing | Adaptive password hashing, strength rules, generic login failures, per-account/IP rate limits, short-lived access tokens, refresh-token rotation and revocation | Users may reuse compromised passwords. Test rate limits, generic errors, rotation, expiry, and logout revocation. |
| Forged or replayed Google login proof | Verify signature, issuer, configured audience/authorized presenter, expiry and one-time nonce challenge on the server using a maintained library; use the provider subject as identity | Test wrong client, expiry, signature, nonce reuse, cancellation, unavailable keys, and provider outages. A decoded JWT is not a verified JWT. |
| Account takeover through automatic email linking | Require recent proof of the existing account and fresh Google proof before an explicit link; uniquely constrain provider/subject; never move a linked subject between users | Test matching-email collisions, unverified email claims, concurrent linking, and subjects already attached to another user. Recovery and automatic merging are deferred. |
| Stolen refresh token, replay, or parallel refresh | Store only hashes; consume once in an atomic transaction; retain consumed hashes until session expiry; revoke the session on reuse; mobile single-flight refresh | Test racing refresh requests and lost responses. A connection failure must not erase secure credentials or repeatedly replay a consumed token. |
| Stolen/lost device or leaked mobile token | Store tokens only in OS secure storage; use short-lived access tokens; give users a logout/session-revocation path; never expose tokens in diagnostics | A device compromised at the OS level can access an active session. Keep session lifetime bounded and document the limit. |
| Cross-user data read or write (IDOR) | Derive identity from the authenticated session; scope every database query by owner; validate category ownership server-side; integration-test with two users | An untested new endpoint can regress isolation. Require authorization tests for every resource route and code review of ownership filters. |
| Secret, token, or financial-data leakage through source control, logs, analytics, or errors | Use `.env` files outside version control, `.env.example` without secrets, structured-log redaction, safe error envelope, and no raw request-body/auth-header logging | An operator with production infrastructure access remains privileged. Restrict access and review logs/configuration before release. |
| CSV formula injection, malformed rows, or unintended bulk import | Treat CSV as untrusted; parse with size/row limits; validate schema and row values; render imported text safely; neutralize spreadsheet formula prefixes in exports; preview and explicitly confirm before commit | Supported bank formats vary. Document the format and test dangerous prefixes (`=`, `+`, `-`, `@`) and malformed/oversized files. |
| Network interception or API abuse | Enforce HTTPS in production, use an explicit CORS allowlist, authenticate protected endpoints, validate all input, constrain pagination/date ranges, and rate-limit sensitive routes | A compromised trusted network or client remains possible. Do not claim end-to-end encryption; monitor service errors without storing sensitive payloads. |
| Database loss, corruption, or unsafe migration | Use Prisma migrations, least-privilege database credentials, tested backups/restores before beta, and reversible/verified migration procedures | Backup retention and recovery objectives are not yet set. Define and test them before production deployment. |
| Accidental or malicious transaction changes | Require authenticated writes, validate requests, make destructive UI flows deliberate, retain audit-relevant timestamps, and test duplicate/retry behavior | Full audit history/versioning is deferred. Communicate destructive actions clearly and add deeper audit logging before regulated use. |
| Future AI or tool-driven unauthorized write | Keep AI/MCP out of MVP. Later integrations must use least privilege and create a reviewable draft requiring explicit user confirmation before persistence | Prompt injection and model error are accepted risks only while no AI/tool write path exists. Revisit this model before enabling such a feature. |

## Security requirements carried into implementation

- Never commit credentials, access tokens, database dumps, real CSV statements,
  screenshots containing financial data, or production logs.
- Use only synthetic records in seeds, fixtures, demos, and automated tests.
- Treat all client input, imported CSV cells, and future tool output as untrusted.
- Add tests for authentication failures, authorization boundaries, invalid input,
  CSV edge cases, token revocation, and error redaction as the relevant features
  are implemented.
- Review this document whenever a trust boundary changes, especially before adding
  file/image uploads, bank access, multi-user sharing, AI providers, MCP tools,
  or a production environment.
- Issue #7 implements backend proof verification, linking, server-checked sessions,
  atomic rotation, replay revocation and dependency-ordered cleanup. Tests use
  synthetic identities and local provider keys. Native Google setup, secure mobile
  storage/restoration and device behavior remain Issues #11/#21/#22. Future finance
  routes must still prove owner scoping per endpoint; authentication alone is not
  authorization for a client-supplied resource ID.
- Rate limiting is currently process-local (per IP and normalized password account).
  Deploying multiple API workers requires a shared limiter. Proxy trust defaults
  off; configure trusted ingress deliberately before deploying behind a proxy.
