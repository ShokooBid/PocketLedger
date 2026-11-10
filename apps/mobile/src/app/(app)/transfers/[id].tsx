import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { z } from "zod";
import { Body, Button, Screen } from "../../../ui";
import {
  useAccounts,
  useTransfers,
  useFinanceChanges
} from "../../../transaction-context";
import { useEntry } from "../../../entry-context";
import { TransferManagement } from "../../../transfer-management";

export default function TransferDetailRoute() {
  const { id } = useLocalSearchParams(),
    parsed = z.uuid().safeParse(id);
  const source = useTransfers(),
    accounts = useAccounts(),
    changes = useFinanceChanges(),
    entry = useEntry(),
    router = useRouter();
  const [active, setActive] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, [])
  );
  return (
    <Screen title="Transfer details">
      <Button
        label="Back to transfer history"
        onPress={() => router.navigate("/transactions")}
      />
      {parsed.success ? (
        <TransferManagement
          key={parsed.data}
          detailId={parsed.data}
          source={source}
          accounts={accounts}
          active={active}
          writeBlocked={entry.busy || entry.uncertain}
          onReconciled={changes.invalidate}
          onEdit={(row) => entry.editTransfer(row, () => router.navigate("/"))}
        />
      ) : (
        <Body>
          This transfer link is invalid. Return to History and select a
          transfer.
        </Body>
      )}
    </Screen>
  );
}
