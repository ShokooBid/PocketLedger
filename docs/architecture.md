# Architecture and API conventions

## Status

Accepted for the first PocketLedger MVP. These decisions establish constraints for
subsequent implementation issues; implementation may add detail but must not
silently change a decision in this document.

Amended on 2026-10-30 by [Issue #64's decision record](mobile-redesign/README.md),
[UX specification](mobile-redesign/ux.md) and
[finance contracts](mobile-redesign/finance-contracts.md). These define the next
implementation target; #64 itself changes no routes, Prisma models or screens.

## System shape

PocketLedger is a client-server application with a single primary data owner per
account:

```text
Expo mobile app  ── HTTPS/JSON ──>  Fastify REST API  ──>  PostgreSQL
       │                                 │
       └─ secure device token storage     └─ Prisma, Zod, OpenAPI
```

- The mobile app is React Native + Expo + TypeScript.
- The API is Node.js + Fastify + TypeScript.
- PostgreSQL is the system of record; Prisma owns database access and migrations.
- Zod schemas validate API inputs and define the published request/response
  contracts used to generate OpenAPI documentation.
- The TypeScript monorepo contains `apps/mobile` and `apps/api`. Portable client
  contracts stay independent of Prisma/server modules. The unused shared-workspace
  placeholder has been removed until real reuse justifies it.

## Data ownership and trust boundaries

- Every persisted finance record belongs to exactly one authenticated user.
- The API determines the current user from the authenticated session; it never
  trusts a `userId` supplied by a mobile client to select data.
- Authorization is enforced server-side on every read and write. Client-side
  filtering or hidden UI is never an authorization control.
- The app communicates with the API only over HTTPS in production. Secrets,
  database credentials, password hashes, refresh tokens, and provider keys remain
  on the server and are never bundled with the mobile app.

## REST and versioning

- Current endpoints all use `/v1`, including account-aware finance. The pre-release
  cleanup replaced the old finance contract and retired `/v2` plus rollout flags.
  Deploy the matching API and mobile client together; clean databases apply the
  committed migration history directly. The retired finance backfill CLI is removed.
- Future breaking changes to a released public contract require a new version.
- JSON uses `camelCase` property names and ISO 8601 strings for timestamps.
- The API publishes OpenAPI documentation generated from the implemented route
  schemas. Hand-written documentation must not be the sole contract source.
- Collection endpoints use explicit, documented pagination and filter parameters;
  they must bound page sizes and date ranges.
- `GET /health` is public and contains no sensitive configuration or dependency
  details.
- Required accounts and merchant-free transactions use the canonical `/v1`
  contract. Transfers remain future work. See the current
  [deployment contract](mobile-redesign/finance-contracts.md#migration-and-deployment).

## Request validation and error responses

- Validate request path parameters, query parameters, headers, and bodies before
  application logic runs. Reject unknown or malformed fields where a route schema
  requires it.
- Domain rules are validated in addition to shape validation. For example, a
  transaction category must belong to the authenticated user.
- Do not expose stack traces, SQL errors, provider responses, credentials, or
  internal implementation details to clients.
- Every response to a failed API request uses this stable envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "requestId": "01HV..."
  }
}
```

- `code` is a stable, documented machine-readable value. `message` is safe for
  display but must not reveal sensitive account state. The current v1 envelope
  has code/message/requestId. A future field `details` is optional, bounded safe
  validation feedback and is omitted for authentication/authorization failures.
- Each request receives a request ID. The API returns it in the response header
  and error envelope, and structured server logs include it after redaction.
- Use status codes consistently: `400` malformed request, `401` unauthenticated,
  `403` authenticated but forbidden, `404` unavailable resource, `409` conflict,
  `422` valid JSON that fails a business or field rule, `429` rate limited, and
  `5xx` unexpected server failure.

## Money, currencies, and dates

- Monetary amounts are signed or directed **integer minor units**. The public API
  never accepts a floating-point monetary amount.
- `amountMinor` is a non-zero integer. Transaction direction is explicit
  (`income` or `expense`), so reporting does not infer meaning from a sign.
- Currency is a three-letter ISO 4217 code, stored as uppercase. The MVP uses one
  currency per transaction and does not perform currency conversion.
- Issue #93 requires explicit permanent currency selection after sign-in. The
  nullable preference has no database default; CAD is only the UI suggestion.
  Confirmation is write-once under the owner lock and database trigger, with
  identical retries allowed. Settings is read-only; no first-posting lock exists.
- Main finance routes require chosen currency and at least one active account.
  Derived readiness is refreshed on route entry, foreground and mutations.
  Setup/Settings/sign-out remain accessible, and account repair preserves drafts.
- #94 removes Transaction.currency in favor of immutable Account.currency.
  Owner-safe composite account references enforce ownership; service and SQL
  guards reject cross-currency reassignment without changing integer amounts.
  Transaction writes omit currency; reads and reports derive/filter it by account.
  Account.legacyCurrency and the finance backfill CLI are retired.
  #95 replaces TransactionCreation with immutable nullable request ID/fingerprint
  fields on Transaction, unique by owner/request UUID. Manual creation requires
  both; SQL checks pair consistency and guards mutation, including NULL pairs.
  The server hashes canonical original intent and serializes creates with the
  owner lock. Replay returns current data without undoing edits. Hard deletion
  releases the key; a late retry may recreate the row. #96 now shares the approved
  default catalog; no per-user provisioning remains. No account-save idempotency infrastructure is introduced.
- Display formatting is a client responsibility using the related account currency and
  the currency's minor-unit exponent. Arithmetic, totals, and persistence use
  integers only.
- Transaction dates are calendar dates (`YYYY-MM-DD`) in the user's intended
  accounting timezone. Audit timestamps such as `createdAt` and `updatedAt` are
  UTC ISO 8601 instants.

## Finance and mobile boundaries

- Add transaction becomes the normal post-login home; History, Overview and
  Settings are persistent destinations. Category/account pickers return to the
  session-owned draft. Session restoration/authorization still precede finance UI.
- The custom amount keypad has digits, decimal, backspace and confirm, with no
  arithmetic. Confirm validates all fields and saves through one guarded submit.
- Merchant/payee/payer fields are removed from redesigned input/DTOs; one optional
  note remains. Preserve legacy merchant storage and all historical associations.
- Category uses one table: null userId plus stable catalog key means a shared
  immutable default; non-null owner and null key means personal. isDefault is
  retained with a SQL consistency CHECK and derived from ownership in responses.
  Category and parent references use IDs plus shared-or-owned API/SQL validation.
  Personal children may use shared roots or their own personal roots; shared
  children require shared roots. Enforce exactly two levels and active ancestors.
  Visible active sibling names conflict across shared/current-user scopes, while
  different users may reuse personal names. Shared roots/default keys have
  explicit uniqueness despite NULL ownership. Signup/login/link create no copies.
- Run categories:init after migrations and before traffic. The repeatable
  initializer uses permanent manifest IDs/keys and rejects drift or collisions;
  shared catalog edits are deliberate deployment changes. Synthetic seeds remain
  separate. Historical data backfill/reconciliation is removed. Demo imports the
  framework-free manifest and isolates all mutable data/recents by session.
  Every report/recency query continues filtering transactions by current user.
- Financial accounts are manually named, owned ledgers managed in Settings.
  Opening balance is optional/default zero; balance reads use exact persisted
  postings. A name such as BMO does not create a bank integration.
- A same-currency transfer is one aggregate with two balanced postings committed
  atomically. Logical history shows it once. Income/expense/category summaries
  exclude its legs; account balances include them. Opening balances are not income.
- Keep business validation/save coordination separate from rendering, history
  paging and persistence. Extend existing source adapters/session providers rather
  than replace authentication or introduce a generic form/AI framework.

## Authentication and sessions

- The MVP supports both first-party email/password and Google sign-in. This
  decision was expanded on 2026-10-19. Both methods establish PocketLedger-owned
  sessions and resolve to the same stable user ID; finance ownership is unchanged.
- Passwords use a modern adaptive hash (planned: Argon2id). A Google-only user
  has a null password hash. Null, malformed, or disabled credentials fail closed.
- Google identity is identified by verified provider plus subject, never email
  alone. The server validates the provider proof and login challenge. Linking
  requires recent proof of the existing account and the new Google identity;
  matching email addresses never automatically link or merge accounts.
- Access tokens are short-lived. A session is a per-device revocation boundary.
  Random refresh tokens are stored server-side only as hashes. Rotation consumes
  the old record atomically and retains its hash for replay detection; reuse
  revokes that session. Closing the app does not end the session.
- Mobile tokens live only in platform-secure storage, never ordinary async/local
  storage, source control, analytics payloads, screenshots, or logs.
- Authentication endpoints are rate-limited and return generic credential errors
  that do not reveal whether an account exists.
- The backend implements password/Google proofs, explicit linking, server-checked
  access, refresh rotation and revocation. Google challenges are persisted and
  consumed once. Mobile secure restoration remains Issue #11.
- See [Authentication plan](authentication-plan.md) for session lifetimes,
  provider setup, linking rules, implementation order, and release requirements.

## AI and automation boundary

Functional AI remains a later increment. Inert entry points are in the redesign;
later CSV/PDF statement processing binds drafts to a selected owned account.
Upload/extraction never posts transactions. If added later, any model- or tool-derived category,
transaction, receipt extraction, voice interpretation, or insight is a draft.
It may be displayed with its source and limitations, but it must require an
explicit user confirmation before it is persisted or causes a state-changing
action. An AI tool is not authorized merely because it can request an API action.

## Consequences

This approach makes the first implementation intentionally conventional: a
single API and database, a mobile client, explicit contracts, and server-enforced
ownership. It avoids early complexity from offline conflict resolution, bank
aggregation, multi-user ledgers, and autonomous AI actions while preserving clear
extension points for later work.
