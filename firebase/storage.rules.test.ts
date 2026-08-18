import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Firebase Storage drawing boundary", () => {
  it("keeps drawing files owner-scoped and type/size constrained", () => {
    const rules = readFileSync(resolve(process.cwd(), "storage.rules"), "utf8");
    expect(rules).toContain("request.auth.uid == uid");
    expect(rules).toContain(
      "match /users/{uid}/drawings/{drawingId}/revisions/{revision}/{fileName}",
    );
    expect(rules).toContain(
      "match /users/{uid}/drawings/{drawingId}/revisions/{revision}/{uploadId}/{fileName}",
    );
    expect(rules).toContain("revision.matches('^[1-9][0-9]*$')");
    expect(rules).toContain("fileName in ['source.stoneink', 'preview.png']");
    expect(rules).toContain("allow read, delete: if owner()");
    expect(rules).toContain("allow create, update: if false");
    expect(rules).toContain("request.resource.contentType == 'application/json'");
    expect(rules).toContain("request.resource.contentType == 'image/png'");
    expect(rules).toContain("request.resource.size <= 10 * 1024 * 1024");
    expect(rules).toContain("allow read, write: if false");
  });

  it("keeps account deletion wired to owner-scoped drawing cleanup", () => {
    const remote = readFileSync(
      resolve(process.cwd(), "apps/mobile/src/infrastructure/firebase/firestore.ts"),
      "utf8",
    );
    const storage = readFileSync(
      resolve(process.cwd(), "apps/mobile/src/infrastructure/firebase/storage.ts"),
      "utf8",
    );
    expect(remote).toContain("await this.drawingStorage.deleteOwnerDrawings(ownerId)");
    expect(storage).toContain("storage().ref(`users/${ownerId}/drawings`)");
    expect(storage).toContain("await deleteObject(item)");
    expect(storage).toContain("deleteRevision");
    expect(storage).toContain("deleteDrawing");
  });
});

describe.runIf(Boolean(process.env.FIREBASE_STORAGE_EMULATOR_HOST))(
  "Firebase Storage drawing emulator rules",
  () => {
    let environment: RulesTestEnvironment;

    beforeAll(async () => {
      environment = await initializeTestEnvironment({
        projectId: "demo-stone",
        storage: { rules: readFileSync(resolve(process.cwd(), "storage.rules"), "utf8") },
      });
    });

    afterAll(async () => {
      await environment.cleanup();
    });

    it("allows only immutable owner revision files with the expected MIME type", async () => {
      const owner = environment.authenticatedContext("owner").storage();
      const other = environment.authenticatedContext("other").storage();
      const bytes = new TextEncoder().encode('{"schema":1}');
      const path = "users/owner/drawings/drawing-1/revisions/1/source.stoneink";
      const variantPath =
        "users/owner/drawings/drawing-1/revisions/1/device%3Adrawing-1%3A1/source.stoneink";

      await assertSucceeds(
        uploadBytes(ref(owner, path), bytes, { contentType: "application/json" }),
      );
      await assertFails(uploadBytes(ref(owner, path), bytes, { contentType: "application/json" }));
      await assertSucceeds(
        uploadBytes(ref(owner, variantPath), bytes, { contentType: "application/json" }),
      );
      await assertFails(
        uploadBytes(ref(owner, variantPath), bytes, { contentType: "application/json" }),
      );
      await assertFails(uploadBytes(ref(other, path), bytes, { contentType: "application/json" }));
      await assertFails(
        uploadBytes(
          ref(owner, "users/owner/drawings/drawing-1/revisions/0/source.stoneink"),
          bytes,
          { contentType: "application/json" },
        ),
      );
      await assertFails(
        uploadBytes(
          ref(owner, "users/owner/drawings/drawing-1/revisions/2/source.stoneink"),
          bytes,
          { contentType: "text/plain" },
        ),
      );
      await assertFails(
        uploadBytes(ref(owner, "users/owner/drawings/drawing-1/source.stoneink"), bytes, {
          contentType: "application/json",
        }),
      );

      const legacyPath = "users/owner/drawings/legacy/source.stoneink";
      await environment.withSecurityRulesDisabled(async (context) => {
        await uploadBytes(ref(context.storage(), legacyPath), bytes, {
          contentType: "application/json",
        });
      });
      await assertSucceeds(getBytes(ref(owner, legacyPath)));
      await assertFails(getBytes(ref(other, legacyPath)));
    });
  },
);
