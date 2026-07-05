import assert from "node:assert/strict";
import test from "node:test";
import type { EventBackupFile } from "@bstoema/shared-types";
import { buildApp } from "../app";
import { hashPassword } from "../domain/password";
import { eventStore } from "../domain/state";
import { setupEventTestUtils } from "../test-utils/event-test-utils";

const {
  createEventPrefix,
  createTestEvent,
  createAppFixture,
  configureMasterCredentials,
  createAuthFixture,
} = setupEventTestUtils(test, eventStore);

// Builds a backup file fixture with every domain table populated. Rows are
// listed in id order (configurations by name) to match the export ordering,
// so an import → export roundtrip must reproduce `data` verbatim.
function buildBackupFixture(eventName: string): EventBackupFile {
  return {
    kind: "bstoema-event-backup",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    events: [
      {
        eventName,
        createdAt: "2026-06-01T10:00:00.000Z",
        adminUsername: "backup-admin",
        adminPasswordHash: hashPassword("backup-secret"),
        eventPasscode: "backup-pass",
        eventPasscodeHash: hashPassword("backup-pass"),
        data: {
          users: [
            { id: 1, username: "anna", isLocked: false },
            { id: 2, username: "ben", isLocked: true },
          ],
          tables: [
            { id: 1, name: "Tisch 1", weight: 0, isLocked: false },
            { id: 2, name: "Tisch 2", weight: 1, isLocked: false },
          ],
          menuCategories: [
            {
              id: 1,
              name: "Getraenke",
              description: "Kalt & warm",
              isLocked: false,
              weight: 0,
              printerId: 1,
              orderDisplayId: 1,
            },
            {
              id: 2,
              name: "Speisen",
              description: "",
              isLocked: false,
              weight: 1,
              printerId: null,
              orderDisplayId: null,
            },
          ],
          menuItems: [
            {
              id: 1,
              name: "Cola",
              description: "0.5l",
              weight: 0,
              price: 3.5,
              isLocked: false,
              menuCategoryId: 1,
            },
            {
              id: 2,
              name: "Schnitzel",
              description: "mit Pommes",
              weight: 0,
              price: 12.9,
              isLocked: false,
              menuCategoryId: 2,
            },
          ],
          stockItems: [{ id: 1, name: "Cola-Kiste", quantity: 24 }],
          stockItemMenuItems: [{ stockItemId: 1, menuItemId: 1, quantityRequired: 1 }],
          orders: [
            { id: 1, timestamp: "2026-06-01T12:00:00.000Z", tableId: 1, userId: 1 },
            { id: 2, timestamp: "2026-06-01T12:05:00.000Z", tableId: 2, userId: 2 },
          ],
          orderItems: [
            { orderId: 1, menuItemId: 1, quantity: 2, specialRequests: "ohne Eis" },
            { orderId: 1, menuItemId: 2, quantity: 1, specialRequests: "" },
            { orderId: 2, menuItemId: 1, quantity: 1, specialRequests: "" },
          ],
          configurations: [
            { name: "currency", value: "EUR" },
            { name: "eventMotto", value: "Sommerfest" },
          ],
          printers: [{ id: 1, name: "Theke", ipAddress: "192.168.1.50", connectionDetails: "" }],
          orderDisplays: [{ id: 1, name: "Kueche", ipAddress: "192.168.1.60", connectionDetails: "" }],
        },
      },
    ],
  };
}

