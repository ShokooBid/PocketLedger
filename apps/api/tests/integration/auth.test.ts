import { randomUUID } from "node:crypto";
import {
  createLocalJWKSet,
  decodeJwt,
  exportJWK,
  generateKeyPair,
  SignJWT
} from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { accessToken, tokenHash } from "../../src/auth/crypto.js";
import { googleVerifier } from "../../src/auth/google.js";
import { createAuthService } from "../../src/auth/service.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase();
const db = database.db;
const config = testConfig();
let now = new Date();
let app: Awaited<ReturnType<typeof buildApp>>;
let auth: Awaited<ReturnType<typeof createAuthService>>;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
const password = "synthetic long passphrase 17";
type Tokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  sessionExpiresAt: string;
};
type Challenge = { challengeId: string; nonce: string };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const uniqueEmail = () => `${randomUUID()}@example.invalid`;

beforeAll(async () => {
  await database.start();
  keys = await generateKeyPair("RS256");
  const jwk = await exportJWK(keys.publicKey);
  auth = await createAuthService(
    db,
    config,
    googleVerifier(
      config,
      createLocalJWKSet({ keys: [{ ...jwk, kid: "synthetic", alg: "RS256" }] })
    ),
    () => now
  );
  app = await buildApp(config, auth, { logger: false, rateLimitMax: 10000 });
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.close();
  }
});

async function post(url: string, payload: object, access?: string) {
  return app.inject({
    method: "POST",
    url: `/v1/auth/${url}`,
    payload,
    headers: access ? bearer(access) : {}
  });
}
async function register(email = uniqueEmail()) {
  const response = await post("register", { email, password });
  expect(response.statusCode, response.body).toBe(201);
  return { tokens: response.json<Tokens>(), email };
}
async function challenge(purpose = "login", access?: string) {
  const response = await post("google/challenges", { purpose }, access);
  expect(response.statusCode, response.body).toBe(201);
  const { challengeId, nonce } = response.json<Challenge>();
  return { challengeId, nonce };
}
async function signedProof(
  ch: Challenge,
  subject = `synthetic-${randomUUID()}`,
  email = uniqueEmail(),
  extra: Record<string, unknown> = {}
) {
  const idToken = await new SignJWT({
    nonce: ch.nonce,
    email,
    email_verified: true,
    azp: "synthetic-native-client",
    ...extra
  })
    .setProtectedHeader({ alg: "RS256", kid: "synthetic" })
    .setSubject(subject)
    .setIssuer("https://accounts.google.com")
    .setAudience("synthetic-web-client")
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + 300)
    .sign(keys.privateKey);
  return { ...ch, idToken };
}
const me = (token: string) =>
  app.inject({ url: "/v1/me", headers: bearer(token) });

