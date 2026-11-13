import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from "@jest/globals";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  waitFor
} from "expo-router/testing-library";
import { router } from "expo-router";
import { AppState } from "react-native";
import { parsePreviewState } from "../src/navigation";
import { localDate } from "../src/entry-data";
import { chooseTransactionDate } from "./date-picker-fixtures";
import * as sessionModule from "../src/session";
import * as runtime from "../src/auth/runtime";
import {
  alice,
  bob,
  deferred,
  harness,
  response,
  stored
} from "./auth-fixtures";

let shell: Awaited<ReturnType<typeof renderRouter>>;

beforeEach(() => {
  jest
    .spyOn(runtime, "createRuntimeSession")
    .mockImplementation(() => harness(null).controller);
});

async function openShell(initialUrl = "/") {
  const rendering = renderRouter("./src/app", { initialUrl });
  await act(async () => {
    shell = await rendering;
    await Promise.resolve();
  });
  return shell;
}

async function press(name: string) {
  await waitFor(() =>
    expect(screen.getByRole("button", { name })).toBeEnabled()
  );
  await tap(screen.getByRole("button", { name }));
}

async function tap(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

// Focus effects can start asynchronous reads even when router methods return void.
async function navigate(action: () => void) {
  await act(async () => {
    action();
  });
}

async function field(label: string, value: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText(label), value);
  });
}

async function openSettings() {
  await press("User menu");
  await tap(screen.getByRole("link", { name: "Open settings" }));
}

async function chooseCategory(label: string) {
  await press("Choose category");
  await field("Search categories", label);
  await press(`Category: ${label}`);
  await press(`Use this category: ${label}`);
}
async function chooseAccount(label: string) {
  await press("Choose account");
  await field("Search accounts", label);
  await press(`Account: ${label}`);
}

async function enterDemo(currency: "CAD" | "JPY" | "KWD" = "CAD") {
  await press("Explore demo screens without signing in");
  await screen.findByRole("header", { name: "Choose your currency screen" });
  await press(`Choose currency ${currency}`);
  await press(`Confirm ${currency} permanently`);
  await screen.findByRole("header", { name: "Set up an account screen" });
  await field("Account name", "Demo setup cash");
  await field("Account opening date (YYYY-MM-DD)", "2024-01-01");
  await press("Create account");
  expect(
    await screen.findByRole("header", { name: "New transaction screen" })
  ).toBeVisible();
  // Existing reporting/settings flows start at Overview; #72 cases use Add.
  await tap(screen.getByRole("link", { name: "Overview" }));
  await screen.findByRole("header", { name: "Overview screen" });
}