test("import → export roundtrip restores an event with full fidelity", { concurrency: false }, async () => {
  configureMasterCredentials();
  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const masterToken = await auth.loginMaster();

  const eventName = createEventPrefix("backup-roundtrip");
  const fixture = buildBackupFixture(eventName);
  const importedIds: number[] = [];

  try {
    const importResponse = await app.inject({
      method: "POST",
      url: "/admin/events/import",
      headers: { authorization: `Bearer ${masterToken}` },
      payload: { backup: fixture },
    });
    assert.equal(importResponse.statusCode, 201);
    const imported = importResponse.json().events as Array<{
      id: number;
      eventName: string;
      adminUsername: string;
      isActive: boolean;
      createdAt: string;
      closedAt?: string;
    }>;
    assert.equal(imported.length, 1);
    importedIds.push(imported[0].id);

    // No name collision on first import → original name and metadata preserved,
    // event starts inactive.
    assert.equal(imported[0].eventName, eventName);
    assert.equal(imported[0].adminUsername, "backup-admin");
    assert.equal(imported[0].isActive, false);
    assert.equal(imported[0].createdAt, "2026-06-01T10:00:00.000Z");
    assert.equal(imported[0].closedAt, undefined);

    // Exporting the imported event must reproduce the fixture data verbatim.
    const exportResponse = await app.inject({
      method: "GET",
      url: `/admin/events/${imported[0].id}/export`,
      headers: { authorization: `Bearer ${masterToken}` },
    });
    assert.equal(exportResponse.statusCode, 200);
    const exported = exportResponse.json() as EventBackupFile;
    assert.equal(exported.kind, "bstoema-event-backup");
    assert.equal(exported.formatVersion, 1);
    assert.equal(exported.events.length, 1);
    assert.equal(exported.events[0].eventName, eventName);
    assert.equal(exported.events[0].adminUsername, "backup-admin");
    assert.equal(exported.events[0].eventPasscode, "backup-pass");
    assert.equal(exported.events[0].adminPasswordHash, fixture.events[0].adminPasswordHash);
    assert.equal(exported.events[0].eventPasscodeHash, fixture.events[0].eventPasscodeHash);
    assert.deepEqual(exported.events[0].data, fixture.events[0].data);

    // The restored credential hashes must actually work for admin login.
    const adminToken = await auth.loginAdmin({
      eventId: imported[0].id,
      username: "backup-admin",
      password: "backup-secret",
    });
    assert.ok(adminToken);

    // Re-importing the same file must not overwrite the existing event but
    // create a renamed copy instead — twice, to cover the numbered suffix.
    const secondImport = await app.inject({
      method: "POST",
      url: "/admin/events/import",
      headers: { authorization: `Bearer ${masterToken}` },
      payload: { backup: fixture },
    });
    assert.equal(secondImport.statusCode, 201);
    const second = secondImport.json().events[0] as { id: number; eventName: string };
    importedIds.push(second.id);
    assert.equal(second.eventName, `${eventName} (Import)`);

    const thirdImport = await app.inject({
      method: "POST",
      url: "/admin/events/import",
      headers: { authorization: `Bearer ${masterToken}` },
      payload: { backup: fixture },
    });
    assert.equal(thirdImport.statusCode, 201);
    const third = thirdImport.json().events[0] as { id: number; eventName: string };
    importedIds.push(third.id);
    assert.equal(third.eventName, `${eventName} (Import 2)`);

    // The original event still exists untouched next to its copies.
    const originalExport = await app.inject({
      method: "GET",
      url: `/admin/events/${imported[0].id}/export`,
      headers: { authorization: `Bearer ${masterToken}` },
    });
    assert.equal(originalExport.statusCode, 200);
    assert.deepEqual(
      (originalExport.json() as EventBackupFile).events[0].data,
      fixture.events[0].data
    );
  } finally {
    for (const id of importedIds) {
      try {
        eventStore.deleteEvent(id);
      } catch {
        // Already gone — nothing to clean up.
      }
    }
  }
});

test("export-all includes fresh events with empty data and export is master-only", { concurrency: false }, async () => {
  configureMasterCredentials();
  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const masterToken = await auth.loginMaster();

  const eventName = createEventPrefix("backup-export-all");
  const event = createTestEvent({
    eventName,
    eventPasscode: "pass",
    adminUsername: "chef",
    adminPassword: "secret",
  });

  // A brand-new event has no domain tables yet; export must still succeed.
  const exportAll = await app.inject({
    method: "GET",
    url: "/admin/events/export",
    headers: { authorization: `Bearer ${masterToken}` },
  });
  assert.equal(exportAll.statusCode, 200);
  const file = exportAll.json() as EventBackupFile;
  const entry = file.events.find((e) => e.eventName === eventName);
  assert.ok(entry);
  assert.deepEqual(entry.data.users, []);
  assert.deepEqual(entry.data.orders, []);
  assert.equal(entry.adminUsername, "chef");

  // Event admins must not be able to pull full backups.
  const adminToken = await auth.loginAdmin({
    eventId: event.id,
    username: "chef",
    password: "secret",
  });
  const forbidden = await app.inject({
    method: "GET",
    url: `/admin/events/${event.id}/export`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(forbidden.statusCode, 403);
});

test("export of a missing event returns 404 and malformed imports are rejected", { concurrency: false }, async () => {
  configureMasterCredentials();
  const app = await createAppFixture(buildApp);
  const auth = createAuthFixture(app);
  const masterToken = await auth.loginMaster();

  const missingExport = await app.inject({
    method: "GET",
    url: "/admin/events/999999/export",
    headers: { authorization: `Bearer ${masterToken}` },
  });
  assert.equal(missingExport.statusCode, 404);
  assert.equal(missingExport.json().error.code, "EVENT_NOT_FOUND");

  const badImport = await app.inject({
    method: "POST",
    url: "/admin/events/import",
    headers: { authorization: `Bearer ${masterToken}` },
    payload: { backup: { kind: "not-a-backup", formatVersion: 1, exportedAt: "x", events: [] } },
  });
  assert.equal(badImport.statusCode, 400);
});
