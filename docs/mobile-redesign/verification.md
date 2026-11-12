# Issue #64 verification and handoff

## Issue #75 live History implementation

The live API now supplies one logical `/v1/history` feed, inclusive combined
filters, bidirectional date/UUID/kind cursors, bounded full-day aggregates and a
saved-ID focus handoff. The mobile route renders date sections/category icons;
Settings links account statements and Overview shows parent/exact breakdowns.
History reloads on focus and confirmed finance changes. #106 still owns automatic
post-save navigation and shared-editor Add/Edit state.

Owner constraints: no tests executed; no demo implementation changes; no schema
changes, database resets, migration application, staging, commits, pushes or PR.
API/mobile unit and disposable-database integration regressions were added for
the owner to run. Native layout, accessibility and performance acceptance remain
for device verification/#77. The personal learning walkthrough lives under
`local-docs/` and is not published with the repository.

Static checks passed: focused Prettier formatting, API/mobile ESLint, API
`npm run typecheck`, direct mobile `tsc --noEmit`, generated OpenAPI (including
`/v1/history` and the Overview root breakdown), and `git diff --check`.
No tests were executed. The mobile npm typecheck wrapper stalled at Expo config
generation, including an offline retry, and was stopped; the TypeScript compiler
was run directly and passed. OpenAPI generation initially hit sandbox `spawn
EPERM`; the approved retry passed without a database connection. SQL execution,
native layout/accessibility and large-ledger performance remain unverified.

---

This is the historical #64 verification record. Current implementation decisions
are in [the finance foundation revision](README.md#finance-foundation-revision-2026-11-06).
#93 replaces the first-posting lock; #94 derives currency from accounts and retires
finance backfills. #95 stores lifetime-only creation identity on Transaction.
#96 shares approved defaults and removes signup provisioning. On 2026-11-06,
the agent ran `npm run test` at your request and fixed the stale demo Categories
empty-list assertion: all 45 API and 200 mobile unit tests passed. Integration
tests have not been run by the agent.

Date: 2026-10-30. Scope: accepted product decisions, UX states, planned finance
contracts and updates to architecture/scope/threat-model documents. No runtime
source, database schema, migrations, dependencies or generated OpenAPI were changed.

## Source review

| Current source                                                                              | Finding and resulting specification requirement                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/prisma/schema.prisma`                                                             | Flat owned categories; no financial Account/Transfer model; merchant is non-null; Import is metadata-only. Use additive migrations and preserve all existing finance/ownership links.                      |
| `apps/api/src/transactions/contracts.ts`                                                    | Required visible merchant, integer minor-unit amounts, calendar dates and currency allowlist without CAD. Preserve money/date semantics while versioning merchant-free/account-aware input and adding CAD. |
| `apps/api/src/categories/contracts.ts` and category service/migration                       | Name normalization and owner-wide active uniqueness; archive/history protections. Extend to sibling uniqueness, exactly two levels and immutable defaults with personal children.                          |
| `apps/api/src/dashboard/contracts.ts` and service                                           | Every posting currently contributes to category totals; response contains v1 transaction DTOs. Add logical history/root rollups and transfer exclusions together.                                          |
| `apps/mobile/src/auth/transport.ts`                                                         | Paths are restricted to v1 and only two category domain codes are preserved. #69 must deliberately add v2 and safe finance/upgrade error mapping.                                                          |
| `apps/api/src/auth/routes.ts` and `app.ts`                                                  | Current error envelope is code/message/requestId; CORS only allows authorization/content-type. Keep v1 stable; body-based request identity avoids an unnecessary new header.                               |
| `apps/mobile/src/preferences.tsx`                                                           | Default currency is session-local USD. #65 must persist CAD, load before drafts and enforce the first-transaction lock server-side.                                                                        |
| App layouts/index/transactions routes and `ui.tsx`                                          | Current root is Dashboard; back is hard-coded there; add query carries explicit date/currency. #72 must change home/navigation without silently rewriting linked dates or currencies.                      |
| Transaction/category data adapters, management UI, history helpers and representative tests | Existing exact parsing, session isolation, archive/history behavior, paging and uncertain-write safeguards are reusable; keep their responsibilities separate from new rendering.                          |

The user explicitly resolved merchant removal, fixed defaults, personal children
under default/personal roots, parent-or-child selection, optional note, custom
numeric-only keypad, confirm-to-save, optional opening balance/default zero and
currency lock on the first saved transaction. No unresolved product choice from
the #64 question rounds is replaced with an engineer-selected alternative.

## Checks

- Focused Prettier write/check for the specification Markdown passed. At the time,
  only the accepted specification folder was exposed by the Git/Prettier exceptions.
  The current policy publishes `docs/` and ignores personal notes in `local-docs/`.
- A one-off documentation check validated local file/heading links, paired code
  fences and JSON examples across the specification and amended documents. It
  also checked that create/response examples agree, omit merchant/payee/payer and
  use integer money, and that the documented transfer/account balance arithmetic
  is consistent.
- Reviewed changed architecture/scope/threat-model text for stale transfer
  exclusions, required merchant assumptions, editable defaults, native-keyboard
  plans and a currency lock triggered by account creation.
- `git diff --check` passed. Existing uncommitted mobile styling/README edits are
  outside this issue and were preserved.
- Application tests, ESLint, TypeScript, Prisma migrations, Expo exports and
  device tests were not run: #64 changes documentation/ignore patterns only.
  There is no implemented v2 service or redesigned screen to validate with those
  checks yet. Follow-up issues require their relevant executable checks.

## Completion boundary

Acceptance traceability is in the [decision record](README.md#verification-and-completion-evidence).
The documents are ready for review but are not a merged runtime implementation.
No commit, push, PR, issue comment or GitHub issue closure was performed as part
of this local specification work. In particular, #64 remains open pending the
normal review/commit workflow.

Default category values remain the user's later input to #67; they do not block
this design specification. CSV/PDF provider/layout/retention choices belong to
#78-#80. Functional text AI, receipts and voice remain separate future work.
