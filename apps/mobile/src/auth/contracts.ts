// Mobile projections of the published API contracts. Validate every response;
// never import server code or trust decoded JWT claims as authentication.
import { z } from "zod";

export const credentialsSchema = z.object({
  accessToken: z.string().min(1).max(16384),
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  tokenType: z.literal("Bearer"),
  accessExpiresAt: z.iso.datetime(),
  sessionExpiresAt: z.iso.datetime()
});
export const storedSessionSchema = z.object({
  version: z.literal(1),
  credentials: credentialsSchema,
  refreshPending: z.boolean()
});
export type Credentials = z.infer<typeof credentialsSchema>;
export type StoredSession = z.infer<typeof storedSessionSchema>;
export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  emailVerified: z.boolean(),
  methods: z.object({ password: z.boolean(), google: z.boolean() })
});
export type User = z.infer<typeof userSchema>;
export const challengeSchema = z.object({
  challengeId: z.uuid(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime()
});
export const okSchema = z.object({ ok: z.literal(true) });

export interface CredentialStore {
  read(): Promise<StoredSession | null>;
  write(value: StoredSession): Promise<void>;
  clear(): Promise<void>;
}
export type GoogleProof = (nonce: string) => Promise<string | null>;