describe("password login and server-checked sessions", () => {
  it("handles legacy email casing/spacing and rejects an individually expired refresh token", async () => {
    const { tokens, email } = await register();
    const claims = decodeJwt(tokens.accessToken);
    await db.user.update({
      where: { id: claims.sub! },
      data: { email: ` ${email.toUpperCase()} ` }
    });
    expect((await post("login", { email, password })).statusCode).toBe(200);
    const collision = await post("register", { email, password });
    expect(collision.statusCode).toBe(401);
    await db.refreshToken.update({
      where: { tokenHash: tokenHash(tokens.refreshToken) },
      data: {
        createdAt: new Date(now.getTime() - 10000),
        expiresAt: new Date(now.getTime() - 1000)
      }
    });
    expect(
      (await post("refresh", { refreshToken: tokens.refreshToken })).statusCode
    ).toBe(401);
    expect((await me(tokens.accessToken)).statusCode).toBe(401);
  });
  it("normalizes email, hashes passwords, leaves email unverified and stores only token hashes", async () => {
    const email = uniqueEmail();
    const { tokens } = await register(` ${email.toUpperCase()} `);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(password);
    expect(user.emailVerifiedAt).toBeNull();
    const token = await db.refreshToken.findUniqueOrThrow({
      where: { tokenHash: tokenHash(tokens.refreshToken) }
    });
    expect(token.tokenHash).not.toBe(tokens.refreshToken);
    expect((await me(tokens.accessToken)).json()).toMatchObject({
      id: user.id,
      email,
      emailVerified: false,
      methods: { password: true, google: false }
    });
    expect(
      (await post("login", { email: ` ${email.toUpperCase()} `, password }))
        .statusCode
    ).toBe(200);
    expect((await post("register", { email, password })).statusCode).toBe(401);
  });
  it("returns the same credential error for absent, wrong, null, malformed and disabled credentials", async () => {
    const { email } = await register();
    const nullEmail = uniqueEmail();
    const malformed = uniqueEmail();
    const disabled = uniqueEmail();
    await db.user.createMany({
      data: [
        { email: nullEmail },
        { email: malformed, passwordHash: "$argon2id$malformed" },
        {
          email: disabled,
          passwordHash: "!disabled:synthetic",
          disabledAt: now
        }
      ]
    });
    let expected: unknown;
    for (const candidate of [
      email,
      uniqueEmail(),
      nullEmail,
      malformed,
      disabled
    ]) {
      const response = await post("login", {
        email: candidate,
        password: "incorrect synthetic password"
      });
      expect(response.statusCode).toBe(401);
      const { requestId: _requestId, ...error } = response.json().error;
      expect(_requestId).toBeTruthy();
      expected ??= error;
      expect(error).toEqual(expected);
      expect(response.body).not.toContain(candidate);
    }
  });
  it("rejects missing, forged, expired and cross-user access tokens", async () => {
    const first = await register();
    const second = await register();
    const claims = decodeJwt(first.tokens.accessToken);
    expect((await app.inject("/v1/me")).statusCode).toBe(401);
    expect((await me("invalid.token.signature")).statusCode).toBe(401);
    const expired = await accessToken(
      config,
      claims.sub!,
      claims.sid as string,
      new Date(now.getTime() - 10000),
      new Date(now.getTime() - 1000)
    );
    expect((await me(expired)).statusCode).toBe(401);
    const wrongOwner = await accessToken(
      config,
      decodeJwt(second.tokens.accessToken).sub!,
      claims.sid as string,
      now,
      new Date(now.getTime() + 60000)
    );
    expect((await me(wrongOwner)).statusCode).toBe(401);
    const otherConfig = { ...config, tokenKey: new Uint8Array(32) };
    expect(
      (
        await me(
          await accessToken(
            otherConfig,
            claims.sub!,
            claims.sid as string,
            now,
            new Date(now.getTime() + 60000)
          )
        )
      ).statusCode
    ).toBe(401);
  });
  it("rotates once, retains consumed hashes, and commits replay revocation", async () => {
    const { tokens } = await register();
    const rotated = await post("refresh", {
      refreshToken: tokens.refreshToken
    });
    expect(rotated.statusCode).toBe(200);
    const replacement = rotated.json<Tokens>();
    expect(replacement.refreshToken).not.toBe(tokens.refreshToken);
    expect(replacement.sessionExpiresAt).toBe(tokens.sessionExpiresAt);
    expect(
      (
        await db.refreshToken.findUniqueOrThrow({
          where: { tokenHash: tokenHash(tokens.refreshToken) }
        })
      ).consumedAt
    ).not.toBeNull();
    expect(
      (await post("refresh", { refreshToken: tokens.refreshToken })).statusCode
    ).toBe(401);
    expect((await me(replacement.accessToken)).statusCode).toBe(401);
    expect(
      (await post("refresh", { refreshToken: replacement.refreshToken }))
        .statusCode
    ).toBe(401);
    const session = await db.session.findUniqueOrThrow({
      where: { id: decodeJwt(tokens.accessToken).sid as string }
    });
    expect(session.revokedAt).not.toBeNull();
  });
  it("serializes concurrent rotation: one successor, then family revoked by loser", async () => {
    const { tokens } = await register();
    const results = await Promise.all([
      post("refresh", { refreshToken: tokens.refreshToken }),
      post("refresh", { refreshToken: tokens.refreshToken })
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 401
    ]);
    const successor = results
      .find((response) => response.statusCode === 200)!
      .json<Tokens>();
    expect((await me(successor.accessToken)).statusCode).toBe(401);
    const sid = decodeJwt(tokens.accessToken).sid as string;
    expect(await db.refreshToken.count({ where: { sessionId: sid } })).toBe(2);
    expect(
      (await post("refresh", { refreshToken: successor.refreshToken }))
        .statusCode
    ).toBe(401);
  });
  it("rejects absolute/idle expiry and disabled users for both access and refresh", async () => {
    for (const reason of ["absolute", "idle", "disabled"]) {
      const { tokens } = await register();
      const claims = decodeJwt(tokens.accessToken);
      if (reason === "disabled")
        await db.user.update({
          where: { id: claims.sub! },
          data: { disabledAt: now }
        });
      else {
        const old = new Date(now.getTime() - 31 * 86400000);
        await db.session.update({
          where: { id: claims.sid as string },
          data: {
            createdAt: old,
            ...(reason === "absolute"
              ? { expiresAt: new Date(now.getTime() - 1000) }
              : { lastUsedAt: old })
          }
        });
      }
      expect((await me(tokens.accessToken)).statusCode).toBe(401);
      expect(
        (await post("refresh", { refreshToken: tokens.refreshToken }))
          .statusCode
      ).toBe(401);
    }
  });
  it("logs out current or all sessions without affecting another user", async () => {
    const first = await register();
    const second = (
      await post("login", { email: first.email, password })
    ).json<Tokens>();
    const other = await register();
    expect(
      (await post("logout", {}, first.tokens.accessToken)).statusCode
    ).toBe(200);
    expect((await me(first.tokens.accessToken)).statusCode).toBe(401);
    expect(
      (await post("refresh", { refreshToken: first.tokens.refreshToken }))
        .statusCode
    ).toBe(401);
    expect((await me(second.accessToken)).statusCode).toBe(200);
    const third = (
      await post("login", { email: first.email, password })
    ).json<Tokens>();
    expect(
      (await post("logout", { allSessions: true }, second.accessToken))
        .statusCode
    ).toBe(200);
    expect((await me(third.accessToken)).statusCode).toBe(401);
    expect((await me(other.tokens.accessToken)).statusCode).toBe(200);
  });
});

