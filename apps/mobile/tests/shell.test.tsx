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
  screen
} from "expo-router/testing-library";
import { router } from "expo-router";
import { parsePreviewState } from "../src/navigation";
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
  const button = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.press(button);
  });
}

async function tap(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

async function enterDemo() {
  await press("Explore demo screens without signing in");
  expect(
    screen.getByRole("header", { name: "Dashboard screen" })
  ).toBeVisible();
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("session navigation", () => {
  it("keeps a gated demo draft unchanged across Settings and locks currency after saving", async () => {
    const prior = process.env.EXPO_PUBLIC_FINANCE_CURRENCY_ENABLED;
    process.env.EXPO_PUBLIC_FINANCE_CURRENCY_ENABLED = "true";
    try {
      await openShell();
      await enterDemo();
      await tap(screen.getByRole("link", { name: "Manage categories" }));
      await press("Add category");
      await fireEvent.changeText(
        screen.getByLabelText("Category name"),
        "Currency food"
      );
      await press("Save category");
      await screen.findByText("Currency food");
      await press("Back to dashboard");
      await press("Add transaction");
      await screen.findByText("New transaction");
      expect(screen.getByText("Currency: CAD")).toBeVisible();
      expect(screen.queryByRole("button", { name: "Currency USD" })).toBeNull();
      await fireEvent.changeText(screen.getByLabelText("Amount"), "12.34");
      await act(() => router.push("/settings"));
      await press("Default currency EUR");
      await act(() => router.back());
      expect(screen.getByText("Currency: CAD")).toBeVisible();
      expect(screen.getByLabelText("Amount")).toHaveProp("value", "12.34");
      expect(
        screen.getByRole("button", { name: "Save transaction" })
      ).toBeDisabled();
      await press("Discard draft and start in EUR");
      expect(screen.getByLabelText("Amount")).toHaveProp("value", "");
      expect(screen.getByText("Currency: EUR")).toBeVisible();
      await fireEvent.changeText(screen.getByLabelText("Amount"), "5.67");
      await fireEvent.changeText(
        screen.getByLabelText("Merchant or payee"),
        "Currency demo"
      );
      await press("Category: Currency food");
      await press("Save transaction");
      await screen.findByText(/Transaction saved/);
      await act(() => router.push("/settings"));
      expect(
        await screen.findByText(
          "Currency is locked after the first saved transaction."
        )
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Default currency CAD" })
      ).toBeDisabled();
    } finally {
      if (prior === undefined)
        delete process.env.EXPO_PUBLIC_FINANCE_CURRENCY_ENABLED;
      else process.env.EXPO_PUBLIC_FINANCE_CURRENCY_ENABLED = prior;
    }
  });

  it("keeps protected data hidden during an outage and retries verification", async () => {
    const h = harness();
    h.fetcher.mockRejectedValueOnce(new Error("private transport error"));
    h.fetcher
      .mockResolvedValueOnce(response(alice))
      .mockResolvedValueOnce(response({ items: [], nextCursor: null }));
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

  it("connects categories only after login and clears visible data and pending reads on account change", async () => {
    const originalUrl = process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.invalid";
    const h = harness(null);
    jest.mocked(runtime.createRuntimeSession).mockReturnValue(h.controller);
    let owner = alice;
    const category = {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Alice private category",
      isDefault: false,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    };
    h.fetcher.mockImplementation(async (url, options) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/auth/login") {
        const body = JSON.parse(String(options?.body)) as { email: string };
        owner = body.email === bob.email ? bob : alice;
        return response(stored(owner.id).credentials);
      }
      if (path === "/v1/me") return response(owner);
      if (path === "/v1/auth/logout") return response({ ok: true });
      return response({
        items: owner.id === alice.id ? [category] : [],
        nextCursor: null
      });
    });
    try {
      await openShell();
      await fireEvent.changeText(
        screen.getByLabelText("Email address"),
        alice.email
      );
      await fireEvent.changeText(
        screen.getByLabelText("Password"),
        "synthetic password"
      );
      await press("Sign in with email");
      await screen.findByRole("header", { name: "Dashboard screen" });
      await tap(screen.getByRole("link", { name: "Manage categories" }));
      expect(await screen.findByText(category.name)).toBeVisible();
      expect(screen.queryByText(/Demo only/)).toBeNull();
      await press("Back to dashboard");
      await tap(screen.getByRole("link", { name: "Open settings" }));
      await press("Sign out");
      await screen.findByRole("header", { name: "Sign in screen" });
      await fireEvent.changeText(
        screen.getByLabelText("Email address"),
        bob.email
      );
      await fireEvent.changeText(
        screen.getByLabelText("Password"),
        "synthetic password"
      );
      await press("Sign in with email");
      await screen.findByRole("header", { name: "Dashboard screen" });
      const pending = deferred<Response>();
      h.fetcher.mockReturnValueOnce(pending.promise);
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
  });

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
      screen.queryByRole("header", { name: "Dashboard screen" })
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
    await act(() => router.back());
    expect(shell.getPathname()).toBe("/");
    await tap(screen.getByRole("link", { name: "Open settings" }));
    await press("Exit demo and return to sign in");
    expect(shell.getPathname()).toBe("/sign-in");
    expect(router.canGoBack()).toBe(false);
    await act(() => router.push("/transactions"));
    expect(shell.getPathname()).toBe("/sign-in");
  });

  it("keeps demo categories across navigation and discards them after exit", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Manage categories" }));
    await press("Add category");
    await fireEvent.changeText(
      screen.getByLabelText("Category name"),
      "Synthetic demo category"
    );
    await press("Save category");
    expect(await screen.findByText("Synthetic demo category")).toBeVisible();
    await press("Back to dashboard");
    await tap(screen.getByRole("link", { name: "Manage categories" }));
    expect(await screen.findByText("Synthetic demo category")).toBeVisible();
    await press("Back to dashboard");
    await tap(screen.getByRole("link", { name: "Open settings" }));
    await press("Exit demo and return to sign in");
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Manage categories" }));
    expect(screen.queryByText("Synthetic demo category")).toBeNull();
  });

  it("opens add/detail from the dashboard, retains selection on return and refreshes after edits", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Manage categories" }));
    await press("Add category");
    await fireEvent.changeText(
      screen.getByLabelText("Category name"),
      "Dashboard food"
    );
    await press("Save category");
    await screen.findByText("Dashboard food");
    await press("Back to dashboard");
    await press("Choose month");
    await fireEvent.changeText(
      screen.getByLabelText("Month (YYYY-MM)"),
      "2024-02"
    );
    await press("Show selected month");
    await press("Change currency (USD)");
    await press("Summary currency JPY");
    await press("Add transaction");
    expect(await screen.findByText("New transaction")).toBeVisible();
    expect(screen.getByLabelText("Transaction date (YYYY-MM-DD)")).toHaveProp(
      "value",
      "2024-02-01"
    );
    expect(screen.getByRole("button", { name: "Currency JPY" })).toHaveProp(
      "accessibilityState",
      expect.objectContaining({ selected: true })
    );
    await fireEvent.changeText(screen.getByLabelText("Amount"), "250");
    await fireEvent.changeText(
      screen.getByLabelText("Merchant or payee"),
      "Dashboard shop"
    );
    await press("Category: Dashboard food");
    await press("Save transaction");
    await screen.findByText(/Transaction saved/);
    await press("Back to dashboard");
    expect(await screen.findByLabelText("Net deficit. JPY -250")).toBeVisible();
    expect(screen.getByText("February 2024 · JPY")).toBeVisible();
    await press("View Dashboard shop on 2024-02-01");
    expect(
      await screen.findByRole("header", { name: "Transaction details screen" })
    ).toBeVisible();
    await press("Edit Dashboard shop");
    await fireEvent.changeText(screen.getByLabelText("Amount"), "300");
    await press("Save transaction");
    await screen.findByText(/Transaction saved/);
    await press("Back to previous screen");
    expect(await screen.findByLabelText("Net deficit. JPY -300")).toBeVisible();
  });

  it("clears dashboard amounts and rejects a pending old-account summary on logout", async () => {
    const h = harness();
    jest.mocked(runtime.createRuntimeSession).mockReturnValue(h.controller);
    const pending = deferred<Response>();
    let delayed = false;
    h.fetcher.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/v1/me") return response(alice);
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
    await openShell();
    expect(await screen.findByLabelText("Income. USD 123.45")).toBeVisible();
    delayed = true;
    await press("Refresh summary");
    await tap(screen.getByRole("link", { name: "Open settings" }));
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
    await act(() =>
      router.push(
        "/transactions?action=add&date=private-invalid-value&currency=USD"
      )
    );
    expect(
      await screen.findByText("Invalid add transaction request")
    ).toBeVisible();
    expect(screen.queryByText(/private-invalid-value/)).toBeNull();
    await press("Back to dashboard");
    expect(
      screen.getByRole("header", { name: "Dashboard screen" })
    ).toBeVisible();
  });

  it("applies the session currency to dashboard/new forms and resets it when leaving demo", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Open settings" }));
    await press("Default currency KWD");
    await press("Privacy and data retention");
    expect(
      await screen.findByRole("header", {
        name: "Privacy and data retention screen"
      })
    ).toBeVisible();
    expect(screen.getByText(/no automatic retention expiry/)).toBeVisible();
    await press("Back to Settings");
    expect(screen.getByText("Default currency: KWD")).toBeVisible();
    await press("Back to dashboard");
    expect(
      await screen.findByLabelText("Net balanced. KWD 0.000")
    ).toBeVisible();
    await tap(screen.getByRole("link", { name: "View transactions" }));
    await press("Add transaction");
    expect(screen.getByRole("button", { name: "Currency KWD" })).toHaveProp(
      "accessibilityState",
      expect.objectContaining({ selected: true })
    );
    await press("Back to dashboard");
    await tap(screen.getByRole("link", { name: "Open settings" }));
    await press("Exit demo and return to sign in");
    await enterDemo();
    expect(
      await screen.findByLabelText("Net balanced. USD 0.00")
    ).toBeVisible();
  });

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

