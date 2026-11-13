import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest
} from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import SignInScreen from "../src/app/sign-in";
import * as session from "../src/session";
import { ClientFailure } from "../src/auth/transport";
import { deferred, harness } from "./auth-fixtures";

const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.example.invalid";
  jest.replaceProperty(Platform, "OS", "ios");
});
afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  jest.restoreAllMocks();
});

function open() {
  const controller = harness(null).controller;
  const signIn = jest.spyOn(controller, "signIn").mockResolvedValue(undefined);
  const enterDemo = jest.fn();
  jest.spyOn(session, "useSession").mockReturnValue({
    session: { status: "signed-out" },
    controller,
    enterDemo,
    exitDemo: jest.fn()
  });
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 24, right: 0, bottom: 34, left: 0 }
      }}
    >
      <SignInScreen />
    </SafeAreaProvider>
  );
  return { signIn, enterDemo };
}
async function press(name: string) {
  await act(async () => fireEvent.press(screen.getByRole("button", { name })));
}
async function credentials(password = "synthetic password") {
  await act(async () => {
    fireEvent.changeText(
      screen.getByLabelText("Email address"),
      "test@example.invalid"
    );
    fireEvent.changeText(screen.getByLabelText("Password"), password);
  });
}

describe("sign-in presentation and controls", () => {
  it("keeps the brand and accessible fields, and toggles password visibility", async () => {
    open();
    expect(screen.getByText("PocketLedger")).toBeVisible();
    expect(
      screen.getByRole("header", { name: "Sign in screen" })
    ).toBeVisible();
    await credentials();
    expect(screen.getByLabelText("Password")).toHaveProp(
      "secureTextEntry",
      true
    );
    await press("Show password");
    expect(screen.getByLabelText("Password")).toHaveProp(
      "secureTextEntry",
      false
    );
    expect(screen.getByLabelText("Password")).toHaveProp(
      "value",
      "synthetic password"
    );
    await press("Hide password");
    expect(screen.getByLabelText("Password")).toHaveProp(
      "secureTextEntry",
      true
    );
  });

  it.each(["Sign in with email", "Create account with email"])(
    "preserves the %s action and clears the submitted password",
    async (button) => {
      const { signIn } = open();
      await credentials();
      await press(button);
      expect(signIn).toHaveBeenCalledWith(
        button.startsWith("Create") ? "register" : "login",
        "test@example.invalid",
        "synthetic password"
      );
      expect(screen.getByLabelText("Password")).toHaveProp("value", "");
      expect(screen.getByLabelText("Password")).toHaveProp(
        "secureTextEntry",
        true
      );
    }
  );

  it("retains Google sign-in and demo entry", async () => {
    const { signIn, enterDemo } = open();
    await press("Continue with Google");
    expect(signIn).toHaveBeenCalledWith("google", "", "");
    await press("Explore demo screens without signing in");
    expect(enterDemo).toHaveBeenCalledTimes(1);
  });

  it("keeps input for local validation failures and displays sign-in errors", async () => {
    const { signIn } = open();
    await credentials("short");
    await press("Create account with email");
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Password")).toHaveProp("value", "short");
    expect(screen.getByText("Sign-in unavailable")).toBeVisible();
    signIn.mockRejectedValueOnce(new ClientFailure("invalid"));
    await press("Sign in with email");
    expect(screen.getByText("Sign-in unavailable")).toBeVisible();
    expect(screen.getByLabelText("Password")).toHaveProp("value", "");
  });

  it("locks the form while submitting and prevents duplicate requests", async () => {
    const pending = deferred<void>();
    const { signIn } = open();
    signIn.mockReturnValueOnce(pending.promise);
    await credentials();
    await press("Sign in with email");
    expect(screen.getByLabelText("Email address")).toHaveProp(
      "editable",
      false
    );
    expect(
      screen.getByRole("button", { name: "Show password" })
    ).toBeDisabled();
    await press("Sign in with email");
    expect(signIn).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    expect(
      screen.getByRole("button", { name: "Sign in with email" })
    ).toBeEnabled();
  });

  it("keeps unconfigured authentication disabled while the demo stays available", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    const { enterDemo } = open();
    expect(screen.getByLabelText("Email address")).toHaveProp(
      "editable",
      false
    );
    expect(
      screen.getByRole("button", { name: "Sign in with email" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Continue with Google" })
    ).toBeDisabled();
    await press("Explore demo screens without signing in");
    expect(enterDemo).toHaveBeenCalledTimes(1);
  });
});
