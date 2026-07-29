import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoneDatabase } from "./database";

const deletedFiles: string[] = [];

vi.mock("expo-file-system", () => ({
  File: class {
    public readonly exists = true;
    public constructor(private readonly path: string) {}
    public delete(): void {
      deletedFiles.push(this.path);
    }
  },
}));

describe("account-local privacy purge", () => {
  beforeEach(() => deletedFiles.splice(0));

  it("removes drawing files and every owner-scoped relationship/index row", async () => {
    const statements: string[] = [];
    const database = {
      getAllAsync: vi
        .fn()
        .mockResolvedValue([{ path: "file:///source.stoneink" }, { path: "file:///preview.png" }]),
      withTransactionAsync: async (operation: () => Promise<void>) => operation(),
      runAsync: vi.fn((statement: string) => {
        statements.push(statement);
        return { changes: 0, lastInsertRowId: 0 };
      }),
    } as unknown as StoneDatabase;
    const { SQLitePrivacyRepository } = await import("./privacy");

    await new SQLitePrivacyRepository(database).purgeOwner("owner-1");

    expect(deletedFiles).toEqual(["file:///source.stoneink", "file:///preview.png"]);
    expect(statements.join("\n")).toContain("DELETE FROM project_tags");
    expect(statements.join("\n")).toContain("DELETE FROM tags WHERE owner_id = ?");
    expect(statements.join("\n")).toContain("DELETE FROM sync_cursors");
    expect(statements.join("\n")).toContain("DELETE FROM drawings WHERE owner_id = ?");
    expect(statements.join("\n")).toContain("DELETE FROM users WHERE id = ?");
  });
});
