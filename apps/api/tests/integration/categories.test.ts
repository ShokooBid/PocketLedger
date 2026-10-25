import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/service.js";
import { createCategoryService } from "../../src/categories/service.js";
import { testConfig } from "../fixtures.js";
import { disposableDatabase } from "../support/disposable.js";

const database = disposableDatabase();
const db = database.db;
const config = testConfig();
let app: Awaited<ReturnType<typeof buildApp>>;
let alice: { token: string; id: string };
let bob: { token: string; id: string };
type Category = {
  id: string;
  name: string;
  archivedAt: string | null;
  updatedAt: string;
};
type Page = { items: Category[]; nextCursor: string | null };
const root = "/v1/categories";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  await database.start();
  const auth = await createAuthService(db, config, async () => {
    throw new Error("No provider calls in category tests.");
  });
  app = await buildApp(config, auth, {
    logger: false,
    rateLimitMax: 10000,
    categories: createCategoryService(db)
  });
  async function owner() {
    const email = `${randomUUID()}@example.invalid`;
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "synthetic category passphrase" }
    });
    expect(response.statusCode, response.body).toBe(201);
    return {
      token: response.json().accessToken as string,
      id: (await db.user.findUniqueOrThrow({ where: { email } })).id
    };
  }
  alice = await owner();
  bob = await owner();
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.close();
  }
});

async function create(name: string, token = alice.token) {
  return app.inject({
    method: "POST",
    url: root,
    payload: { name },
    headers: bearer(token)
  });
}
async function rename(id: string, name: string, token = alice.token) {
  return app.inject({
    method: "PATCH",
    url: `${root}/${id}`,
    payload: { name },
    headers: bearer(token)
  });
}
async function archive(id: string, token = alice.token) {
  return app.inject({
    method: "POST",
    url: `${root}/${id}/archive`,
    payload: {},
    headers: bearer(token)
  });
}

