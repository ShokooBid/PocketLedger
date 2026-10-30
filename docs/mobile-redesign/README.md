# Mobile redesign: decisions and implementation contract

Issue: [#64](https://github.com/ShokooBid/PocketLedger/issues/64).
Decision date: 2026-10-30. Status: product questions answered; specification ready
for implementation review. These documents specify future behavior, not features
already shipped.

Read the [UX specification](ux.md) and [finance contracts](finance-contracts.md)
together. Follow-up issues implement the screens, services and migrations; #64
does not change runtime behavior, schema or generated OpenAPI.

The first implementation increment is documented in the [#65 handoff](issue-65.md).
It keeps the rollout disabled by default; the remaining specifications below
continue to describe the target design rather than currently enabled features.

## Confirmed product decisions

These decisions come from the user's explicit instructions and answers, rather
than assumptions taken from the supplied design images.

| Topic                | Confirmed behavior                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                 | Add transaction is the main page after login.                                                                                                                       |
| Accounts             | Users define named accounts such as BMO, CIBC and Cash; add/manage them in Settings. Bank names do not imply bank connections.                                      |
| Currency             | CAD by default, editable only in Settings, with one currency shown on Add. Saving the first transaction locks currency. Account creation alone does not lock it.    |
| Foreign exchange     | Excluded. No conversion, exchange rates or cross-currency transfers.                                                                                                |
| Default categories   | Fixed: users cannot rename or archive them. Actual catalog values will be supplied later.                                                                           |
| Personal categories  | Users can create root categories and subcategories under either a default root or a personal root.                                                                  |
| Category selection   | Select either a parent category or a subcategory.                                                                                                                   |
| Merchant/payee/payer | Leave these fields out of the redesigned transaction form. Preserve existing stored merchant values during migration.                                               |
| Description          | One optional description/note field. No separate merchant or payer input.                                                                                           |
| Amount entry         | Custom keypad with digits, decimal, backspace and confirm. Confirm validates all fields and saves the transaction. No addition/subtraction or arithmetic operators. |
| Opening balance      | Optional, defaulting to zero, so accounts can show tracked balances.                                                                                                |
| Statements           | Select a specific account for CSV/PDF uploads; keep that account visible through review and confirmation. Processing arrives in later issues.                       |
| AI                   | Reserve text/voice/receipt entry points now; functionality arrives later and requires editable drafts plus explicit confirmation.                                   |

## Final answers and their consequences

1. **Saving the first transaction locks currency.** Account creation, optional
   opening balance, categories, drafts and extraction without confirmation do not
   lock it. The first committed normal transaction, transfer posting or confirmed
   statement transaction locks the user's current currency atomically. Failed
   validation/rolled-back writes do not lock it.
2. **Keypad confirm saves after validating all fields.** It is the entry page's
   primary Save transaction action, not a separate amount-only confirmation step.
   Any other presentation of Save invokes the same guarded operation.

Before the first transaction, changing Settings currency leaves existing accounts
and their opening balances in their original currency. Select/create a compatible
account for the next entry. Do not silently relabel money to make an old account
fit the new preference. After the first committed posting there is no currency
unlock/reset flow in this redesign.

## Implementation boundaries

| Responsibility                                                       | Follow-up issue                                                                                                                                                                    |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persisted CAD preference, Settings and currency lock                 | [#65](https://github.com/ShokooBid/PocketLedger/issues/65)                                                                                                                         |
| Hierarchy, immutable defaults and personal-category operations       | [#66](https://github.com/ShokooBid/PocketLedger/issues/66)                                                                                                                         |
| Actual default catalog and provisioning                              | [#67](https://github.com/ShokooBid/PocketLedger/issues/67)                                                                                                                         |
| Accounts and optional opening balance                                | [#68](https://github.com/ShokooBid/PocketLedger/issues/68)                                                                                                                         |
| Transaction account links, merchant-free contract and migration gate | [#69](https://github.com/ShokooBid/PocketLedger/issues/69)                                                                                                                         |
| Account management in Settings                                       | [#70](https://github.com/ShokooBid/PocketLedger/issues/70)                                                                                                                         |
| Category/account pickers                                             | [#71](https://github.com/ShokooBid/PocketLedger/issues/71)                                                                                                                         |
| Entry home, custom keypad and navigation                             | [#72](https://github.com/ShokooBid/PocketLedger/issues/72)                                                                                                                         |
| Atomic transfers and transfer UI                                     | [#73](https://github.com/ShokooBid/PocketLedger/issues/73), [#74](https://github.com/ShokooBid/PocketLedger/issues/74)                                                             |
| Logical history, account filters and category rollups                | [#75](https://github.com/ShokooBid/PocketLedger/issues/75)                                                                                                                         |
| Inert AI entry points                                                | [#76](https://github.com/ShokooBid/PocketLedger/issues/76)                                                                                                                         |
| End-to-end/device acceptance                                         | [#77](https://github.com/ShokooBid/PocketLedger/issues/77)                                                                                                                         |
| Later account-bound review, CSV and PDF processing                   | [#78](https://github.com/ShokooBid/PocketLedger/issues/78), [#79](https://github.com/ShokooBid/PocketLedger/issues/79), [#80](https://github.com/ShokooBid/PocketLedger/issues/80) |

Earlier issue bodies and the local planning document may still mention optional
merchant fields, editable default copies or a native keyboard. Those are
superseded by the confirmed decisions above; they must not drive implementation.
The backend version/DTO names in these documents are engineering specifications;
implemented Zod schemas and generated OpenAPI remain the executable contract.

## Verification and completion evidence

| #64 acceptance criterion                                                                                 | Specification evidence                                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Screen states cover loading, empty, invalid, saving, uncertain write, success, cancel and session expiry | [UX state matrix](ux.md#states-and-recovery)                                         |
| Add shows one Settings currency without a selector                                                       | [Entry fields](ux.md#transaction-entry)                                              |
| Existing amounts, currencies, ownership and historical links survive                                     | [Migration and compatibility](finance-contracts.md#migration-and-compatibility-gate) |
| Merchant removal and legacy-client gate are explicit                                                     | [Version boundary](finance-contracts.md#version-boundary)                            |
| CSV/PDF and functional AI are later increments requiring confirmation                                    | [Statement and AI flows](ux.md#statements-and-ai-later-increments)                   |

Review the specification against current Prisma models, transaction/category/
dashboard Zod contracts, mobile data adapters, session navigation and transport.
Check Markdown formatting, local links, example JSON and consistency with the
confirmed answers. Runtime tests cannot verify unimplemented future screens;
follow-up issues require behavior/integration tests and native-device acceptance.

See [verification and handoff](verification.md) for reviewed source boundaries,
checks actually run and the local completion/review boundary.
