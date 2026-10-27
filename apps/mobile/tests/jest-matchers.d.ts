import type { JestNativeMatchers } from "@testing-library/react-native/build/matchers/types";

// Imported Jest assertions use `expect`'s interface; RNTL 13 augments @jest/expect.
declare module "expect" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Merge native matchers into Jest's existing interface.
  interface Matchers<
    R extends void | Promise<void>
  > extends JestNativeMatchers<R> {}
}
