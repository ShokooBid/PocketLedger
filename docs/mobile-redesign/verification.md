# Issue #64 verification and handoff

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

- Focused Prettier write/check for the specification Markdown passed. The narrow
  Git/Prettier exceptions expose only this accepted specification folder; local
  walkthroughs, planning notes and issue draft folders remain ignored.
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
