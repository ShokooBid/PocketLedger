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
- The initial repository will be a TypeScript monorepo with `apps/mobile`,
  `apps/api`, and `packages/shared`. Shared code is limited to portable types,
  validation schemas, and utilities; database access and server secrets never
  enter mobile packages.

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

- Current product endpoints use `/v1`. Redesigned finance uses `/v2`; existing
  authentication/session endpoints and `/v1/me` remain on `/v1`.
- A version change is required for a breaking public-contract change. Additive
  optional fields may remain in the same version.
- JSON uses `camelCase` property names and ISO 8601 strings for timestamps.
- The API publishes OpenAPI documentation generated from the implemented route
  schemas. Hand-written documentation must not be the sole contract source.
- Collection endpoints use explicit, documented pagination and filter parameters;
  they must bound page sizes and date ranges.
- `GET /health` is public and contains no sensitive configuration or dependency
  details.
- Required accounts, merchant-free transactions and logical transfers use the
  explicit [compatibility gate](mobile-redesign/finance-contracts.md#migration-and-compatibility-gate).
  Preserve old v1 responses while active; retire incompatible finance operations
  with a safe upgrade error before new shapes/data are enabled. Do not coerce new
  records into old DTOs using fabricated merchant values.

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
  has code/message/requestId. Planned v2 field `details` is optional, bounded safe
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
- The redesign adds CAD as the initial persisted Settings currency; Add shows one
  currency and no selector. The first committed transaction locks the preference
  atomically. Account creation/opening balances alone do not lock it. Existing
  money is never relabelled on preference changes or legacy backfills.
- Display formatting is a client responsibility using the recorded currency and
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
- Fixed default categories and their subcategories remain user-owned records
  for existing ownership constraints, but user-facing mutations are rejected.
  Personal roots/children are editable; personal children may attach to default
  roots. Select either root or child; enforce exactly two levels.
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
