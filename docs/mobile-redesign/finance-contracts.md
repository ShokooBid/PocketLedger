# Finance contracts and compatibility

Issue [#64](https://github.com/ShokooBid/PocketLedger/issues/64). This is the
engineering specification for follow-up implementation, not an assertion that
these endpoints or migrations exist. Read the [decisions](README.md) and
[UX specification](ux.md) first. Currency locks on the first committed transaction;
keypad confirm validates and saves the complete transaction.

## Version boundary

Authentication/session endpoints remain `/v1/auth/*` and `/v1/me`, with their
existing token ownership, refresh and logout behavior. Redesigned finance uses
`/v2` for preferences, accounts, categories, transactions, transfers, history,
dashboard and later statement batches. Do not modify the meaning of a deployed
`/v1` DTO to carry new required accounts, missing merchants or transfer records.

New normal-transaction requests and responses omit `merchant`, `payee` and `payer`.
The single optional description is `note`. Old stored merchant values remain
untouched; new records need storage that permits merchant absence. Do not supply
an empty/synthetic merchant to make old validation pass, move old merchant values
into notes automatically, or drop old columns/data in the expansion migration.

Implemented routes must use Zod validation/serialization and generate OpenAPI
from those schemas. These contract tables and valid JSON examples guide that
implementation; they do not replace generated OpenAPI or justify bypassing it.

## Common rules

- Derive `userId` from the verified session. Never accept client ownership,
  immutable catalog identity, `isDefault`, import provenance or transfer-leg flags
  as ordinary transaction/category mutation fields.
- IDs are UUIDs. Reject unknown request keys. Foreign and missing resource IDs
  both return 404. Owned but unusable resources produce safe validation/conflict
  errors; no database exceptions or foreign record details leave the API.
- Normal amounts are integers from 1 through 2147483647 minor units, with separate
  income/expense direction. Opening balances are signed integer minor units within
  the corresponding bounded range, defaulting to zero. No floating-point money,
  rounding, implicit conversion, negative normal amount or arithmetic expression
  is accepted.
- Preserve the existing allowlist and add CAD: CAD/USD/EUR/GBP/INR have exponent 2,
  JPY 0 and KWD 3. Selection happens in Settings; recorded account/posting currency
  remains uppercase and must agree. No FX endpoints exist.
- Dates are actual calendar dates `0001-01-01` through `9999-12-31`; audit fields
  are UTC ISO instants. Store a date as PostgreSQL `date`, not a local midnight
  instant. Account postings must not predate the opening date.
- Preserve category normalization: collapse/trim ASCII whitespace, then 1-100
  UTF-16 units; raw input bound 1000. Compare normalized active sibling names with
  the established ASCII case-folding rule, independent of DB locale. Account names
  use the same visible-name limits/rule within one owner.
- Notes are null or at most 2000 UTF-16 units; empty UI input becomes null. Reject
  control/format/surrogate text as current transaction validation does. Category/
  account names must contain visible text. Never log notes or statement contents.
- Audit fields and balances are server-owned. Account balances and summary totals
  use exact DB aggregation; serialize only safe integers. Out-of-range totals
  return 422 rather than rounding. Never combine unlike currencies.

## Planned resources

| Resource           | Required response fields, in addition to ID/audit timestamps                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preferences        | `entryCurrency`, `currencyLocked`, nullable `defaultAccountId`. Lock status is server-derived, not editable by the client.                                                               |
| Category           | `name`, nullable `parentId`, `isDefault`, nullable `defaultKey`, `iconKey`, `colorKey`, `sortOrder`, nullable `archivedAt`. Default identity and metadata are not user-writable.         |
| Account            | `name`, `type` (`cash`, `bank`, `credit`, `other`), `currency`, `openingBalanceMinor`, `openingDate`, nullable `archivedAt`. Balance reads add `asOf` and `balanceMinor`.                |
| Normal transaction | `accountId`, `categoryId`, `direction` (`income` or `expense`), `amountMinor`, `currency`, `date`, nullable `note`, nullable `importId`. No merchant field or public transfer-leg shape. |
| Transfer           | `fromAccountId`, `toAccountId`, `amountMinor`, `currency`, `date`, nullable `note`. Its two internal postings are not independent editable normal transactions.                          |
| Later import batch | `accountId`, `sourceKind` (`csv` or `pdf`), lifecycle state, nullable confirmation metadata and bounded draft-item pages. No posting occurs during extraction.                           |

`isDefault` means fixed catalog origin, not the currently selected category.
Keep every finance record owned by one user. Prefer composite foreign keys for
category/account/import ownership and account/posting currency consistency, plus
transactional guards for cross-row invariants. A row CHECK alone cannot enforce
active ancestors or exactly two balanced transfer legs.

### Preferences and currency lock

`GET /v2/preferences` returns the server's persisted entry currency, lock state
and current default account. An absent preference initializes to CAD for a fresh
user. `PATCH /v2/preferences` accepts a nonempty partial object containing
`entryCurrency` and/or nullable `defaultAccountId`. A default must be owned, active
and match the resulting configured currency.

Changing to a different currency after the lock returns
`409 CURRENCY_LOCKED`; submitting the same currency is an idempotent no-op.
Never use client disabled-state as the lock enforcement. Serialize the change
with the confirmed first-lock event under a user/preference row lock so concurrent
posting cannot race a preference update. No implicit unlock or ledger-reset
operation is introduced in this redesign.

The first committed normal transaction, transfer's paired postings or confirmed
import posting sets a persisted currency lock in the same DB transaction as the
write. Account creation (including a nonzero opening balance), categories,
unsaved drafts and extraction alone do not lock it. Failed validation/rolled-back
writes do not leave a lock behind. Keep the lock after a posting is later deleted;
there is no new reset/unlock operation. Test posting-vs-preference races for all
posting paths, not just manual entry.

Before the lock, a changed preference never changes existing account currencies
or opening balances. Clear an incompatible default. New postings must match both
their selected account and current configured currency; accounts left in another
currency stay readable but cannot receive new postings in this single-currency
entry flow. Editing an existing historical record retains its recorded currency
and validates compatible associations without redenominating it.

Keep explicit legacy preferences/currencies rather than converting existing USD
or other records to CAD. If old data does not unambiguously establish a ledger
currency, flag it for the owner's explicit migration choice. Do not manufacture
an exchange rate or silently relabel a multi-currency history. Old currencies
remain visible for read/reporting and cannot be summed together.

### Category endpoints and immutable defaults

| Operation                         | Contract                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v2/categories`              | Bounded `status=active                                                                                                                                             | archived | all`, optional root `parentId`, optional search `q`; returns flat rows with parent IDs and a cursor. Fetch roots/children deliberately; do not imply a partial page is the whole tree. |
| `GET /v2/categories/:id`          | Owned lookup including archived historical categories.                                                                                                             |
| `GET /v2/categories/recent`       | Active owned selections ordered by most recently saved transaction, bounded `limit` 1-20 (default 8), with valid parent paths.                                     |
| `POST /v2/categories`             | `name`, optional `parentId` (omitted/null means root), optional valid presentation keys/order. Always creates a personal category; 201 returns the created row/ID. |
| `PATCH /v2/categories/:id`        | Nonempty personal-category name/presentation patch; no parent/default-identity changes.                                                                            |
| `POST /v2/categories/:id/archive` | Empty JSON object; archives an owned personal root and its active personal children atomically, or one personal child. Returns the resulting resource.             |

Exactly two levels: a child's parent is an active owned root, which may be fixed
default or personal. Select either root or child for a normal transaction.
Normalized active uniqueness is per owner/root namespace or owner/sibling group.
Parent plus owner references prevent a cross-user tree; guards prevent cycles,
deeper nesting and assignment under an archived ancestor.

User-facing rename/archive/reparent/presentation mutation of an owned default
returns `409 DEFAULT_CATEGORY_READ_ONLY`. Creating a personal child underneath it
is explicitly permitted. Enforce this in services/database access paths, not only
by hiding buttons. Personal archival preserves past transactions. An unchanged
historical category may remain on an edited record; a changed assignment requires
an active category and active ancestor. Do not reparent used categories or silently
merge a personal category with a catalog name collision.

Provision stable-key, fixed per-user catalog records atomically at password/Google
user creation. Login/linking/reruns must not duplicate them. #67 waits for the
actual user-supplied values; it must report backfill conflicts and preserve any
already archived legacy records rather than resurrecting history. Future catalog
retirement/version policy is separate from users editing fixed defaults.

### Account endpoints

`GET /v2/accounts` is paginated and filters active/archived/all accounts.
`GET /v2/accounts/:id` includes opening information and current tracked balance;
an explicit `asOf` date is supported for balance reads.

`POST /v2/accounts` accepts `name`, `type`, `currency`, `openingDate` and optional
`openingBalanceMinor` (default 0). The form copies currency from Settings; the
server checks it against the locked/current preference in the same transaction.
This field is an assertion against stale UI, not a second currency-selection
feature. A stale incompatible preference returns `409 PREFERENCE_CHANGED`.

`PATCH /v2/accounts/:id` permits a nonempty name/type patch. Currency/opening
information must not change incompatibly after postings exist; any future
opening-balance correction flow must be explicitly designed rather than silently
changing a historical baseline. `POST /v2/accounts/:id/archive` takes `{}` and is
idempotent. Do not hard-delete referenced accounts. Clear an archived default.

Balance as of D = opening balance at the start of the opening date + income
postings through D - expense postings through D, including transfer legs. Return
an error for a date before account opening. Opening balance is not a normal income
posting. Do not store a mutable cached balance initially or reject an ordinary
transaction simply because its tracked balance would become negative.

### Normal transactions and creation identity

`GET /v2/transactions` returns only normal transactions, with bounded pagination
and date/account/category/direction filters. `GET /v2/transactions/:id` returns one
normal record. Use the logical history endpoint for a combined transfer feed.

`POST /v2/transactions` accepts the normal input fields plus a required UUID
`clientRequestId`. A synthetic create request is:

```json
{
  "clientRequestId": "10000000-0000-4000-8000-000000000001",
  "accountId": "20000000-0000-4000-8000-000000000001",
  "categoryId": "30000000-0000-4000-8000-000000000002",
  "direction": "expense",
  "amountMinor": 1250,
  "currency": "CAD",
  "date": "2026-10-30",
  "note": "Weekly groceries"
}
```

`note` may be omitted/null; the response always includes null or its text.
For the create example above, the 201 response has this merchant-free shape:

```json
{
  "id": "40000000-0000-4000-8000-000000000001",
  "accountId": "20000000-0000-4000-8000-000000000001",
  "categoryId": "30000000-0000-4000-8000-000000000002",
  "direction": "expense",
  "amountMinor": 1250,
  "currency": "CAD",
  "date": "2026-10-30",
  "note": "Weekly groceries",
  "importId": null,
  "createdAt": "2026-10-30T12:00:00.000Z",
  "updatedAt": "2026-10-30T12:00:00.000Z"
}
```

`accountId`, `categoryId`, direction, amount, currency and date are required. New
assignments require active owned account/category/ancestor; currency matches the
account and configured entry currency. `PATCH /v2/transactions/:id` accepts a
nonempty partial normal input,
including nullable note; immutable IDs/provenance/client creation identity cannot
be patched. A normal record's currency cannot be changed to reinterpret its
amount; use the recorded currency when editing history. `DELETE` returns
`{ "ok": true }` on confirmed deletion. Preserve
the established unchanged-archived-association edit exception; changed accounts
or categories must be eligible, and all date/currency invariants still apply.

Create idempotency is owner-scoped by operation and `clientRequestId`, with a
normalized payload fingerprint. First create returns 201. An explicit retry with
the same operation/key/payload returns the same created resource ID (200) without
another posting. Changed payload under that key returns
`409 IDEMPOTENCY_KEY_REUSED`. Keep a completion reference after deletion so a
delayed retry returns `409 OPERATION_ALREADY_APPLIED` instead of recreating data.
Keys are not authentication and never authorize another owner.

The UI retains its original key/payload during uncertainty and explicitly checks/
reconciles before starting another create. Updates/deletes refresh the identified
resource after a lost response; they do not switch to a new create. This is a
planned extension of the current no-blind-retry behavior, not a claim that current
POST requests are idempotent. Body identity avoids adding an unplanned custom
header to the current transport/CORS allowlist.

### Transfers

`POST /v2/transfers` accepts `clientRequestId`, `fromAccountId`, `toAccountId`,
positive `amountMinor`, `currency`, `date` and nullable/omittable `note`.
`GET /v2/transfers/:id`, a nonempty partial `PATCH` and whole-transfer `DELETE`
operate on the aggregate. Reuse the create-identity rules above.

```json
{
  "clientRequestId": "10000000-0000-4000-8000-000000000002",
  "fromAccountId": "20000000-0000-4000-8000-000000000001",
  "toAccountId": "20000000-0000-4000-8000-000000000002",
  "amountMinor": 2500,
  "currency": "CAD",
  "date": "2026-10-30",
  "note": null
}
```

Require different owned active accounts in the same configured currency. Persist the
aggregate and exactly two linked equal/date/currency/owner-matched postings:
expense from source and income to destination. Category is null only for internal
transfer legs. Normal transaction endpoints reject transfer-leg IDs; they never
create/edit/delete a leg independently. Lock affected rows consistently, validate
constraints at commit and roll back both sides on failure. Historical unchanged
account associations can be retained on edit under the same rule as normal
records; newly assigned accounts must be active. No transfer fee/FX machinery is
included.

### Logical history and reporting

`GET /v2/history` returns `{ items, nextCursor }`. Each item has `kind` equal to
`transaction` or `transfer` and its public resource fields. Normal posting legs
of transfers never appear as extra normal records. Filter with `accountId`,
`currency`, exact `categoryId`, explicit `includeSubcategories`, `kind` and
`direction`; filters combine with AND. Category/direction filters exclude transfers,
which have neither a business category nor one logical income/expense direction.

Sort by date descending, kind ascending, UUID descending; use an opaque URL-safe
cursor encoding all three keys and bind it to the query filters. Default limit 50,
range 1-100. Optional `from`/`to` must appear together, be inclusive/ordered and at
most 366 days apart. Paging is live, not a financial snapshot. Account-specific
views can show the matching transfer side labelled as a transfer; global history
still shows one aggregate. Preserve existing refresh/reconciliation safeguards.

`GET /v2/dashboard/summary` requires from/to and one currency, with optional
compatible account filter and `recentLimit` 1-20 (default 5). Return incomeMinor,
expensesMinor and netMinor from normal posted transactions only. Include logical
recent history, exact-category totals and separate root rollups. Root totals
include both direct-root and child postings once; do not sum exact totals and
their root rollups together. Archived categories remain in historical breakdowns.
Use one DB snapshot for related totals/recent reads. Demo must match these rules.

Invariant example: account A opens at 10000 CAD minor units, B at zero. A normal
expense of 1250 and transfer A -> B of 2500 produce A = 6250, B = 2500, period
income = 0, expenses = 1250 and net = -1250. Transfers/opening balances never add
income or expenses. Existing historical currencies get separate reports.

### Later statement contracts

#78 defines `/v2/imports` batches with an owned `accountId` selected before upload,
source kind CSV/PDF, draft items and a review lifecycle. Account changes invalidate
validation; confirmed batches cannot be silently reassigned. Ordinary transaction
requests cannot forge `importId`. Batch confirmation owns that association.

Upload/extraction returns drafts, never posted rows. Draft fields may be missing
and carry bounded row/page errors/provenance; normal transaction schemas do not
accept missing required fields merely because they came from a parser/model.
Confirmation revalidates the selected account, category, currency, date, duplicates
and selected rows, then commits atomically/idempotently using `clientRequestId`.
Failed validation writes nothing. Separate confirmed import history from ongoing
processing. Account/currency mismatch blocks posting; no inferred FX/account switch.

Statement source descriptions can be reviewed as the single optional note; no
new merchant/payee fields are introduced. Summary/opening/closing balance lines
are not transactions. Potential transfer matches require user resolution and
must not duplicate known legs from another statement. CSV format/mapping/limits
are #79 with existing #17-#19; PDF layouts/OCR/storage/retention are #80. No upload
provider or retention duration is chosen by this specification. Define those
before enabling uploads; text AI/receipt/voice execution is separate later work.

## Errors and client recovery

Keep the existing envelope `{ error: { code, message, requestId } }`; v2 may add
bounded field `details` with safe paths/codes/messages for validation, without raw
input. Preserve current v1 shape. Planned domain errors include:

| Status/code                                                      | Meaning and recovery                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 401 `INVALID_CREDENTIALS`                                        | Preserve established verified-session renewal/sign-in behavior; never blindly replay a new financial create. |
| 404 `NOT_FOUND`                                                  | Missing or foreign ID; no ownership disclosure.                                                              |
| 409 `DEFAULT_CATEGORY_READ_ONLY`                                 | Personal additions are allowed; the fixed default itself cannot be changed.                                  |
| 409 `CATEGORY_NAME_CONFLICT` / `ACCOUNT_NAME_CONFLICT`           | Correct a duplicate active name; preserve input.                                                             |
| 409 `CURRENCY_LOCKED`                                            | Settings cannot change a ledger's recorded denomination after the confirmed event.                           |
| 409 `PREFERENCE_CHANGED`                                         | Reload Settings/account creation context; do not reinterpret an entered balance.                             |
| 409 `IDEMPOTENCY_KEY_REUSED` / `OPERATION_ALREADY_APPLIED`       | Reconcile the existing operation; do not generate another key to force a retry.                              |
| 409 `FINANCE_UPGRADE_REQUIRED`                                   | Use the supported finance client before proceeding. Authentication is not revoked by an upgrade gate.        |
| 422 `INVALID_ACCOUNT` / `INVALID_CATEGORY` / `CURRENCY_MISMATCH` | Correct current owned selection/values; an archived ancestor is not a new-assignment target.                 |
| 422 `SUMMARY_AMOUNT_OUT_OF_RANGE`                                | Narrow the report period; never round a total.                                                               |
| 429 / 5xx / network uncertainty                                  | Preserve input and pending operation identity; distinguish retryable reads from uncertain writes.            |

## Migration and compatibility gate

1. Expand schema additively: category parents/catalog keys, preferences/accounts,
   nullable transaction account linkage and merchant absence support; transfer and
   draft tables arrive only in their owning issues. Preserve auth, IDs, amounts,
   currencies, merchant values, notes, category/import links and audit timestamps.
2. Prepare v2 schemas/services and a bridge mobile client that understands both
   finance versions plus safe upgrade errors. Current transport permits only
   `/v1` paths and two category error codes; #69 must explicitly extend validated
   paths/error mapping without weakening origin/auth/redaction safeguards.
   Develop #65-#71 primitives behind the inactive v2 rollout gate; do not enable
   the new CAD entry/preferences flow or expose fixed catalog copies to writable
   old-category routes before the compatible client/backend is ready.
3. While legacy v1 finance is active, do not expose merchant-free writes, required
   account payloads, hierarchy/default mutations or transfer shapes through v1.
   Keep its currently required merchant/category responses intact. Do not hide
   normal records or invent placeholder merchant values for compatibility.
4. Establish the supported-client upgrade gate before enabling incompatible data.
   Retire authenticated v1 finance operations with 409 FINANCE_UPGRADE_REQUIRED;
   auth/me remain on v1. Drain/serialize in-flight legacy writes before the backfill
   so an old request cannot race past account/lock assignment. Do not trust a
   client version header as the integrity boundary.
5. Backfill one clearly labelled Unassigned account per existing user/currency,
   with zero opening baseline and date no later than the earliest posting. Never
   guess BMO/CIBC from old rows, convert values or assign all history to CAD.
   Report unresolved currency/catalog conflicts for explicit owner resolution.
   Existing rows become roots; catalog provisioning is collision-safe/rerunnable.
6. Verify owned references, counts and per-currency totals, then enforce required
   account/conditional-category constraints. Apply the confirmed currency lock
   to existing financial records. New accounts inherit Settings currency.
7. Enable v2 entry and immutable hierarchy, then transfers only when all exposed
   reports/history exclude their legs. Keep CSV/PDF/AI processing disabled until
   their independent review/confirmation and data-handling acceptance checks pass.
8. Roll back presentation/features only to clients/backends that understand the
   migrated data. Once merchant-free transactions/transfer legs exist, the old
   mandatory-merchant client/schema is not a valid rollback target. Recover by a
   compatible release/roll-forward; never delete new finance rows to undo rollout.

Require clean and upgrade migration rehearsal on disposable PostgreSQL, plus
API/mobile contract integration and demo parity before release. No reset against
the user's development database, destructive column cleanup or runtime migration
is authorized by this documentation-only issue.
