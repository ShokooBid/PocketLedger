import { z } from "zod";

// Match the database's ASCII whitespace/case-folding rules, not its locale.
export const normalizeFinanceName = (name: string) =>
  name.replace(/[ \t\n\r\f\v]+/g, " ").replace(/^ | $/g, "");

export const financeName = z
  .string()
  .max(1000)
  .transform(normalizeFinanceName)
  .pipe(
    z
      .string()
      .min(1)
      .max(100)
      .refine(
        (name) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name) && /\S/u.test(name),
        "Use a visible name without control characters."
      )
  );
