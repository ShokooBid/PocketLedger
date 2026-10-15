# Architecture and API conventions

## Status

Accepted for the first PocketLedger MVP. These decisions establish constraints for
subsequent implementation issues; implementation may add detail but must not
silently change a decision in this document.

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

- All product endpoints are rooted at `/v1`; for example,
  `/v1/transactions`.
- A version change is required for a breaking public-contract change. Additive
  optional fields may remain in the same version.
- JSON uses `camelCase` property names and ISO 8601 strings for timestamps.
- The API publishes OpenAPI documentation generated from the implemented route
  schemas. Hand-written documentation must not be the sole contract source.
- Collection endpoints use explicit, documented pagination and filter parameters;
  they must bound page sizes and date ranges.
- `GET /health` is public and contains no sensitive configuration or dependency
  details.

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
    "details": [
      { "path": "amountMinor", "message": "Must be a non-zero integer." }
    ],
    "requestId": "01HV..."
  }
}
```

- `code` is a stable, documented machine-readable value. `message` is safe for
  display but must not reveal sensitive account state. `details` is included only
  for safe validation feedback and is omitted for authentication and authorization
  failures.
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
- Display formatting is a client responsibility using the recorded currency and
  the currency's minor-unit exponent. Arithmetic, totals, and persistence use
  integers only.
- Transaction dates are calendar dates (`YYYY-MM-DD`) in the user's intended
  accounting timezone. Audit timestamps such as `createdAt` and `updatedAt` are
  UTC ISO 8601 instants.

## Authentication and sessions

- The MVP uses first-party email/password authentication. Passwords are hashed
  with a modern adaptive password hash; raw passwords are never stored or logged.
- Access tokens are short-lived. Refresh tokens are stored server-side only as
  hashes, rotated on use, revocable on logout, and treated as credentials.
- Mobile tokens live only in platform-secure storage, never ordinary async/local
  storage, source control, analytics payloads, screenshots, or logs.
- Authentication endpoints are rate-limited and return generic credential errors
  that do not reveal whether an account exists.

## AI and automation boundary

AI is outside the MVP. If added later, any model- or tool-derived category,
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
