import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, it } from "vitest";

describe("Firestore owner isolation rules", () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: "stone-rules-test",
      firestore: {
        rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
      },
    });
  });

  afterAll(async () => {
    await environment.cleanup();
  });

  it("allows only the owner and enforces monotonic entity revisions", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const other = environment.authenticatedContext("other").firestore();
    const reference = owner.doc("users/owner/documents/note-1");

    await assertSucceeds(reference.set({ ownerId: "owner", revision: 1, markdown: "# Local" }));
    await assertSucceeds(reference.get());
    await assertFails(other.doc(reference.path).get());
    await assertSucceeds(reference.update({ ownerId: "owner", revision: 2 }));
    await assertFails(reference.update({ ownerId: "owner", revision: 4 }));
    await assertFails(reference.update({ ownerId: "other", revision: 3 }));
  });

  it("allows owner-scoped immutable sync events and rejects foreign events", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const other = environment.authenticatedContext("other").firestore();
    const event = {
      eventId: "event-1",
      ownerId: "owner",
      entityId: "note-1",
      entityType: "document",
      revision: 1,
      idempotencyKey: "device:document:note-1:1",
    };
    await assertSucceeds(owner.doc("users/owner/syncEvents/event-1").set(event));
    await assertFails(owner.doc("users/owner/syncEvents/event-1").update({ revision: 2 }));
    await assertFails(
      other.doc("users/owner/syncEvents/event-2").set({ ...event, eventId: "event-2" }),
    );
  });

  it("enforces owner identity and revisions for devices and settings", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const device = owner.doc("users/owner/devices/device-1");
    await assertSucceeds(device.set({ id: "device-1", ownerId: "owner", revision: 1 }));
    await assertFails(device.update({ id: "device-1", ownerId: "owner", revision: 3 }));
    await assertSucceeds(device.update({ id: "device-1", ownerId: "owner", revision: 2 }));

    const settings = owner.doc("users/owner/settings/owner");
    await assertSucceeds(settings.set({ id: "owner", ownerId: "owner", revision: 1 }));
    await assertFails(settings.update({ id: "owner", ownerId: "owner", revision: 1 }));
  });
});
