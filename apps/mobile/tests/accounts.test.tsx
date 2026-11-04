import { expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react-native";
import { AccountManagement } from "../src/account-management";
import {
  createApiAccountSource,
  parseOpeningBalance,
  type AccountSource
} from "../src/account-data";
import { createTransport, type FetchRequest } from "../src/auth/transport";
import { accounts, accountId, response } from "./auth-fixtures";

async function press(name: string) {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name }));
  });
}

it("parses signed opening amounts exactly without creating an income posting", () => {
  expect(parseOpeningBalance("", "CAD")).toBe(0);
  expect(parseOpeningBalance("-12.34", "CAD")).toBe(-1234);
  expect(parseOpeningBalance("-1", "JPY")).toBe(-1);
  expect(parseOpeningBalance("1.001", "KWD")).toBe(1001);
  for (const value of ["1e2", "1.001", "21474836.48", "NaN"])
    expect(() => parseOpeningBalance(value, "CAD")).toThrow();
});

it("uses canonical account paths and rejects nonadvancing pagination", async () => {
  const row = (await accounts.list()).find((row) => row.id === accountId())!;
  const fetcher = jest
    .fn<FetchRequest>()
    .mockResolvedValue(response({ items: [row], nextCursor: row.id }));
  const source = createApiAccountSource(
    createTransport("https://api.example.invalid", fetcher)
  );
  await expect(source.list()).rejects.toMatchObject({ kind: "protocol" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]?.[0]).toContain("/v1/accounts?");
});

it("creates a named account, selects its default and confirms archival while preserving its baseline", async () => {
  const row = (await accounts.list()).find(
    (row) => row.id === accountId("CAD")
  )!;
  const create = jest.fn<AccountSource["create"]>().mockResolvedValue(row);
  const archive = jest
    .fn<AccountSource["archive"]>()
    .mockResolvedValue({ ...row, archivedAt: "2026-11-03T00:00:00Z" });
  const onDefault = jest
    .fn<(id: string | null) => Promise<void>>()
    .mockResolvedValue(undefined);
  const list = jest
    .fn<AccountSource["list"]>()
    .mockResolvedValueOnce([])
    .mockResolvedValue([row]);
  render(
    <AccountManagement
      source={{ ...accounts, list, create, archive }}
      currency="CAD"
      defaultAccountId={null}
      onDefault={onDefault}
    />
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled()
  );
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText("Account name"), "My cash");
    fireEvent.changeText(
      screen.getByLabelText("Opening balance (optional)"),
      "-12.34"
    );
    fireEvent.changeText(
      screen.getByLabelText("Account opening date (YYYY-MM-DD)"),
      "2026-01-01"
    );
  });
  await press("Create account");
  expect(create).toHaveBeenCalledWith({
    name: "My cash",
    type: "bank",
    currency: "CAD",
    openingBalanceMinor: -1234,
    openingDate: "2026-01-01"
  });
  await press("Use Test CAD as default");
  expect(onDefault).toHaveBeenCalledWith(row.id);
  await press("Archive Test CAD");
  expect(archive).not.toHaveBeenCalled();
  await press("Confirm archive account");
  expect(archive).toHaveBeenCalledWith(row.id);
});

it("requires a successful account read before enabling mutations", async () => {
  const list = jest
    .fn<AccountSource["list"]>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([]);
  render(
    <AccountManagement
      source={{ ...accounts, list }}
      currency="CAD"
      defaultAccountId={null}
      onDefault={async () => {}}
    />
  );
  await screen.findByText(
    "Accounts could not be loaded. Reload before making changes."
  );
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  await press("Reload accounts");
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
});