afterEach(() => {
  // renderRouter enables fake timers. RNTL's earlier auto-cleanup hook unmounts
  // the tree first; do not carry that router clock into another scenario.
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("session navigation", () => {
  // This first flow loads the router and calendar dependency cold, switches
  // tabs and checks both confirmation paths. Budget the complete integration
  // flow separately while keeping each element lookup's deadline unchanged.
  it("keeps Add drafts across tabs and Settings and confirms leaving without a discard button", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Add" }));
    await screen.findByRole("header", { name: "New transaction screen" });
    await press("Digit 1");
    await press("Decimal point");
    await press("Digit 2");
    await field("Note (optional)", "Keep across tabs");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    for (const name of ["History", "Overview", "Settings"] as const) {
      if (name === "Settings") await openSettings();
      else await tap(screen.getByRole("link", { name }));
      await tap(screen.getByRole("link", { name: "Add" }));
      expect(await screen.findByLabelText("Amount")).toHaveProp("value", "1.2");
      expect(screen.getByLabelText("Note (optional)")).toHaveProp(
        "value",
        "Keep across tabs"
      );
    }
    expect(
      screen.queryByRole("button", { name: "Discard transaction draft" })
    ).toBeNull();
    expect(screen.getByLabelText("Note (optional)")).toHaveProp(
      "placeholder",
      "Description (optional)"
    );
    await openSettings();
    await press("User menu");
    await press("Exit demo and return to sign in");
    await press("Keep transaction draft");
    await tap(screen.getByRole("link", { name: "Add" }));
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "1.2");
    await press("User menu");
    await press("Exit demo and return to sign in");
    await press("Confirm discard draft");
    expect(
      await screen.findByRole("header", { name: "Sign in screen" })
    ).toBeVisible();
  }, 30000);

  it("opens History after saving and uses the shared editor for a selected record", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Add" }));
    await chooseAccount("Demo setup cash");
    await chooseCategory("Food & Drinks");
    await press("Digit 7");
    await press("Decimal point");
    await press("Digit 5");
    await field("Note (optional)", "Keypad purchase");
    expect(screen.queryByText(/Transaction saved/)).toBeNull();
    await press("Save transaction");
    expect(
      await screen.findByRole("header", { name: "History screen" })
    ).toBeVisible();
    expect(
      await screen.findByRole("button", { name: "Edit Keypad purchase" })
    ).toBeVisible();
    await press("Edit Keypad purchase");
    expect(
      await screen.findByRole("header", { name: "Edit transaction screen" })
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Edit" })).toBeVisible();
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "7.50");
    await field("Amount", "8.50");
    await press("Update transaction");
    expect(
      await screen.findByRole("header", { name: "History screen" })
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Add" })).toBeVisible();
    await press("Edit Keypad purchase");
    await field("Amount", "9.50");
    await press("Cancel transaction editing");
    await press("Confirm discard draft");
    expect(
      await screen.findByRole("header", { name: "History screen" })
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Add" })).toBeVisible();
    await tap(screen.getByRole("link", { name: "Add" }));
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "");
    expect(
      screen.getByRole("button", {
        name: "Account: Demo setup cash",
        selected: true
      })
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Category: Food & Drinks",
        selected: true
      })
    ).toBeVisible();
  }, 20000);

  it("creates an account through Settings and returns to every unchanged draft field", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Manage categories" }));
    await press("Add category");
    await field("Category name", "Onboarding food");
    await press("Save category");
    await screen.findByText("Onboarding food");
    await press("Back to previous screen");
    await press("Add transaction");
    await screen.findByText("New transaction");
    await field("Amount", "12.34");
    await chooseTransactionDate("2026-11-01");
    await field("Note (optional)", "Keep this draft");
    await chooseCategory("Onboarding food");
    await press("Choose account");
    expect(screen.queryByLabelText("Amount")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Add an account in Settings" })
    ).toHaveLength(1);
    await press("Add an account in Settings");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create account" })
      ).toBeEnabled()
    );
    await field("Account name", "BMO Chequing");
    await field("Account opening date (YYYY-MM-DD)", "2026-01-01");
    await press("Create account");
    expect(
      screen.getByRole("button", {
        name: "Use BMO Chequing as default",
        selected: false
      })
    ).toBeVisible();
    await press("Return to transaction draft");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Choose account" })
      ).toBeEnabled()
    );
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "12.34");
    expect(
      screen.getByRole("button", { name: "Choose transaction date" })
    ).toHaveProp("accessibilityHint", "2026-11-01");
    expect(screen.getByLabelText("Note (optional)")).toHaveProp(
      "value",
      "Keep this draft"
    );
    expect(
      screen.getByRole("button", {
        name: "Category: Onboarding food",
        selected: true
      })
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Choose account",
        selected: false
      })
    ).toBeVisible();
    await chooseAccount("BMO Chequing");
    await press("Save transaction");
    await screen.findByRole("header", { name: "History screen" });
    await navigate(() => router.push("/settings"));
    await screen.findByRole("header", { name: "BMO Chequing" });
    await press("View balance for BMO Chequing");
    expect(
      screen.getByText(/Tracked balance as of .*: -12.34 CAD/)
    ).toBeVisible();
  }, 15000);

  it("returns with system Back after choosing an explicit default without erasing the draft", async () => {
    await openShell();
    await enterDemo();
    await press("Add transaction");
    await screen.findByText("New transaction");
    await field("Amount", "8.50");
    await field("Note (optional)", "System Back draft");
    await press("Choose account");
    await press("Add an account in Settings");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create account" })
      ).toBeEnabled()
    );
    await field("Account name", "Cash");
    await press("Create account");
    await press("Use Cash as default");
    await navigate(() => router.back());
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Account: Cash",
          selected: true
        })
      ).toBeVisible()
    );
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "8.50");
    expect(screen.getByLabelText("Note (optional)")).toHaveProp(
      "value",
      "System Back draft"
    );
  });

  it("uses a safe fallback for a directly opened draft-return link", async () => {
    await openShell();
    await enterDemo();
    await navigate(() =>
      router.replace("/settings?returnTo=transaction-draft")
    );
    jest.spyOn(router, "canGoBack").mockReturnValue(false);
    await press("Return to transaction draft");
    expect(shell.getPathname()).toBe("/");
  });

  // This full navigation flow also pays for the first cold router render.
  // Allow slower Windows/CI runs without relaxing individual lookup timeouts.
  it("keeps a demo draft through Settings with currency already read-only before saving", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Manage categories" }));
    await press("Add category");
    await field("Category name", "Currency food");
    await press("Save category");
    await screen.findByText("Currency food");
    await press("Back to previous screen");
    await press("Add transaction");
    await screen.findByText("New transaction");
    await field("Amount", "12.34");
    await navigate(() => router.push("/settings"));
    expect(await screen.findByText("Default currency: CAD")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Choose currency|Default currency/ })
    ).toBeNull();
    await navigate(() => router.back());
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "12.34");
    await chooseAccount("Demo setup cash");
    await chooseCategory("Currency food");
    await press("Save transaction");
    await screen.findByRole("header", { name: "History screen" });
    await navigate(() => router.push("/settings"));
    expect(await screen.findByText("Default currency: CAD")).toBeVisible();
  }, 15000);

  it("hides transaction deep links until currency and an active account are confirmed", async () => {
    const h = harness();
    jest.mocked(runtime.createRuntimeSession).mockReturnValue(h.controller);
    h.fetcher.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/me") return response(alice);
      if (path === "/v1/preferences")
        return response({
          entryCurrency: null,
          hasActiveAccounts: false,
          defaultAccountId: null
        });
      return response({ items: [], nextCursor: null });
    });
    await openShell("/transactions/20000000-0000-4000-8000-000000000001");
    expect(
      await screen.findByRole("header", { name: "Choose your currency screen" })
    ).toBeVisible();
    expect(
      screen.queryByRole("header", { name: "Transaction details screen" })
    ).toBeNull();
    expect(
      h.fetcher.mock.calls.filter((call) => call[1]?.method === "PATCH")
    ).toHaveLength(0);
    await openSettings();
    expect(await screen.findByText("Google: not linked")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    await press("Back to previous screen");
    expect(
      await screen.findByRole("header", { name: "Choose your currency screen" })
    ).toBeVisible();
  });

  it("repairs archive-all-accounts without losing the transaction draft", async () => {
    await openShell();
    await enterDemo();
    await press("Add transaction");
    await screen.findByText("New transaction");
    await field("Amount", "8.50");
    await field("Note (optional)", "Retained through account repair");
    await navigate(() => router.push("/settings"));
    await press("Archive Demo setup cash");
    await press("Confirm archive account");
    await navigate(() => router.back());
    expect(
      await screen.findByRole("header", { name: "Set up an account screen" })
    ).toBeVisible();
    expect(screen.queryByLabelText("Amount")).toBeNull();
    await field("Account name", "Replacement cash");
    await press("Create account");
    expect(await screen.findByLabelText("Amount")).toHaveProp("value", "8.50");
    expect(screen.getByLabelText("Note (optional)")).toHaveProp(
      "value",
      "Retained through account repair"
    );
  });

  it("rechecks account readiness on foreground and treats a failed read as an error", async () => {
    const h = harness();
    const appState = jest.spyOn(AppState, "addEventListener");
    jest.mocked(runtime.createRuntimeSession).mockReturnValue(h.controller);
    let hasActiveAccounts = true;
    let offline = false;
    h.fetcher.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/me") return response(alice);
      if (path === "/v1/preferences") {
        if (offline) throw new Error("private connection details");
        return response({
          entryCurrency: "CAD",
          hasActiveAccounts,
          defaultAccountId: null
        });
      }
      return response({ items: [], nextCursor: null });
    });
    await openShell("/transactions");
    expect(
      await screen.findByRole("header", { name: "History screen" })
    ).toBeVisible();
    const foreground = appState.mock.calls.find(
      ([event]) => event === "change"
    )?.[1];
    expect(foreground).toBeDefined();
    offline = true;
    await act(async () => {
      foreground?.("active");
    });
    expect(
      await screen.findByText("Finance setup needs attention")
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    expect(screen.queryByText(/private connection details/)).toBeNull();
    offline = false;
    hasActiveAccounts = false;
    await press("Try again");
    expect(
      await screen.findByRole("header", { name: "Set up an account screen" })
    ).toBeVisible();
    expect(screen.queryByRole("header", { name: "History screen" })).toBeNull();
  });

  it("keeps protected data hidden during an outage and retries verification", async () => {
    const h = harness();
    h.fetcher.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/me") return response(alice);
      if (path === "/v1/preferences")
        return response({
          entryCurrency: "CAD",
          hasActiveAccounts: true,
          defaultAccountId: null
        });
      return response({ items: [], nextCursor: null });
    });
    h.fetcher.mockRejectedValueOnce(new Error("private transport error"));
    jest.mocked(runtime.createRuntimeSession).mockReturnValue(h.controller);
    await openShell("/categories");
    expect(
      screen.getByRole("header", { name: "Session unavailable screen" })
    ).toBeVisible();
    expect(
      screen.queryByRole("header", { name: "Categories screen" })
    ).toBeNull();
    await press("Try again");
    expect(
      await screen.findByRole("header", { name: "Categories screen" })
    ).toBeVisible();
    expect(h.store.clear).not.toHaveBeenCalled();
  });

  // This full flow includes two sign-ins, sign-out, protected navigation and
  // pending-read cancellation. Keep per-lookup deadlines unchanged.
  it("connects categories only after login and clears visible data and pending reads on account change", async () => {
    const originalUrl = process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.invalid";
    const h = harness(null);
    jest.mocked(runtime.createRuntimeSession).mockReturnValue(h.controller);
    let owner = alice;
    let delayedCategories: Promise<Response> | null = null;
    const category = {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Alice private category",
      isDefault: false,
      parentId: null,
      defaultKey: null,
      iconKey: "category",
      colorKey: "neutral",
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    };
    h.fetcher.mockImplementation(async (url, options) => {
      const request = new URL(String(url));
      const path = request.pathname;
      if (path === "/v1/auth/login") {
        const body = JSON.parse(String(options?.body)) as { email: string };
        owner = body.email === bob.email ? bob : alice;
        return response(stored(owner.id).credentials);
      }
      if (path === "/v1/me") return response(owner);
      if (path === "/v1/preferences")
        return response({
          entryCurrency: "CAD",
          hasActiveAccounts: true,
          defaultAccountId: null
        });
      if (path === "/v1/auth/logout") return response({ ok: true });
      if (path === "/v1/accounts")
        return response({
          items: [
            {
              id:
                owner.id === alice.id
                  ? "70000000-0000-4000-8000-000000000001"
                  : "70000000-0000-4000-8000-000000000002",
              name: "Synthetic cash",
              type: "cash",
              currency: "CAD",
              openingBalanceMinor: 0,
              openingDate: "2024-01-01",
              archivedAt: null,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z"
            }
          ],
          nextCursor: null
        });
      if (path === "/v1/dashboard/summary")
        return response({
          from: request.searchParams.get("from"),
          to: request.searchParams.get("to"),
          currency: request.searchParams.get("currency"),
          incomeMinor: 0,
          expensesMinor: 0,
          netMinor: 0,
          categoryBreakdown: [],
          rootCategoryBreakdown: [],
          recentTransactions: []
        });
      if (path === "/v1/categories/recent")
        return response({
          items: owner.id === alice.id ? [{ ...category, parent: null }] : []
        });
      if (path === "/v1/categories" && delayedCategories) {
        // Entry and category management share this source. Both reads should
        // remain pending until the synthetic response is released.
        return delayedCategories;
      }
      if (path === "/v1/categories")
        return response({
          items: owner.id === alice.id ? [category] : [],
          nextCursor: null
        });
      throw new Error(`Unexpected category-navigation fixture route: ${path}`);
    });
    try {
      await openShell();
      expect(h.fetcher).not.toHaveBeenCalled();
      await field("Email address", alice.email);
      await field("Password", "synthetic password");
      await press("Sign in with email");
      await screen.findByRole("header", { name: "New transaction screen" });
      await tap(screen.getByRole("link", { name: "Overview" }));
      await tap(screen.getByRole("link", { name: "Manage categories" }));
      expect(await screen.findByText(category.name)).toBeVisible();
      expect(screen.queryByText(/Demo only/)).toBeNull();
      await press("Back to previous screen");
      await openSettings();
      await press("User menu");
      await press("Sign out");
      await screen.findByRole("header", { name: "Sign in screen" });
      await field("Email address", bob.email);
      await field("Password", "synthetic password");
      await press("Sign in with email");
      await screen.findByRole("header", { name: "New transaction screen" });
      await tap(screen.getByRole("link", { name: "Overview" }));
      const pending = deferred<Response>();
      delayedCategories = pending.promise;
      await tap(screen.getByRole("link", { name: "Manage categories" }));
      expect(await screen.findByText("Loading categories")).toBeVisible();
      expect(screen.queryByText(category.name)).toBeNull();
      await act(async () => {
        pending.resolve(response({ items: [], nextCursor: null }));
      });
      expect(await screen.findByText("Add your first category.")).toBeVisible();
    } finally {
      if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = originalUrl;
    }
  }, 30000);

  it("shows restoration without exposing either navigation flow", async () => {
    jest.spyOn(sessionModule, "useSession").mockReturnValue({
      session: { status: "restoring" },
      controller: harness(null).controller,
      enterDemo: jest.fn(),
      exitDemo: jest.fn()
    });
    await openShell();
    expect(
      screen.getByRole("header", { name: "Restoring session screen" })
    ).toBeVisible();
    expect(screen.queryByRole("header", { name: "Sign in screen" })).toBeNull();
    expect(
      screen.queryByRole("header", { name: "Overview screen" })
    ).toBeNull();
  });

  it("starts signed out with native authentication unavailable when unconfigured", async () => {
    await openShell();
    expect(shell.getPathname()).toBe("/sign-in");
    expect(screen.getByLabelText("Email address")).toHaveProp(
      "editable",
      false
    );
    expect(screen.getByLabelText("Password")).toHaveProp(
      "secureTextEntry",
      true
    );
    expect(screen.getByLabelText("Password")).toHaveProp("editable", false);
    expect(
      screen.getByRole("button", { name: "Sign in with email" })
    ).toBeDisabled();
    expect(shell.getPathname()).toBe("/sign-in");
    expect(
      screen.getByRole("button", { name: "Continue with Google" })
    ).toBeDisabled();
    expect(shell.getPathname()).toBe("/sign-in");
  });

  it.each(["/", "/transactions", "/categories", "/import", "/settings"])(
    "guards a signed-out deep link to %s",
    async (path) => {
      await openShell(path);
      expect(shell.getPathname()).toBe("/sign-in");
      expect(
        screen.getByRole("header", { name: "Sign in screen" })
      ).toBeVisible();
    }
  );

  it("enters the demo explicitly and removes protected history on exit", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "View transactions" }));
    await navigate(() => router.back());
    expect(shell.getPathname()).toBe("/overview");
    await openSettings();
    await press("User menu");
    await press("Exit demo and return to sign in");
    expect(shell.getPathname()).toBe("/sign-in");
    expect(router.canGoBack()).toBe(false);
    await navigate(() => router.push("/transactions"));
    expect(shell.getPathname()).toBe("/sign-in");
  });

  // Match the other long navigation scenarios without extending individual
  // element lookup deadlines or changing production/demo behavior.
  it("offers the avatar menu during account setup and on every app page", async () => {
    await openShell();
    expect(screen.queryByRole("button", { name: "User menu" })).toBeNull();
    await press("Explore demo screens without signing in");
    await press("Choose currency CAD");
    await press("Confirm CAD permanently");
    expect(
      await screen.findByRole("header", { name: "Set up an account screen" })
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "User menu" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open settings" })).toBeNull();
    await field("Account name", "Menu test account");
    await field("Account opening date (YYYY-MM-DD)", "2024-01-01");
    await press("Create account");
    await screen.findByRole("header", { name: "New transaction screen" });
    for (const path of [
      "/transactions",
      "/categories",
      "/import",
      "/settings",
      "/privacy",
      "/"
    ] as const) {
      await navigate(() => router.replace(path));
      const avatar = await screen.findByRole("button", { name: "User menu" });
      expect(screen.getAllByRole("button", { name: "User menu" })).toHaveLength(
        1
      );
      expect(screen.queryByRole("link", { name: "Open settings" })).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "Exit demo and return to sign in"
        })
      ).toBeNull();
      fireEvent(avatar, "hoverIn");
      expect(screen.getByRole("link", { name: "Open settings" })).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Exit demo and return to sign in" })
      ).toBeVisible();
      fireEvent(avatar, "hoverOut");
      expect(screen.queryByRole("link", { name: "Open settings" })).toBeNull();
    }
    await press("User menu");
    await press("Exit demo and return to sign in");
    expect(shell.getPathname()).toBe("/sign-in");
  }, 15000);

  it("keeps demo categories across navigation and discards them after exit", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Manage categories" }));
    await press("Add category");
    await field("Category name", "Synthetic demo category");
    await press("Save category");
    expect(await screen.findByText("Synthetic demo category")).toBeVisible();
    await press("Back to previous screen");
    await tap(screen.getByRole("link", { name: "Manage categories" }));
    expect(await screen.findByText("Synthetic demo category")).toBeVisible();
    await press("Back to previous screen");
    await openSettings();
    await press("User menu");
    await press("Exit demo and return to sign in");
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Manage categories" }));
    expect(await screen.findByText("Food & Drinks (default)")).toBeVisible();
    expect(screen.queryByText("Synthetic demo category")).toBeNull();
  }, 15000);

  // This complete flow creates category/account data, saves a posting, edits it
  // through details and verifies both overview refreshes. Budget the whole flow
  // like the other long navigation scenarios, keeping per-lookup limits intact.
  it("opens add/detail from the dashboard, retains selection on return and refreshes after edits", async () => {
    await openShell();
    await enterDemo("JPY");
    await tap(screen.getByRole("link", { name: "Manage categories" }));
    await press("Add category");
    await field("Category name", "Dashboard food");
    await press("Save category");
    await screen.findByText("Dashboard food");
    await press("Back to previous screen");
    await navigate(() => router.push("/settings"));
    await field("Account name", "History cash");
    await field("Account opening date (YYYY-MM-DD)", "2024-01-01");
    await press("Create account");
    await navigate(() => router.back());
    await press("Choose month");
    await field("Month (YYYY-MM)", "2024-02");
    await press("Show selected month");

    await press("Add transaction");
    expect(await screen.findByText("New transaction")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose transaction date" })
    ).toHaveProp("accessibilityHint", localDate());
    await chooseTransactionDate("2024-02-01");
    expect(screen.getByLabelText("Account currency: JPY")).toBeVisible();
    await chooseAccount("History cash");
    await field("Amount", "250");
    await field("Note (optional)", "Dashboard shop");
    await chooseCategory("Dashboard food");
    await press("Save transaction");
    await screen.findByRole("header", { name: "History screen" });
    await tap(screen.getByRole("link", { name: "Overview" }));
    expect(await screen.findByLabelText("Net deficit. JPY -250")).toBeVisible();
    expect(screen.getByText("February 2024 · JPY")).toBeVisible();
    await press("View Dashboard shop on 2024-02-01");
    expect(
      await screen.findByRole("header", { name: "Transaction details screen" })
    ).toBeVisible();
    await press("Edit Dashboard shop");
    await field("Amount", "300");
    await press("Update transaction");
    await screen.findByRole("header", { name: "History screen" });
    await tap(screen.getByRole("link", { name: "Overview" }));
    expect(await screen.findByLabelText("Net deficit. JPY -300")).toBeVisible();
  }, 15000);

  it("clears dashboard amounts and rejects a pending old-account summary on logout", async () => {
    const h = harness();
    jest.mocked(runtime.createRuntimeSession).mockReturnValue(h.controller);
    const pending = deferred<Response>();
    let delayed = false;
    h.fetcher.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/v1/me") return response(alice);
      if (parsed.pathname === "/v1/preferences")
        return response({
          entryCurrency: "USD",
          hasActiveAccounts: true,
          defaultAccountId: null
        });
      if (parsed.pathname === "/v1/auth/logout") return response({ ok: true });
      if (parsed.pathname === "/v1/dashboard/summary") {
        if (delayed) return pending.promise;
        return response({
          from: parsed.searchParams.get("from"),
          to: parsed.searchParams.get("to"),
          currency: "USD",
          incomeMinor: 12345,
          expensesMinor: 0,
          netMinor: 12345,
          categoryBreakdown: [
            {
              categoryId: "20000000-0000-4000-8000-000000000001",
              categoryName: "Private category",
              incomeMinor: 12345,
              expensesMinor: 0,
              netMinor: 12345
            }
          ],
          recentTransactions: []
        });
      }
      return response({ items: [], nextCursor: null });
    });
    await openShell("/overview");
    expect(await screen.findByLabelText("Income. USD 123.45")).toBeVisible();
    delayed = true;
    await press("Refresh summary");
    await openSettings();
    await press("User menu");
    await press("Sign out");
    await screen.findByRole("header", { name: "Sign in screen" });
    await enterDemo();
    await act(async () => {
      pending.resolve(response({ private: "late old-account data" }));
    });
    expect(await screen.findByText("No transactions this month")).toBeVisible();
    expect(screen.queryByLabelText("Income. USD 123.45")).toBeNull();
    expect(screen.queryByText("Private category")).toBeNull();
  });

  it("rejects malformed add links without echoing external values", async () => {
    await openShell();
    await enterDemo();
    await navigate(() =>
      router.push(
        "/transactions?action=add&date=private-invalid-value&currency=USD"
      )
    );
    expect(
      await screen.findByText("Invalid add transaction request")
    ).toBeVisible();
    expect(screen.queryByText(/private-invalid-value/)).toBeNull();
    await press("Back to previous screen");
    expect(
      screen.getByRole("header", { name: "Overview screen" })
    ).toBeVisible();
  }, 15000);

  it("applies the session currency to dashboard/new forms and resets it when leaving demo", async () => {
    await openShell();
    await enterDemo("KWD");
    await openSettings();
    await press("Privacy and data retention");
    expect(
      await screen.findByRole("header", {
        name: "Privacy and data retention screen"
      })
    ).toBeVisible();
    expect(screen.getByText(/no automatic retention expiry/)).toBeVisible();
    await press("Back to Settings");
    expect(screen.getByText("Default currency: KWD")).toBeVisible();
    await tap(screen.getByRole("link", { name: "Overview" }));
    expect(
      await screen.findByLabelText("Net balanced. KWD 0.000")
    ).toBeVisible();
    await tap(screen.getByRole("link", { name: "View transactions" }));
    await press("Add transaction");
    expect(screen.getByLabelText("Account currency: KWD")).toBeVisible();
    await tap(screen.getByRole("link", { name: "Overview" }));
    await openSettings();
    await press("User menu");
    await press("Exit demo and return to sign in");
    // A pristine Add view does not create a dirty draft.
    await enterDemo();
    expect(
      await screen.findByLabelText("Net balanced. CAD 0.00")
    ).toBeVisible();
  }, 15000);

  it("signs out all devices from Settings, clears navigation and displays unconfirmed revocation honestly", async () => {
    const h = harness();
    jest.mocked(runtime.createRuntimeSession).mockReturnValue(h.controller);
    h.fetcher.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/me") return response(alice);
      if (path === "/v1/auth/logout") throw new Error("offline");
      return response({ items: [], nextCursor: null });
    });
    await openShell("/settings");
    expect(screen.getByText("Google: not linked")).toBeVisible();
    await press("Sign out on all devices");
    await press("Confirm sign out on all devices");
    expect(
      await screen.findByRole("header", { name: "Sign in screen" })
    ).toBeVisible();
    expect(
      screen.getByText(/Sign-out on all devices could not be confirmed/)
    ).toBeVisible();
    expect(h.disk()).toBeNull();
    expect(router.canGoBack()).toBe(false);
  });
});

