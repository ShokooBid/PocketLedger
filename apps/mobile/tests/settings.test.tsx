import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Settings, PrivacyInformation } from "../src/settings";
import type { SessionController } from "../src/auth/session-controller";
import { alice, deferred } from "./auth-fixtures";
import { ClientFailure } from "../src/auth/transport";

function fixture() {
  return {
    user: alice,
    controller: {
      linkGoogle: jest
        .fn<SessionController["linkGoogle"]>()
        .mockResolvedValue("linked"),
      refreshAccount: jest
        .fn<SessionController["refreshAccount"]>()
        .mockResolvedValue(),
      logout: jest.fn<SessionController["logout"]>().mockResolvedValue()
    },
    defaultCurrency: "USD" as const,
    setDefaultCurrency: jest.fn(),
    version: "0.1.0",
    onPrivacy: jest.fn(),
    onExitDemo: jest.fn()
  };
}
async function press(label: string) {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: label }));
  });
}
async function password() {
  await press("Link Google");
  await act(async () => {
    fireEvent.changeText(
      screen.getByLabelText("Current PocketLedger password"),
      "synthetic password"
    );
  });
}
describe("settings account controls", () => {
  it("shows methods, version and read-only timezone policy without unsupported controls", async () => {
    const props = fixture();
    render(<Settings {...props} />);
    expect(screen.getByText("Email/password: available")).toBeVisible();
    expect(screen.getByText("Google: not linked")).toBeVisible();
    expect(screen.getByText("App version: 0.1.0")).toBeVisible();
    expect(
      screen.getByText(/Saved accounting dates never shift/)
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: /unlink|add password|reset password/i
      })
    ).toBeNull();
    await press("Default currency KWD");
    expect(props.setDefaultCurrency).toHaveBeenCalledWith("KWD");
    await press("Privacy and data retention");
    expect(props.onPrivacy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/response target has not been established/)
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /delete|email|draft/i })
    ).toBeNull();
  });
  it("clears password immediately, locks linking and reports a confirmed link", async () => {
    const props = fixture();
    const pending = deferred<"linked" | "cancelled">();
    props.controller.linkGoogle.mockReturnValueOnce(pending.promise);
    render(<Settings {...props} />);
    await password();
    await press("Verify password and choose Google account");
    expect(screen.getByLabelText("Current PocketLedger password")).toHaveProp(
      "value",
      ""
    );
    expect(
      screen.getByRole("button", {
        name: "Verify password and choose Google account"
      })
    ).toBeDisabled();
    expect(props.controller.linkGoogle).toHaveBeenCalledTimes(1);
    expect(props.controller.linkGoogle).toHaveBeenCalledWith(
      "synthetic password"
    );
    await act(async () => {
      pending.resolve("linked");
    });
    expect(
      screen.getByText(/Google linked\. Your account and ledger are unchanged/)
    ).toBeVisible();
  });
  it("blocks an uncertain link until a successful status read without leaking raw errors", async () => {
    const props = fixture();
    props.controller.linkGoogle.mockRejectedValueOnce(
      new Error("private-token-and-ledger")
    );
    props.controller.refreshAccount.mockRejectedValueOnce(
      new ClientFailure("network")
    );
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const warnLog = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(<Settings {...props} />);
      await password();
      await press("Verify password and choose Google account");
      expect(screen.queryByText(/private-token/)).toBeNull();
      expect(
        screen.getByRole("button", { name: "Link Google" })
      ).toBeDisabled();
      await press("Reload account status");
      expect(
        screen.getByRole("button", { name: "Link Google" })
      ).toBeDisabled();
      await press("Reload account status");
      expect(screen.getByRole("button", { name: "Link Google" })).toBeEnabled();
      expect(errorLog).not.toHaveBeenCalled();
      expect(warnLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
      warnLog.mockRestore();
    }
  });
  it("handles cancellation and Google-only/linked accounts without password or unlink actions", async () => {
    const props = fixture();
    props.controller.linkGoogle.mockResolvedValueOnce("cancelled");
    const view = render(<Settings {...props} />);
    await password();
    await press("Verify password and choose Google account");
    expect(screen.getByText(/Google linking was cancelled/)).toBeVisible();
    view.rerender(
      <Settings
        {...props}
        user={{ ...alice, methods: { password: false, google: true } }}
      />
    );
    expect(screen.getByText("Email/password: not configured")).toBeVisible();
    expect(screen.getByText("Google: linked")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Link Google" })).toBeNull();
  });
  it("confirms all-device logout separately and leaves current logout available", async () => {
    const props = fixture();
    render(<Settings {...props} />);
    await press("Sign out on all devices");
    expect(props.controller.logout).not.toHaveBeenCalled();
    await press("Cancel all-device sign out");
    expect(props.controller.logout).not.toHaveBeenCalled();
    await press("Sign out on all devices");
    await press("Confirm sign out on all devices");
    expect(props.controller.logout).toHaveBeenLastCalledWith(true);
    await press("Sign out");
    expect(props.controller.logout).toHaveBeenLastCalledWith(false);
  });
  it("keeps demo separate and explains retention without claiming deletion", async () => {
    const props = fixture();
    const view = render(<Settings {...props} user={null} />);
    expect(screen.getByText(/Demo only/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    await press("Exit demo and return to sign in");
    expect(props.onExitDemo).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<PrivacyInformation />);
    expect(screen.getByText(/no automatic retention expiry/)).toBeVisible();
    expect(screen.getByText(/does not delete server records/)).toBeVisible();
    expect(screen.getByLabelText(/Deletion support email/)).toBeVisible();
    expect(screen.getByText(/No email is sent or drafted/)).toBeVisible();
  });
});
