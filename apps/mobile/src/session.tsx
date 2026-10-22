import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren
} from "react";

// This is navigation state, never proof of authentication.
export type ShellSession =
  | { status: "restoring" }
  | { status: "signed-out" }
  | { status: "authenticated"; mode: "demo" };

const SessionContext = createContext<{
  session: ShellSession;
  enterDemo: () => void;
  exitDemo: () => void;
} | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<ShellSession>({ status: "restoring" });

  useEffect(() => {
    // No credentials exist in this shell. Issue #11 replaces this with secure
    // restoration and server validation, including an explicit retry state.
    setSession({ status: "signed-out" });
  }, []);

  return (
    <SessionContext.Provider
      value={{
        session,
        enterDemo: () => setSession({ status: "authenticated", mode: "demo" }),
        exitDemo: () => setSession({ status: "signed-out" })
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("SessionProvider is required.");
  return context;
}
