# Mobile redesign UX specification

Status and user decisions: [decision record](README.md). Planned API behavior:
[finance contracts](finance-contracts.md). All examples are synthetic. Category
names shown in examples do not define the final default catalog.

## Navigation and layout

Four persistent destinations: **Add**, **History**, **Overview**, **Settings**.
After login/demo entry, require permanent currency selection and at least one
active account before opening finance screens. CAD is preselected locally; only
explicit confirmation saves it. A ready authenticated deep link may open its
requested detail, but signing in never executes a linked write. Add becomes the
home in #72; the dashboard is now Overview behind the same setup gate.

| Destination             | Responsibility                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Add `/`                 | Income/expense/transfer draft; primary recording experience.                          |
| History `/transactions` | Logical records and account/date/category filters.                                    |
| Overview `/overview`    | Period totals, category rollups and recent records.                                   |
| Settings `/settings`    | Currency, account management, category management, existing privacy/session controls. |

Keep `/transactions/[id]`, `/categories`, `/import`, `/privacy` and `/settings`
reachable. Add account/transfer detail routes under their respective resources.
Picker Back returns to its invoking draft; do not hard-code every Back to the
old dashboard. Direct-open details without a stack return to History or Settings
as appropriate. Invalid IDs/query parameters show a recoverable invalid-link state.

The reference supplies the pink/violet header, white surfaces, rounded rows and
clear amount hierarchy. Use the existing theme/decorative components where
appropriate. Controls require visible labels, readable contrast, minimum 48-point
touch targets and large-text layouts. Decoration never receives focus or taps.
No feature availability is communicated by color alone.

## Transaction entry

Expense / Income / Transfer is a compact segmented choice. Income/expense use:

| Control                  | Requirement and behavior                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Amount                   | Positive exact minor units. Parse/display using the selected account currency, inherited from the permanent choice. Custom numeric keypad; no currency selector or arithmetic. |
| Account                  | Required active named account in the configured currency. A user-selected default may prefill it; otherwise select explicitly.                                                 |
| Category                 | Required root or child. Open the searchable picker rather than display every option inline.                                                                                    |
| Date                     | Required calendar date, defaulting to local today. Use a date picker; there is no time field.                                                                                  |
| Description / note       | One optional free-text field; API name `note`, maximum 2000 UTF-16 units, empty input becomes null.                                                                            |
| Merchant / payee / payer | Absent. No empty hidden required field and no fabricated merchant value.                                                                                                       |