describe("screen state previews", () => {
  it.each([
    ["Categories", "Manage categories", "Food & Drinks (default)"],
    ["CSV import", "Preview CSV import", "Nothing here yet"]
  ])(
    "provides a labeled %s screen and recoverable state previews",
    async (title, link, readyText) => {
      await openShell();
      await enterDemo();
      if (link) await tap(screen.getByRole("link", { name: link }));
      expect(
        screen.getByRole("header", { name: `${title} screen` })
      ).toBeVisible();
      expect(screen.getByText(/Demo only/)).toBeVisible();
      expect(await screen.findByText(readyText)).toBeVisible();
      await press("Preview loading state");
      expect(screen.getByLabelText(/Loading preview\./)).toHaveProp(
        "accessibilityState",
        { busy: true }
      );
      await press("Preview error state");
      expect(screen.getByRole("alert")).toBeVisible();
      await press("Try again");
      expect(await screen.findByText(readyText)).toBeVisible();
      if (link) {
        await press("Back to previous screen");
        expect(
          screen.getByRole("header", { name: "Overview screen" })
        ).toBeVisible();
      }
    },
    15000
  );

  it("rejects an external invalid query and recovers without echoing it", async () => {
    await openShell();
    await enterDemo();
    await navigate(() => router.push("/import?state=unexpected-value"));
    expect(screen.getByText("Invalid preview state")).toBeVisible();
    expect(screen.queryByText(/unexpected-value/)).toBeNull();
    await press("Try again");
    expect(screen.getByText("Nothing here yet")).toBeVisible();
  });

  it("catches a real render failure and remounts a usable Settings screen", async () => {
    await openShell();
    await enterDemo();
    await openSettings();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create account" })
      ).toBeEnabled()
    );
    // React's expected development diagnostic contains only the synthetic error.
    const diagnostic = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await press("Preview rendering error recovery");
    expect(
      screen.getByRole("header", { name: "Something went wrong screen" })
    ).toBeVisible();
    expect(screen.queryByText(/Synthetic rendering failure/)).toBeNull();
    await press("Try again");
    expect(
      screen.getByRole("header", { name: "Settings screen" })
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create account" })
      ).toBeEnabled()
    );
    diagnostic.mockRestore();
    await press("User menu");
    await press("Exit demo and return to sign in");
    expect(shell.getPathname()).toBe("/sign-in");
  }, 15000);

  it("recovers from an unknown route", async () => {
    await openShell("/unknown-screen");
    expect(
      screen.getByRole("header", { name: "Page not found screen" })
    ).toBeVisible();
    await tap(screen.getByRole("link", { name: "Return to start" }));
    expect(shell.getPathname()).toBe("/sign-in");
  });
});

