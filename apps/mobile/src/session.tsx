import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren
} from "react";
import { createRuntimeSession } from "./auth/runtime";
import type { SessionController } from "./auth/session-controller";
export type { SessionState as ShellSession } from "./auth/session-controller";

const SessionContext = createContext<SessionController | null>(null);
export function SessionProvider({
  children,
  controller
}: PropsWithChildren<{ controller?: SessionController }>) {
  const [sessionController] = useState(
    () => controller ?? createRuntimeSession()
  );
  useEffect(() => {
    void sessionController.restore();
  }, [sessionController]);
  return (
    <SessionContext.Provider value={sessionController}>
      {children}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const controller = useContext(SessionContext);
  if (!controller) throw new Error("SessionProvider is required.");
  const session = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  return {
    session,
    controller,
    enterDemo: controller.enterDemo,
    exitDemo: controller.exitDemo
  };
}
