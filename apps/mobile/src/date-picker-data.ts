import type { DateType } from "react-native-ui-datepicker";
import { localDate } from "./entry-data";
import { calendarDate } from "./transaction-data";

// Accounting dates have no time zone. Keep date-only strings intact and read
// the local calendar fields of the Date objects returned by the picker.
export function pickerDate(value: DateType): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const date = value.slice(0, 10);
    return calendarDate.safeParse(date).success ? date : undefined;
  }
  const date =
    typeof value === "object" && !(value instanceof Date)
      ? value.format("YYYY-MM-DD")
      : localDate(new Date(value));
  return calendarDate.safeParse(date).success ? date : undefined;
}
