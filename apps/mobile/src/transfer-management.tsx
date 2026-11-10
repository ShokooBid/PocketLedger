import { Modal, View } from "react-native";
import { Body, Button, Screen, StateNotice } from "./ui";
import { amountText } from "./transaction-data";
import { theme } from "./theme";
import {
  useTransferManagement,
  type TransferManagementProps
} from "./use-transfer-management";

export function TransferManagement(props: TransferManagementProps) {
  const state = useTransferManagement(props),
    disabled =
      state.busy ||
      state.loading ||
      !state.ready ||
      state.uncertain ||
      props.writeBlocked;
  const summary = (row: (typeof state.rows)[number]) => (
    <>
      <Body>From Account: {state.accountName(row.fromAccountId)}</Body>
      <Body>To Account: {state.accountName(row.toAccountId)}</Body>
      <Body>
        Amount: {amountText(row.amountMinor, row.currency)} {row.currency}
      </Body>
      <Body>Date: {row.date}</Body>
      <Body>Description: {row.note || "None"}</Body>
    </>
  );
  return (
    <View style={{ gap: theme.space.md }}>
      {!props.detailId && <Body>Transfers</Body>}
      {state.loading && <Body>Refreshing transfers…</Body>}
      {state.error && (
        <StateNotice
          kind="error"
          title="Transfer action needs attention"
          message={state.error}
        />
      )}
      {state.notice && <Body>{state.notice}</Body>}
      {props.writeBlocked && (
        <Body>Resolve the pending save in Add before changing a transfer.</Body>
      )}
      <Button
        label="Reload transfers"
        disabled={state.busy || state.loading}
        onPress={() => void state.load()}
      />
      {state.ready && !state.rows.length && (
        <Body>
          {props.detailId
            ? "This transfer is unavailable or has been deleted. Return to History to continue."
            : "No transfers yet."}
        </Body>
      )}
      {state.rows.map((row) => (
        <View key={row.id} style={{ gap: theme.space.sm }}>
          {summary(row)}
          {props.detailId ? (
            <>
              <Body>Income and spending are unchanged by this transfer.</Body>
              {[row.fromAccountId, row.toAccountId].map(
                (id, index) =>
                  state.balances[id] !== undefined && (
                    <Body key={id}>
                      {index === 0 ? "From" : "To"} tracked balance as of{" "}
                      {state.balances[id]!.asOf}:{" "}
                      {state.balances[id]!.balanceMinor < 0 ? "-" : ""}
                      {amountText(
                        Math.abs(state.balances[id]!.balanceMinor),
                        row.currency
                      )}{" "}
                      {row.currency}
                    </Body>
                  )
              )}
              {state.balanceError && (
                <Body>
                  Some balances could not be loaded. Reload transfers to retry.
                </Body>
              )}
              <Button
                label="Edit transfer"
                disabled={!!disabled}
                onPress={() => props.onEdit(row)}
              />
              <Button
                label="Delete transfer"
                disabled={!!disabled}
                onPress={() => state.askDelete(row)}
              />
            </>
          ) : (
            <Button
              label={`View transfer: ${row.note || row.date}`}
              disabled={state.busy}
              onPress={() => props.onOpenDetail?.(row.id)}
            />
          )}
        </View>
      ))}
      {state.after && (
        <Button
          label="Load more transfers"
          disabled={state.busy || state.loading}
          onPress={() => void state.load(true)}
        />
      )}
      <Modal
        visible={state.deleting !== null}
        animationType="slide"
        onRequestClose={state.cancelDelete}
      >
        <Screen title="Delete whole transfer?" showUserMenu={false}>
          {state.deleting && summary(state.deleting)}
          <Body>
            Both account postings will be removed together and both balances
            adjusted. Hard deletion also removes creation replay protection; an
            old create retry may create it again.
          </Body>
          {state.error && <Body>{state.error}</Body>}
          {state.notice && <Body>{state.notice}</Body>}
          {state.uncertain && (
            <>
              <Body>
                The deletion may have succeeded. Check this transfer before
                retrying.
              </Body>
              <Button
                label="Check transfer deletion"
                disabled={state.busy}
                onPress={() => void state.reviewDelete()}
              />
            </>
          )}
          <Button
            label={
              state.uncertain
                ? "Retry deleting whole transfer"
                : "Confirm delete transfer"
            }
            variant="primary"
            disabled={
              state.busy ||
              !!props.writeBlocked ||
              (state.uncertain && !state.reviewed)
            }
            onPress={() => void state.remove()}
          />
          <Button
            label="Keep transfer"
            disabled={state.busy || state.uncertain}
            onPress={state.cancelDelete}
          />
        </Screen>
      </Modal>
    </View>
  );
}