describe("Google onboarding, challenges and explicit linking", () => {
  it("creates Google-only users atomically and resolves subject before changed email", async () => {
    const subject = `synthetic-${randomUUID()}`;
    const email = uniqueEmail();
    const proof = await signedProof(await challenge(), subject, email);
    const response = await post("google", proof);
    expect(response.statusCode, response.body).toBe(200);
    const tokens = response.json<Tokens>();
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
    const storedChallenge = await db.authChallenge.findUniqueOrThrow({
      where: { id: proof.challengeId }
    });
    expect(storedChallenge.nonceHash).toBe(tokenHash(proof.nonce));
    expect(storedChallenge.consumedAt).not.toBeNull();
    expect((await post("login", { email, password })).statusCode).toBe(401);
    const changed = await post(
      "google",
      await signedProof(await challenge(), subject, uniqueEmail())
    );
    expect(changed.statusCode).toBe(200);
    expect(decodeJwt(changed.json<Tokens>().accessToken).sub).toBe(user.id);
    expect((await me(tokens.accessToken)).json().email).toBe(email);
  });
  it("rejects missing, mismatched, expired, replayed and concurrent challenges", async () => {
    const proof = await signedProof(await challenge());
    expect(
      (await post("google", { ...proof, challengeId: randomUUID() })).statusCode
    ).toBe(401);
    expect(
      (await post("google", { ...proof, nonce: "x".repeat(43) })).statusCode
    ).toBe(401);
    const results = await Promise.all([
      post("google", proof),
      post("google", proof)
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 401
    ]);
    expect((await post("google", proof)).statusCode).toBe(401);
    const expiring = await signedProof(await challenge());
    const original = now;
    try {
      now = new Date(now.getTime() + 301000);
      expect((await post("google", expiring)).statusCode).toBe(401);
    } finally {
      now = original;
    }
  });
  it("burns a challenge on invalid provider proof and rejects unverified onboarding email", async () => {
    const ch = await challenge();
    expect(
      (await post("google", { ...ch, idToken: "invalid-token" })).statusCode
    ).toBe(401);
    expect((await post("google", await signedProof(ch))).statusCode).toBe(401);
    const email = uniqueEmail();
    expect(
      (
        await post(
          "google",
          await signedProof(await challenge(), undefined, email, {
            email_verified: false
          })
        )
      ).statusCode
    ).toBe(401);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });
  it("never merges matching emails and links only with proof of both identities", async () => {
    const { tokens, email } = await register();
    const subject = `synthetic-${randomUUID()}`;
    const collision = await post(
      "google",
      await signedProof(await challenge(), subject, email.toUpperCase())
    );
    expect(collision.statusCode).toBe(401);
    expect(
      await db.authIdentity.count({ where: { providerSubject: subject } })
    ).toBe(0);
    const claims = decodeJwt(tokens.accessToken);
    await db.session.update({
      where: { id: claims.sid as string },
      data: { reauthenticatedAt: new Date(now.getTime() - 301000) }
    });
    expect(
      (await post("google/challenges", { purpose: "link" }, tokens.accessToken))
        .statusCode
    ).toBe(401);
    expect(
      (await post("reauthenticate", { password: "wrong" }, tokens.accessToken))
        .statusCode
    ).toBe(401);
    expect(
      (await post("reauthenticate", { password }, tokens.accessToken))
        .statusCode
    ).toBe(200);
    const proof = await signedProof(
      await challenge("link", tokens.accessToken),
      subject,
      email
    );
    expect(
      (await post("google/link", proof, tokens.accessToken)).statusCode
    ).toBe(200);
    expect((await me(tokens.accessToken)).json()).toMatchObject({
      id: claims.sub,
      emailVerified: false,
      methods: { google: true, password: true }
    });
    expect(
      (await post("google/link", proof, tokens.accessToken)).statusCode
    ).toBe(401);
    const loggedIn = await post(
      "google",
      await signedProof(await challenge(), subject, email)
    );
    expect(decodeJwt(loggedIn.json<Tokens>().accessToken).sub).toBe(claims.sub);
  });
  it("binds link/reauth challenges to their purpose and session and never reassigns subjects", async () => {
    const first = await register();
    const second = await register();
    const subject = `synthetic-${randomUUID()}`;
    const linkProof = await signedProof(
      await challenge("link", first.tokens.accessToken),
      subject
    );
    expect(
      (await post("google/link", linkProof, second.tokens.accessToken))
        .statusCode
    ).toBe(401);
    expect((await post("google", linkProof)).statusCode).toBe(401);
    expect(
      (await post("google/link", linkProof, first.tokens.accessToken))
        .statusCode
    ).toBe(200);
    const stolen = await signedProof(
      await challenge("link", second.tokens.accessToken),
      subject
    );
    expect(
      (await post("google/link", stolen, second.tokens.accessToken)).statusCode
    ).toBe(401);
    const fresh = await signedProof(
      await challenge("reauthenticate", first.tokens.accessToken),
      subject
    );
    expect(
      (await post("reauthenticate", fresh, first.tokens.accessToken)).statusCode
    ).toBe(200);
    const wrong = await signedProof(
      await challenge("reauthenticate", second.tokens.accessToken),
      subject
    );
    expect(
      (await post("reauthenticate", wrong, second.tokens.accessToken))
        .statusCode
    ).toBe(401);
    expect(
      (
        await db.authIdentity.findUniqueOrThrow({
          where: {
            provider_providerSubject: {
              provider: "google",
              providerSubject: subject
            }
          }
        })
      ).userId
    ).toBe(decodeJwt(first.tokens.accessToken).sub);
  });
  it("handles signup and linking uniqueness races without duplicate ownership", async () => {
    const email = uniqueEmail();
    const passwordResults = await Promise.all([
      post("register", { email, password }),
      post("register", { email: email.toUpperCase(), password })
    ]);
    expect(
      passwordResults.map((response) => response.statusCode).sort()
    ).toEqual([201, 401]);
    const first = await register();
    const second = await register();
    const subject = `synthetic-${randomUUID()}`;
    const proofs = await Promise.all([
      signedProof(await challenge("link", first.tokens.accessToken), subject),
      signedProof(await challenge("link", second.tokens.accessToken), subject)
    ]);
    const results = await Promise.all([
      post("google/link", proofs[0]!, first.tokens.accessToken),
      post("google/link", proofs[1]!, second.tokens.accessToken)
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 401
    ]);
    expect(
      await db.authIdentity.count({ where: { providerSubject: subject } })
    ).toBe(1);
    const googleSubject = `synthetic-${randomUUID()}`;
    const googleEmail = uniqueEmail();
    const signupProofs = await Promise.all([
      signedProof(await challenge(), googleSubject, googleEmail),
      signedProof(await challenge(), googleSubject, googleEmail)
    ]);
    const googleResults = await Promise.all(
      signupProofs.map((proof) => post("google", proof))
    );
    expect(
      googleResults.every((response) =>
        [200, 401].includes(response.statusCode)
      )
    ).toBe(true);
    expect(
      await db.authIdentity.count({ where: { providerSubject: googleSubject } })
    ).toBe(1);
    expect(await db.user.count({ where: { email: googleEmail } })).toBe(1);
  });
  it("rejects disabled Google users, even with a verified proof", async () => {
    const subject = `synthetic-${randomUUID()}`;
    const login = await post(
      "google",
      await signedProof(await challenge(), subject)
    );
    await db.user.update({
      where: { id: decodeJwt(login.json<Tokens>().accessToken).sub! },
      data: { disabledAt: now }
    });
    expect(
      (await post("google", await signedProof(await challenge(), subject)))
        .statusCode
    ).toBe(401);
  });
  it("permits only one Google identity per owner during concurrent linking", async () => {
    const { tokens } = await register();
    const proofs = await Promise.all([
      signedProof(await challenge("link", tokens.accessToken)),
      signedProof(await challenge("link", tokens.accessToken))
    ]);
    const results = await Promise.all(
      proofs.map((proof) => post("google/link", proof, tokens.accessToken))
    );
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 401
    ]);
    expect(
      await db.authIdentity.count({
        where: { userId: decodeJwt(tokens.accessToken).sub! }
      })
    ).toBe(1);
  });
});