Implemented in #94: transaction writes send account ID and integer minor units,
without a currency field. Read/display currency comes from the account, including
archived history. Reject different-currency reassignment without changing amounts.
Draft currency remains a recovery snapshot; a mismatch requires explicit review.
The custom keypad and entry-home layout are implemented locally in
[#72](https://github.com/ShokooBid/PocketLedger/issues/72). Runtime/device acceptance
remains pending.

Show compact Type with AI / Voice / Scan receipt shortcuts as Coming soon. They
open an availability explanation and preserve the manual draft. They request no
permissions, collect no input and perform no writes.

**Keypad:** digits 0-9, a decimal key where the currency permits fractional units,
backspace and confirm. Reject a second decimal separator, excessive precision,
negative normal-transaction amounts and values outside the existing positive
32-bit minor-unit bound. Keep the amount as text while editing; convert decimal
digits to integer minor units without floating-point multiplication or rounding.
Provide accessible key names and keyboard/focus operation on supported platforms.
Typing a value never saves it. Keypad confirm is the primary Save transaction
action: validate amount, account, category, date and note, then save once. It does
not merely dismiss amount entry or require a second Save button. If another Save
affordance is needed for accessibility/layout, route it to the same submit lock
and request identity. Invalid fields retain the draft and receive focus/feedback.

If no active account exists, hide finance/transaction screens behind account
setup. Keep Settings, privacy and sign-out available. Reuse the Settings account
form and restore the existing draft unchanged after repair. Hidden drafts remain
mounted but inaccessible; loading/read failures are retry states, not evidence
that the user has no accounts.
Changing income/expense retains entered values; validate the resulting payload
again. Keep entry coordination and validation separate from visual controls.

## Category picker and management

Start with Search, Recently used and All categories. Search matches roots and
children, showing the full path for duplicate child names. Recently used derives
from recently saved owned transactions, not the first loaded history page.

Selecting a root opens its children with an explicit Use this category action.
Selecting a child returns it to the same draft. Fixed default roots/children
cannot be renamed, archived, reparented or visually edited through user APIs.
Users may add personal roots and personal children under either a fixed default
root or their own root. Keep the hierarchy to two levels.

Creation returns the resource ID and can select it immediately. Personal
rename/archive controls live in management, not normal selection. Archiving a
personal root confirms the affected personal descendants and preserves historic
links; archived categories are unavailable for new assignments. Existing archived
associations remain readable. #96 shares the approved #67 catalog; defaults do not come from
example labels in the reference image.

## Settings and named accounts

Currency is chosen once immediately after sign-in, before account setup or
finance access. The selection form suggests CAD without saving it, explains
permanence and requires explicit confirmation. Once confirmed, Settings displays
the value without editing controls, even before the first account or posting.
Same-value retries succeed; uncertain responses disable further changes until a
reload confirms the saved value. No first-posting lock, conversion or unlock flow.

An active account is required for entry/history/details and direct links. Users
may archive their final active account, but then must create another to resume
finance screens. Preserve historical postings and draft fields. Refresh setup on
route entry, app foreground and account mutations; hide unverified finance UI
without tearing down an existing draft. Demo uses the same rules in memory and
resets on exit. No default-account selection is required to complete setup.

Settings -> Accounts provides list, add, details, rename, archive confirmation
and explicit default selection. Names such as BMO Chequing, BMO Savings, CIBC and
Cash are user-defined. No bank connection is implied and no credentials are needed.

Account cards use compact eye, pencil, star and archive icons with 48-point touch
targets and accessible action names. Hover/focus shows a tooltip; long press on
mobile shows the label without performing the action. The default account has a
filled purple star. Details start collapsed, including after account creation,
and the eye toggles them inside the card. Hiding works during a pending balance
read and late responses leave details hidden. Archive still requires explicit
confirmation. Archived cards retain their eye/history action; incompatible
currencies cannot become the default. Actions wrap below the account identity
on narrow screens.

After the phone-layout correction, the account badge stays beside the name and
the type/currency/status line. Use smaller 18-point action glyphs on 32-point
tiles inside 48-point touch targets. Reserve space for the account information;
long names truncate, while metadata may wrap. When the measured card width or
system font size requires more room, place the actions below the identity.

Keep account setup minimal: the Add account heading and opening balance field
have help tooltips for their explanations, including the permanent currency.
Use one account-type dropdown for Cash, Bank, Credit and Other. Omit the Financial
accounts heading, routine explanatory paragraphs and empty-list notice. Accounts
refresh on page focus, app foreground and mutations; failed reads have a local
Try again action rather than a permanent Reload accounts button. An uncertain
write triggers a read and still requires review before another write.

Every application screen, including currency/account setup, has a simple avatar
beside its title. Hover, focus or tap opens Settings and Sign out (Exit demo in
demo mode). Remove the duplicate footer links/actions. Keep the separate confirmed
Sign out on all devices control in Settings. Signed-out authentication screens
do not show the user menu.

Account creation has no independent currency selector. Opening balance is optional and defaults to zero. Show the associated
opening date so the balance's accounting boundary is clear. Account details show
currency, tracked balance, opening information and archival state. A default
account must be owned, active and compatible; archival invalidates its selection.

## Transfer entry

Transfer mode replaces the normal category/account selection with **From account**
and **To account**. Require different active owned accounts in the same configured
currency, a positive amount, calendar date and optional note. No category,
merchant or foreign-exchange control is shown.

Review visibly includes both account names, amount, currency and date. Saving
creates one logical transfer with two balanced postings atomically. Detail,
editing and deletion operate on the whole transfer. A pending/uncertain save must
not be restarted with a new creation identifier. Successful changes refresh both
account balances, History and Overview.

## History and Overview

Issue #75 implements the live History screen with a current-month default,
previous/next/selected month controls and inclusive custom From/To calendar dates.
Account, type (income/expense/transfer) and exact/subtree category filters combine
with AND. Apply commits the draft selection; Clear removes every filter and starts
a new pagination chain. A category filter excludes uncategorized transfers.

Group compact rows by the stored transaction date, newest first. Headers show
the full filtered-day count and net per currency even when that date spans pages.
Count transfers once; exclude them from income/expense/net/category totals.
Ordinary rows use category icons and optional note/category/date fallback text;
transfers use a dedicated icon and From -> To labels. Account statements label
incoming/outgoing transfers and their balance sign. They remain excluded from net.
Settings account details link to History with that account selected, including
archived accounts. Existing readiness still requires at least one active account.

Older/newer cursor pages merge into one section per date. Failed reads preserve
loaded context with a stale-data notice and an explicit retry. Confirmed finance
changes invalidate cursors; returning to History reloads current labels/totals.
The #106 handoff is `/transactions?focusId=<id>&focusKind=transaction|transfer`:
History can reveal/highlight an owned saved record through bounded reads, explain
only the necessary filter adjustments and load nearby newer/older pages. #106
owns automatic post-save navigation, shared editor selection and Add/Edit labels;
until then rows open their existing transaction/transfer details. Demo presentation
and data sources are intentionally unchanged at the owner's request.

Overview shows period income, expenses, net and root/child category breakdowns.
Transfers affect account balances, never income/expenses/net. Opening balances
also do not count as income. Do not add unlike currencies. Archived records stay
readable and include their state; historical labels follow the existing current-
name behavior rather than inventing immutable snapshots.

## States and recovery

| State                            | Entry / transfer                                                                                                              | Pickers / Settings                                                             | History / Overview / later statement review                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Loading                          | Resolve verified session, Settings and choices before making Save available; no transient USD draft.                          | Show progress without pretending an empty list is final.                       | Show a loading state; do not replace financial totals with fabricated zeros.                                  |
| Empty                            | Offer Settings account creation and preserve the draft.                                                                       | Search no-match differs from no categories/accounts; allow permitted creation. | Explain no records/rows; a confirmed empty period has real zero totals.                                       |
| Invalid                          | Field-specific feedback; preserve amount/date/note and focus the first problem.                                               | Explain duplicate/read-only/default/archived failures; retain input.           | Reject bad filters/links; a statement with blocking row issues cannot confirm.                                |
| Saving                           | Lock concurrent submit/mode-changing writes and keep the same request identity.                                               | Disable repeated mutation while pending.                                       | Do not optimistically change posted totals or import counts.                                                  |
| Uncertain write                  | Keep the draft/key; check the existing operation before allowing another create. A timeout is not evidence of failure.        | Reload/reconcile before a blind mutation retry.                                | Preserve selection/review; confirmation retry uses the same idempotency identity.                             |
| Success                          | Announce success, refresh dependent views and prepare another entry; clear amount/note, preserve appropriate user selections. | Return the created/selected ID; refresh lists/defaults.                        | Show only server-confirmed records, counts and totals.                                                        |
| Cancellation                     | Back from pickers returns unchanged; explicitly discarding a dirty draft requires confirmation.                               | Cancel creates/archives nothing.                                               | Cancelling a statement review posts nothing.                                                                  |
| Session expired / account switch | Hide protected data and clear session-owned drafts, selections and keys on logout/account switch.                             | Cancel stale callbacks; no prior-user choices remain visible.                  | Restore verified access or sign in; no duplicate replay after renewal.                                        |
| Read/network error               | Keep entered values and explain retry/recovery.                                                                               | Retry loading without enabling writes against missing/stale required data.     | Preserve filters and loaded context; mark failed refresh instead of showing stale totals as freshly verified. |

Implemented in #95: a pending manual create captures one UUID and payload;
explicit retry reuses both, while a new intentional create gets a new UUID. Keep
Save disabled and use an immediate synchronous lock during submission. The API
returns current edited data when the original create is retried. Explain during
uncertain-create recovery that protection lasts while the saved row exists; if
it was hard-deleted, a late retry may create it again. No tombstone is retained.

Drafts live in session memory across picker/tab navigation, with no promise of
process-restart recovery. App backgrounding alone does not imply logout. Persistent
finance drafts require a separate private-storage decision. Announce loading,
errors and success appropriately to assistive technology; keep Save/confirm
reachable around the keypad and safe areas. Never request final confirmation for
a write that has not yet been prepared for review.

Implemented in #96: every signed-in user and demo sees the same approved catalog
identities alongside only their own personal categories. Read-only defaults may
be selected, and personal children may be added under shared roots. A personal
sibling cannot shadow a visible shared/default name after existing normalization.
Shared category selection never exposes another user's recents or amounts.

## Statements and AI: later increments

Account selection -> file selection -> extraction/parsing -> editable draft rows
-> selected-row review -> explicit confirmation -> posted transactions.

Show the selected account at every stage; account details may preselect it. A
filename, statement logo or model output cannot change that account. Account
changes invalidate prior row validation. Account/currency/date mismatches block
confirmation; no conversion occurs. Opening/closing balances and statement totals
are not transaction rows. Repeated statements and possible transfer matches need
explicit resolution so both sides of one transfer are not duplicated.

CSV is #79; PDF extraction/OCR decisions are #80, both using #78 batch review.
Text AI, receipt capture and voice are separate later implementations. All produce
untrusted drafts that the user can edit/reject; no upload, extraction, navigation
or model response is a posting confirmation. Show no fictitious recent imports
or successful AI results as live financial data.