describe("owner-protected category API", () => {
  it("requires real authentication on every route before validating client input", async () => {
    for (const token of [undefined, "forged.jwt.token"]) {
      for (const [method, path, payload] of [
        ["GET", root, undefined],
        ["GET", `${root}/${randomUUID()}`, undefined],
        ["POST", root, { name: "No access" }],
        ["PATCH", `${root}/${randomUUID()}`, { name: "No access" }],
        ["POST", `${root}/${randomUUID()}/archive`, {}]
      ] as const) {
        const response = await app.inject({
          method,
          url: path,
          ...(payload ? { payload } : {}),
          headers: token ? bearer(token) : {}
        });
        expect(response.statusCode, response.body).toBe(401);
      }
    }
    expect(
      (await app.inject({ method: "POST", url: root, payload: { name: "" } }))
        .statusCode
    ).toBe(401);
  });

  it("normalizes display whitespace and rejects active duplicates per owner on create and rename", async () => {
    const first = await create(" \tDaily\r\n food\f\v ");
    expect(first.statusCode, first.body).toBe(201);
    const category = first.json<Category>();
    expect(category.name).toBe("Daily food");
    expect(first.json()).not.toHaveProperty("userId");
    const duplicate = await create("daily   FOOD");
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json().error.code).toBe("CATEGORY_NAME_CONFLICT");
    expect((await create("DAILY FOOD", bob.token)).statusCode).toBe(201);
    expect((await rename(category.id, "daily FOOD")).statusCode).toBe(200);
    const second = (await create("Something else")).json<Category>();
    expect((await rename(second.id, "DAILY FOOD")).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          url: `${root}/${second.id}`,
          headers: bearer(alice.token)
        })
      ).json().name
    ).toBe("Something else");
    // Non-ASCII case/accent/normalization is deliberately not folded.
    for (const name of ["École", "école", "e\u0301cole"])
      expect((await create(name)).statusCode).toBe(201);
    expect((await create("x".repeat(100))).statusCode).toBe(201);
  });

  it("rejects blank, long, hidden, malformed and owner-injection input with safe validation envelopes", async () => {
    for (const payload of [
      {},
      { name: " \t\n " },
      { name: "\u00a0" },
      { name: "x".repeat(101) },
      { name: "x".repeat(1001) },
      { name: "bad\u0000name" },
      { name: "bad\u200bname" },
      { name: "\ud800" },
      { name: 12 },
      { name: null },
      { name: "Valid", userId: bob.id },
      { name: "Valid", archivedAt: new Date().toISOString() },
      { name: "Valid", isDefault: true }
    ]) {
      const response = await app.inject({
        method: "POST",
        url: root,
        payload,
        headers: bearer(alice.token)
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json()).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "One or more fields are invalid.",
          requestId: response.headers["x-request-id"]
        }
      });
    }
    const item = (await create("Validate edits")).json<Category>();
    expect((await rename(item.id, "")).statusCode).toBe(422);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `${root}/${item.id}`,
          payload: { archivedAt: null },
          headers: bearer(alice.token)
        })
      ).statusCode
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${root}/${item.id}/archive`,
          payload: { userId: bob.id },
          headers: bearer(alice.token)
        })
      ).statusCode
    ).toBe(422);
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "status=unknown",
      "after=bad",
      `userId=${bob.id}`
    ])
      expect(
        (
          await app.inject({
            url: `${root}?${query}`,
            headers: bearer(alice.token)
          })
        ).statusCode
      ).toBe(422);
    expect(
      (
        await app.inject({
          url: `${root}/bad-id`,
          headers: bearer(alice.token)
        })
      ).statusCode
    ).toBe(422);
  });

  it("returns indistinguishable missing/foreign errors on read, update and archive and isolates lists", async () => {
    const category = (await create("Private Bob", bob.token)).json<Category>();
    for (const id of [category.id, randomUUID()]) {
      for (const response of [
        await app.inject({
          url: `${root}/${id}`,
          headers: bearer(alice.token)
        }),
        await rename(id, "Intrusion"),
        await archive(id)
      ]) {
        expect(response.statusCode).toBe(404);
        expect(response.json().error).toMatchObject({
          code: "NOT_FOUND",
          message: "Resource not found."
        });
      }
    }
    for (const status of ["active", "archived", "all"]) {
      const page = await app.inject({
        url: `${root}?status=${status}&limit=100`,
        headers: bearer(alice.token)
      });
      expect(
        page.json<Page>().items.some((row) => row.id === category.id)
      ).toBe(false);
    }
    expect(
      (
        await app.inject({
          url: `${root}/${category.id}`,
          headers: bearer(bob.token)
        })
      ).json()
    ).toMatchObject({ name: "Private Bob", archivedAt: null });
  });

  it("archives idempotently, frees the active name and preserves historical links while denying new assignments", async () => {
    const original = (await create("History category")).json<Category>();
    const transaction = await db.transaction.create({
      data: {
        userId: alice.id,
        categoryId: original.id,
        direction: "expense",
        amountMinor: 1234,
        currency: "USD",
        date: new Date("2026-01-01"),
        merchant: "Synthetic shop"
      }
    });
    const archived = await archive(original.id);
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json<Category>().archivedAt).not.toBeNull();
    expect((await archive(original.id)).json()).toEqual(archived.json());
    expect(
      (await rename(original.id, "Historical rename")).json().error.code
    ).toBe("CATEGORY_ARCHIVED");
    expect(
      (
        await app.inject({
          url: `${root}/${original.id}`,
          headers: bearer(alice.token)
        })
      ).json()
    ).toEqual(archived.json());
    const active = (
      await app.inject({
        url: `${root}?limit=100`,
        headers: bearer(alice.token)
      })
    ).json<Page>();
    expect(active.items.some((row) => row.id === original.id)).toBe(false);
    const history = (
      await app.inject({
        url: `${root}?status=archived`,
        headers: bearer(alice.token)
      })
    ).json<Page>();
    expect(history.items.some((row) => row.id === original.id)).toBe(true);
    const replacement = await create("HISTORY CATEGORY");
    expect(replacement.statusCode, replacement.body).toBe(201);
    expect(replacement.json().id).not.toBe(original.id);
    const past = await db.transaction.update({
      where: { id: transaction.id },
      data: { note: "Edit history safely" },
      include: { category: true }
    });
    expect(past.category).toMatchObject({
      id: original.id,
      name: "History category"
    });
    expect(past.category.archivedAt).toBeInstanceOf(Date);
    await expect(
      db.transaction.create({
        data: {
          userId: alice.id,
          categoryId: original.id,
          direction: "expense",
          amountMinor: 100,
          currency: "USD",
          date: new Date("2026-01-02"),
          merchant: "Synthetic new shop"
        }
      })
    ).rejects.toThrow();
    const current = await db.transaction.create({
      data: {
        userId: alice.id,
        categoryId: replacement.json().id,
        direction: "income",
        amountMinor: 100,
        currency: "USD",
        date: new Date("2026-01-02"),
        merchant: "Synthetic employer"
      }
    });
    await expect(
      db.transaction.update({
        where: { id: current.id },
        data: { categoryId: original.id }
      })
    ).rejects.toThrow();
  });

  it("bounds and paginates both active and historical lists without owner-dependent cursors", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await app.inject({
        url: `${root}?status=all&limit=2${cursor ? `&after=${cursor}` : ""}`,
        headers: bearer(alice.token)
      });
      expect(response.statusCode).toBe(200);
      const page: Page = response.json();
      expect(page.items.length).toBeLessThanOrEqual(2);
      ids.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      (
        await db.category.findMany({
          where: { userId: alice.id },
          orderBy: { id: "asc" }
        })
      ).map((row) => row.id)
    );
    // A cursor is a sort boundary, not a lookup of the supplied resource ID.
    expect(
      (
        await app.inject({
          url: `${root}?after=${randomUUID()}`,
          headers: bearer(alice.token)
        })
      ).statusCode
    ).toBe(200);
  });

  it("lets the database reject concurrent normalized duplicates and maps the loser to 409", async () => {
    const responses = await Promise.all([
      create(" Race\tName "),
      create("race NAME")
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409
    ]);
    // Direct writes prove this is enforced below HTTP validation as well.
    await expect(
      db.category.create({ data: { userId: alice.id, name: " RACE\nname " } })
    ).rejects.toMatchObject({ code: "P2002" });
    const [one, two] = await Promise.all([
      create("Rename race one"),
      create("Rename race two")
    ]);
    const edits = await Promise.all([
      rename(one.json().id, "Rename race winner"),
      rename(two.json().id, "RENAME race winner")
    ]);
    expect(edits.map((response) => response.statusCode).sort()).toEqual([
      200, 409
    ]);
  });

  it("publishes protected contracts and permits PATCH preflights", async () => {
    await app.ready();
    const spec = app.swagger();
    expect(spec.paths?.[root]?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths?.[`${root}/{id}`]?.patch?.security).toEqual([
      { bearerAuth: [] }
    ]);
    const response = await app.inject({
      method: "OPTIONS",
      url: `${root}/${randomUUID()}`,
      headers: {
        origin: "https://app.example.invalid",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "authorization,content-type"
      }
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
  });
});