describe("placeholder screens", () => {
  it.each([
    ["Categories", "Manage categories"],
    ["CSV import", "Preview CSV import"]
  ])(
    "provides a labeled %s screen and recoverable state previews",
    async (title, link) => {
      await openShell();
      await enterDemo();
      if (link) await tap(screen.getByRole("link", { name: link }));
      expect(
        screen.getByRole("header", { name: `${title} screen` })
      ).toBeVisible();
      expect(screen.getByText(/Demo only/)).toBeVisible();
      expect(await screen.findByText("Nothing here yet")).toBeVisible();
      await press("Preview loading state");
      expect(screen.getByLabelText(/Loading preview\./)).toHaveProp(
        "accessibilityState",
        { busy: true }
      );
      await press("Preview error state");
      expect(screen.getByRole("alert")).toBeVisible();
      await press("Try again");
      expect(await screen.findByText("Nothing here yet")).toBeVisible();
      if (link) {
        await press("Back to dashboard");
        expect(
          screen.getByRole("header", { name: "Dashboard screen" })
        ).toBeVisible();
      }
    }
  );

  it("rejects an external invalid query and recovers without echoing it", async () => {
    await openShell();
    await enterDemo();
    await act(() => router.push("/import?state=unexpected-value"));
    expect(screen.getByText("Invalid preview state")).toBeVisible();
    expect(screen.queryByText(/unexpected-value/)).toBeNull();
    await press("Try again");
    expect(screen.getByText("Nothing here yet")).toBeVisible();
  });

  it("catches a real render failure and remounts a usable Settings screen", async () => {
    await openShell();
    await enterDemo();
    await tap(screen.getByRole("link", { name: "Open settings" }));
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
    diagnostic.mockRestore();
    await press("Exit demo and return to sign in");
    expect(shell.getPathname()).toBe("/sign-in");
  });

  it("recovers from an unknown route", async () => {
    await openShell("/unknown-screen");
    expect(
      screen.getByRole("header", { name: "Page not found screen" })
    ).toBeVisible();
    await tap(screen.getByRole("link", { name: "Return to start" }));
    expect(shell.getPathname()).toBe("/sign-in");
  });
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
