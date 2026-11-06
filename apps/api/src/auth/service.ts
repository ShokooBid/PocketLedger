import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import type { Session, User } from "../generated/prisma/client.js";
import type { Config } from "../config.js";
import { invalidCredentials } from "../errors.js";
import {
  accessToken,
  hashPassword,
  passwordVerifier,
  randomToken,
  tokenHash,
  verifyAccess
} from "./crypto.js";
import type { GoogleVerifier } from "./google.js";

type Transaction = Prisma.TransactionClient;
export type Principal = { userId: string; sessionId: string };
type Purpose = "login" | "link" | "reauthenticate";
type GoogleInput = { challengeId: string; nonce: string; idToken: string };
const addSeconds = (now: Date, seconds: number) =>
  new Date(now.getTime() + seconds * 1000);
const uniqueFailure = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

export async function createAuthService(
  db: PrismaClient,
  config: Config,
  google: GoogleVerifier,
  clock = () => new Date()
) {
  const verifyPassword = await passwordVerifier();

  function active(session: Session & { user: User }, now: Date) {
    return (
      !session.revokedAt &&
      !session.user.disabledAt &&
      session.expiresAt > now &&
      addSeconds(session.lastUsedAt ?? session.createdAt, config.idleSeconds) >
        now
    );
  }

  async function findEmail(email: string) {
    const matches = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "User" WHERE lower(btrim(email)) = ${email.trim().toLowerCase()}`;
    return matches[0]
      ? db.user.findUnique({ where: { id: matches[0].id } })
      : null;
  }

  async function credentials(
    userId: string,
    session: Session,
    refreshToken: string,
    now: Date
  ) {
    const expiresAt = new Date(
      Math.min(
        addSeconds(now, config.accessSeconds).getTime(),
        session.expiresAt.getTime(),
        addSeconds(
          session.lastUsedAt ?? session.createdAt,
          config.idleSeconds
        ).getTime()
      )
    );
    return {
      accessToken: await accessToken(
        config,
        userId,
        session.id,
        now,
        expiresAt
      ),
      refreshToken,
      accessExpiresAt: expiresAt.toISOString(),
      sessionExpiresAt: session.expiresAt.toISOString(),
      tokenType: "Bearer" as const
    };
  }

  async function issue(tx: Transaction, userId: string, now: Date) {
    // Lock the user: session creation/disable checks and logout-all serialize here.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.disabledAt) throw invalidCredentials();
    const session = await tx.session.create({
      data: {
        userId,
        createdAt: now,
        lastUsedAt: now,
        reauthenticatedAt: now,
        expiresAt: addSeconds(now, config.sessionSeconds)
      }
    });
    const refresh = randomToken();
    await tx.refreshToken.create({
      data: {
        sessionId: session.id,
        tokenHash: tokenHash(refresh),
        createdAt: now,
        expiresAt: session.expiresAt
      }
    });
    return credentials(userId, session, refresh, now);
  }

  async function authenticate(token: string): Promise<Principal> {
    const now = clock();
    const principal = await verifyAccess(config, token, now);
    const session = await db.session.findUnique({
      where: { id: principal.sessionId },
      include: { user: true }
    });
    if (
      !session ||
      session.userId !== principal.userId ||
      !active(session, now)
    )
      throw invalidCredentials();
    return principal;
  }

  async function requireSession(principal: Principal, recent = false) {
    const session = await db.session.findUnique({
      where: { id: principal.sessionId },
      include: { user: true }
    });
    const now = clock();
    if (
      !session ||
      session.userId !== principal.userId ||
      !active(session, now) ||
      (recent &&
        (!session.reauthenticatedAt ||
          addSeconds(session.reauthenticatedAt, config.reauthSeconds) <= now))
    )
      throw invalidCredentials();
    return session;
  }

  async function challenge(purpose: Purpose, principal?: Principal) {
    if (!config.googleAudiences.length) throw invalidCredentials();
    if (purpose !== "login") {
      if (!principal) throw invalidCredentials();
      await requireSession(principal, purpose === "link");
    }
    const nonce = randomToken();
    const now = clock();
    const record = await db.authChallenge.create({
      data: {
        purpose,
        nonceHash: tokenHash(nonce),
        sessionId: purpose === "login" ? null : principal!.sessionId,
        createdAt: now,
        expiresAt: addSeconds(now, config.challengeSeconds)
      }
    });
    return {
      challengeId: record.id,
      nonce,
      expiresAt: record.expiresAt.toISOString()
    };
  }

  async function googleProof(
    input: GoogleInput,
    purpose: Purpose,
    principal?: Principal
  ) {
    // Consume before provider I/O. Even a failed attempt burns its challenge.
    const consumed = await db.authChallenge.updateMany({
      where: {
        id: input.challengeId,
        purpose,
        sessionId: principal?.sessionId ?? null,
        nonceHash: tokenHash(input.nonce),
        consumedAt: null,
        expiresAt: { gt: clock() }
      },
      data: { consumedAt: clock() }
    });
    if (consumed.count !== 1) throw invalidCredentials();
    return google(input.idToken, input.nonce, clock());
  }

  async function register(email: string, password: string) {
    const hash = await hashPassword(password);
    if (await findEmail(email)) throw invalidCredentials();
    try {
      return await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: email.trim().toLowerCase(), passwordHash: hash }
        });
        return issue(tx, user.id, clock());
      });
    } catch (error) {
      if (uniqueFailure(error)) throw invalidCredentials();
      throw error;
    }
  }

  async function login(email: string, password: string) {
    const user = await findEmail(email);
    const valid = await verifyPassword(
      user?.disabledAt ? null : user?.passwordHash,
      password
    );
    if (!valid || !user || user.disabledAt) throw invalidCredentials();
    return db.$transaction((tx) => issue(tx, user.id, clock()));
  }

  async function googleLogin(input: GoogleInput) {
    const proof = await googleProof(input, "login");
    const identity = await db.authIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: "google",
          providerSubject: proof.subject
        }
      }
    });
    if (identity)
      return db.$transaction((tx) => issue(tx, identity.userId, clock()));
    if (!proof.email || !proof.verifiedEmail || (await findEmail(proof.email)))
      throw invalidCredentials();
    try {
      return await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: proof.email!,
            emailVerifiedAt: clock(),
            identities: {
              create: { provider: "google", providerSubject: proof.subject }
            }
          }
        });
        return issue(tx, user.id, clock());
      });
    } catch (error) {
      if (uniqueFailure(error)) throw invalidCredentials();
      throw error;
    }
  }

  async function link(principal: Principal, input: GoogleInput) {
    await requireSession(principal, true);
    const proof = await googleProof(input, "link", principal);
    try {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${principal.sessionId}::uuid FOR UPDATE`;
        const session = await tx.session.findUniqueOrThrow({
          where: { id: principal.sessionId },
          include: { user: true }
        });
        if (
          !active(session, clock()) ||
          !session.reauthenticatedAt ||
          addSeconds(session.reauthenticatedAt, config.reauthSeconds) <= clock()
        )
          throw invalidCredentials();
        await tx.authIdentity.create({
          data: {
            userId: principal.userId,
            provider: "google",
            providerSubject: proof.subject
          }
        });
      });
    } catch (error) {
      if (uniqueFailure(error)) throw invalidCredentials();
      throw error;
    }
  }

  async function reauthenticate(
    principal: Principal,
    proof: { password: string } | GoogleInput
  ) {
    const session = await requireSession(principal);
    if ("password" in proof) {
      if (!(await verifyPassword(session.user.passwordHash, proof.password)))
        throw invalidCredentials();
    } else {
      const verified = await googleProof(proof, "reauthenticate", principal);
      const identity = await db.authIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: "google",
            providerSubject: verified.subject
          }
        }
      });
      if (identity?.userId !== principal.userId) throw invalidCredentials();
    }
    await db.session.updateMany({
      where: { id: principal.sessionId, revokedAt: null },
      data: { reauthenticatedAt: clock() }
    });
  }

  async function refresh(raw: string) {
    const result = await db.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash: tokenHash(raw) }
      });
      if (!token) return null;
      // Every rotation/revocation takes this row lock. READ COMMITTED then sees
      // the previous winner's commit, including its consumed token marker.
      await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${token.sessionId}::uuid FOR UPDATE`;
      const session = await tx.session.findUniqueOrThrow({
        where: { id: token.sessionId },
        include: { user: true }
      });
      const now = clock();
      const consumed = await tx.refreshToken.updateMany({
        where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now }
      });
      if (!active(session, now) || consumed.count !== 1) {
        await tx.session.update({
          where: { id: session.id },
          data: { revokedAt: now }
        });
        return null; // Return, don't throw: revocation must commit.
      }
      const replacement = randomToken();
      await tx.refreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: tokenHash(replacement),
          createdAt: now,
          expiresAt: session.expiresAt
        }
      });
      const updated = await tx.session.update({
        where: { id: session.id },
        data: { lastUsedAt: now }
      });
      return credentials(session.userId, updated, replacement, now);
    });
    if (!result) throw invalidCredentials();
    return result;
  }

  async function logout(principal: Principal, all = false) {
    await db.$transaction(async (tx) => {
      if (all)
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${principal.userId}::uuid FOR UPDATE`;
      await tx.session.updateMany({
        where: {
          userId: principal.userId,
          ...(all ? {} : { id: principal.sessionId }),
          revokedAt: null
        },
        data: { revokedAt: clock() }
      });
    });
  }

  async function currentUser(principal: Principal) {
    const session = await requireSession(principal);
    const linked = await db.authIdentity.count({
      where: { userId: principal.userId, provider: "google" }
    });
    return {
      id: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerifiedAt !== null,
      methods: {
        password: session.user.passwordHash?.startsWith("$argon2id$") ?? false,
        google: linked > 0
      }
    };
  }

  async function cleanup() {
    const now = clock();
    return db.$transaction(async (tx) => {
      // Lock families before removal; retained consumed hashes survive while
      // their family is usable. Limit each batch to keep maintenance bounded.
      const expired = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Session" WHERE "expiresAt" <= ${now} OR "revokedAt" IS NOT NULL OR COALESCE("lastUsedAt", "createdAt") <= ${addSeconds(now, -config.idleSeconds)} ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED`;
      const ids = expired.map((session) => session.id);
      await tx.authChallenge.deleteMany({
        where: { OR: [{ expiresAt: { lte: now } }, { sessionId: { in: ids } }] }
      });
      await tx.refreshToken.deleteMany({ where: { sessionId: { in: ids } } });
      return (await tx.session.deleteMany({ where: { id: { in: ids } } }))
        .count;
    });
  }

  return {
    register,
    login,
    googleLogin,
    authenticate,
    challenge,
    link,
    reauthenticate,
    refresh,
    logout,
    currentUser,
    cleanup
  };
}

export type AuthService = Awaited<ReturnType<typeof createAuthService>>;
