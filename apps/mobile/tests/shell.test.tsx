import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  renderRouter,
  screen
} from "expo-router/testing-library";
import { router } from "expo-router";
import { parsePreviewState } from "../src/navigation";
import * as sessionModule from "../src/session";

let shell: Awaited<ReturnType<typeof renderRouter>>;

async function openShell(initialUrl = "/") {
  shell = await renderRouter("./src/app", { initialUrl });
  return shell;
}

async function press(name: string) {
  await fireEvent.press(screen.getByRole("button", { name }));
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
  it("shows restoration without exposing either navigation flow", async () => {
    jest.spyOn(sessionModule, "useSession").mockReturnValue({
      session: { status: "restoring" },
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

  it("starts signed out and keeps both login placeholders honest", async () => {
    await openShell();
    expect(shell.getPathname()).toBe("/sign-in");
    expect(screen.getByLabelText("Email address (preview only)")).toHaveProp(
      "editable",
      false
    );
    expect(screen.getByLabelText("Password (preview only)")).toHaveProp(
      "secureTextEntry",
      true
    );
    expect(screen.getByLabelText("Password (preview only)")).toHaveProp(
      "editable",
      false
    );
    await press("Sign in with email (preview only)");
    expect(
      screen.getByText(/Email and password sign-in is not connected/)
    ).toBeVisible();
    expect(shell.getPathname()).toBe("/sign-in");
    await press("Continue with Google (preview only)");
    expect(screen.getByText(/Google sign-in is not connected/)).toBeVisible();
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
    await fireEvent.press(
      screen.getByRole("link", { name: "View transactions" })
    );
    await act(() => router.back());
    expect(shell.getPathname()).toBe("/");
    await fireEvent.press(screen.getByRole("link", { name: "Open settings" }));
    await press("Exit demo and return to sign in");
    expect(shell.getPathname()).toBe("/sign-in");
    expect(router.canGoBack()).toBe(false);
    await act(() => router.push("/transactions"));
    expect(shell.getPathname()).toBe("/sign-in");
  });
});

describe("placeholder screens", () => {
  it.each([
    ["Dashboard", null],
    ["Transactions", "View transactions"],
    ["Categories", "Manage categories"],
    ["CSV import", "Preview CSV import"],
    ["Settings", "Open settings"]
  ])(
    "provides a labeled %s screen and recoverable state previews",
    async (title, link) => {
      await openShell();
      await enterDemo();
      if (link) await fireEvent.press(screen.getByRole("link", { name: link }));
      expect(
        screen.getByRole("header", { name: `${title} screen` })
      ).toBeVisible();
      expect(screen.getByText(/Demo only/)).toBeVisible();
      expect(screen.getByText("Nothing here yet")).toBeVisible();
      await press("Preview loading state");
      expect(screen.getByLabelText(/Loading preview\./)).toHaveProp(
        "accessibilityState",
        { busy: true }
      );
      await press("Preview error state");
      expect(screen.getByRole("alert")).toBeVisible();
      await press("Try again");
      expect(screen.getByText("Nothing here yet")).toBeVisible();
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
    await act(() => router.push("/transactions?state=unexpected-value"));
    expect(screen.getByText("Invalid preview state")).toBeVisible();
    expect(screen.queryByText(/unexpected-value/)).toBeNull();
    await press("Try again");
    expect(screen.getByText("Nothing here yet")).toBeVisible();
  });

  it("catches a real render failure and remounts a usable Settings screen", async () => {
    await openShell();
    await enterDemo();
    await fireEvent.press(screen.getByRole("link", { name: "Open settings" }));
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
    await fireEvent.press(
      screen.getByRole("link", { name: "Return to start" })
    );
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
