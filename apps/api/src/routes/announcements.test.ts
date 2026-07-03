import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { AnnouncementDtoSchema } from "@serva/shared-types";
import { buildApp } from "../app";
import { eventStore } from "../domain/state";
import { setupEventTestUtils } from "../test-utils/event-test-utils";

const { createTestEvent, createEventPrefix, createAppFixture, createAuthFixture } =
  setupEventTestUtils(test, eventStore);

test(
  "announcements are still delivered when the DB holds a non-ISO timestamp (#133)",
  { concurrency: false },
  async () => {
    const eventPasscode = "ann-pass";
    const created = createTestEvent({
      eventName: createEventPrefix("ann"),
      eventPasscode,
      adminUsername: "chef",
      adminPassword: "secret123",
    });
    eventStore.activateEvent(created.id);

    const app = await createAppFixture(buildApp);
    const auth = createAuthFixture(app);
    const adminToken = await auth.loginAdmin({
      eventId: created.id,
      username: "chef",
      password: "secret123",
    });
    const waiterToken = (await auth.loginWaiter({
      username: "anna",
      eventPasscode,
    })).accessToken;

    // A normal, API-created announcement (valid ISO createdAt).
    const createRes = await app.inject({
      method: "POST",
      url: "/announcements",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: "Nachschub an Bar 2", severity: "warning" },
    });
    assert.equal(createRes.statusCode, 201);

    // A row that lives in the DB but was written out-of-band with a
    // SQLite-style timestamp, an unknown severity and an empty author — the
    // kind of row that previously made the whole endpoint 500 and hid every
    // announcement from waiters.
    const db = new Database(created.dbFilePath);
    db.prepare(
      "INSERT INTO Announcements (message, severity, createdAt, createdBy) VALUES (?, ?, ?, ?)",
    ).run("Alte Ansage", "critical", "2026-06-21 19:15:23", "");
    db.close();

    const listRes = await app.inject({
      method: "GET",
      url: "/announcements?since=0",
      headers: { authorization: `Bearer ${waiterToken}` },
    });

    // The endpoint must succeed (not 500) and return BOTH announcements.
    assert.equal(listRes.statusCode, 200, "the odd row must not break delivery");
    const { announcements } = listRes.json() as {
      announcements: Array<Record<string, unknown>>;
    };
    assert.equal(announcements.length, 2, "both announcements are delivered");

    // Every returned announcement must satisfy the public contract.
    for (const ann of announcements) {
      assert.doesNotThrow(() => AnnouncementDtoSchema.parse(ann));
    }

    // The legacy row is normalised: SQLite UTC "2026-06-21 19:15:23" → ISO,
    // unknown severity → "info", empty author → "system".
    const legacy = announcements.find((a) => a.message === "Alte Ansage");
    assert.ok(legacy, "legacy row is present");
    assert.equal(legacy.createdAt, "2026-06-21T19:15:23.000Z");
    assert.equal(legacy.severity, "info");
    assert.equal(legacy.createdBy, "system");
  },
);