describe("transfer navigation", () => {
  it("uses the shared form, retains its draft during account creation, and manages one whole transfer", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Add" }));
    await press("Transfer");
    expect(
      screen.queryByRole("button", { name: "Choose category" })
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review transfer" })
    ).toBeDisabled();
    await field("Amount", "25");
    await field("Note (optional)", "Cash move");
    await press("Choose From Account");
    await press("Account: Demo setup cash");
    await press("Choose To Account");
    expect(
      screen.queryByRole("button", { name: "Account: Demo setup cash" })
    ).toBeNull();
    await press("Add an account in Settings");
    await field("Account name", "Savings");
    await field("Account opening date (YYYY-MM-DD)", "2024-01-01");
    await press("Create account");
    await press("Return to transaction draft");
    expect(await screen.findByLabelText("Amount")).toHaveProp("value", "25");
    expect(screen.getByLabelText("Note (optional)")).toHaveProp(
      "value",
      "Cash move"
    );
    await press("Choose To Account");
    await press("Account: Savings");
    await press("Review transfer");
    expect(screen.getByText("From Account: Demo setup cash")).toBeVisible();
    expect(screen.getByText("To Account: Savings")).toBeVisible();
    expect(screen.getByText("Amount: 25.00 CAD")).toBeVisible();
    await press("Return to transfer draft");
    expect(screen.getByLabelText("Amount")).toHaveProp("value", "25");
    await press("Review transfer");
    await press("Confirm transfer");
    await screen.findByRole("header", { name: "History screen" });
    await press("View transfer: Cash move");
    expect(
      await screen.findByRole("header", { name: "Transfer details screen" })
    ).toBeVisible();
    expect(
      await screen.findByText(/From tracked balance.*-25.00 CAD/)
    ).toBeVisible();
    expect(screen.getByText(/To tracked balance.*25.00 CAD/)).toBeVisible();
    await press("Edit transfer");
    expect(
      await screen.findByRole("header", { name: "Edit transfer screen" })
    ).toBeVisible();
    await field("Amount", "30");
    await press("Review transfer");
    await press("Confirm transfer changes");
    await screen.findByRole("header", { name: "History screen" });
    await press("View transfer: Cash move");
    expect(
      await screen.findByText(/From tracked balance.*-30.00 CAD/)
    ).toBeVisible();
    await press("Delete transfer");
    await press("Keep transfer");
    expect(screen.getByRole("button", { name: "Edit transfer" })).toBeEnabled();
    await press("Delete transfer");
    await press("Confirm delete transfer");
    expect(
      await screen.findByText(
        /This transfer is unavailable or has been deleted/
      )
    ).toBeVisible();
    await tap(screen.getByRole("link", { name: "History" }));
    expect(await screen.findByText("No transfers yet.")).toBeVisible();
    await tap(screen.getByRole("link", { name: "Overview" }));
    expect(await screen.findByLabelText("Income. CAD 0.00")).toBeVisible();
    expect(screen.getByLabelText("Expenses. CAD 0.00")).toBeVisible();
  }, 20000);
});

describe("external preview parameter validation", () => {
  it.each(["loading", "empty", "error"])("accepts %s", (value) => {
    expect(parsePreviewState(value)).toBe(value);
  });
  it("defaults an absent value to empty", () => {
    expect(parsePreviewState(undefined)).toBe("empty");
  });
  it.each(["unknown", "", 42, ["empty", "error"], null])(
    "rejects %j",
    (value) => {
      expect(parsePreviewState(value)).toBeNull();
    }
  );
});

jest.mock("expo-crypto", () => {
  let sequence = 0;
  return {
    randomUUID: () =>
      "90000000-0000-4000-8000-" + String(++sequence).padStart(12, "0")
  };
});