describe("session persistence and cleanup", () => {
  it("restores against a new service instance using only the persisted refresh credential", async () => {
    const { tokens } = await register();
    const restored = await createAuthService(
      db,
      config,
      googleVerifier(config),
      () => now
    );
    const renewed = await restored.refresh(tokens.refreshToken);
    expect((await restored.authenticate(renewed.accessToken)).userId).toBe(
      decodeJwt(tokens.accessToken).sub
    );
  });
  it("cleans expired/revoked families in dependency order, preserving active replay history", async () => {
    const active = await register();
    await post("refresh", { refreshToken: active.tokens.refreshToken });
    const revoked = await register();
    await challenge("link", revoked.tokens.accessToken);
    await post("logout", {}, revoked.tokens.accessToken);
    const oldId = decodeJwt(revoked.tokens.accessToken).sid as string;
    expect(await auth.cleanup()).toBeGreaterThan(0);
    expect(await db.session.findUnique({ where: { id: oldId } })).toBeNull();
    expect(await db.refreshToken.count({ where: { sessionId: oldId } })).toBe(
      0
    );
    expect(await db.authChallenge.count({ where: { sessionId: oldId } })).toBe(
      0
    );
    expect(
      await db.refreshToken.count({
        where: { sessionId: decodeJwt(active.tokens.accessToken).sid as string }
      })
    ).toBe(2);
  });
});
