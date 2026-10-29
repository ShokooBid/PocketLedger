import { Screen, StateNotice } from "../../ui";
import { useCategories } from "../../category-context";
import { useTransactions } from "../../transaction-context";
import { TransactionManagement } from "../../transaction-management";
import { useSession } from "../../session";
import { useLocalSearchParams, useRouter } from "expo-router";
import { calendarDate, currencySchema } from "../../transaction-data";

export default function TransactionsScreen() {
  const source = useTransactions();
  const categories = useCategories();
  const { session } = useSession();
  const router = useRouter();
  const { action, date, currency } = useLocalSearchParams();
  const parsedDate = calendarDate.safeParse(date);
  const parsedCurrency = currencySchema.safeParse(currency);
  const initialCreate =
    action === "add" && parsedDate.success && parsedCurrency.success
      ? { date: parsedDate.data, currency: parsedCurrency.data }
      : undefined;
  if (action !== undefined && !initialCreate)
    return (
      <Screen title="Transactions" back>
        <StateNotice
          kind="error"
          title="Invalid add transaction request"
          message="Return to the dashboard and choose Add transaction again."
        />
      </Screen>
    );
  return (
    <Screen title="Transactions" back>
      <TransactionManagement
        key={
          initialCreate
            ? `${initialCreate.date}_${initialCreate.currency}`
            : "history"
        }
        {...(initialCreate ? { initialCreate } : {})}
        source={source}
        categories={categories}
        demo={session.status === "demo"}
        onOpenDetail={(id) =>
          router.push({ pathname: "/transactions/[id]", params: { id } })
        }
      />
    </Screen>
  );
}
