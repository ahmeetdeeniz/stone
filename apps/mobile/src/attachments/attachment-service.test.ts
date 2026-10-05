import { describe, expect, it } from "vitest";
import {
  AttachmentService,
  type AttachmentFiles,
  type AttachmentRemote,
  type AttachmentUploadQueue,
} from "./attachment-service";

const png = `${"a".repeat(64)}.png`;
const pdf = `${"b".repeat(64)}.pdf`;

function setup(options: { failUpload?: Set<string> } = {}) {
  const local = new Map<string, string>();
  const queue = new Map<string, { state: string; attempts: number }>();
  const uploads: string[] = [];
  const downloads: string[] = [];
  const files: AttachmentFiles = {
    import: (ownerId, picked) => {
      const fileName = picked.name.endsWith(".pdf") ? pdf : png;
      local.set(`${ownerId}/${fileName}`, `file:///${ownerId}/${fileName}`);
      return Promise.resolve(fileName);
    },
    localUri: (ownerId, fileName) => local.get(`${ownerId}/${fileName}`) ?? null,
    targetUri: (ownerId, fileName) => `file:///${ownerId}/${fileName}`,
  };
  const remote: AttachmentRemote = {
    upload: (_ownerId, fileName) => {
      if (options.failUpload?.has(fileName)) return Promise.reject(new Error("offline"));
      uploads.push(fileName);
      return Promise.resolve();
    },
    download: (ownerId, fileName, target) => {
      downloads.push(fileName);
      local.set(`${ownerId}/${fileName}`, target);
      return Promise.resolve();
    },
  };
  const uploadQueue: AttachmentUploadQueue = {
    enqueue: (ownerId, fileName) => {
      if (!queue.has(`${ownerId}/${fileName}`))
        queue.set(`${ownerId}/${fileName}`, { state: "pending", attempts: 0 });
      return Promise.resolve();
    },
    pending: (ownerId) =>
      Promise.resolve(
        [...queue.entries()]
          .filter(([key, value]) => key.startsWith(`${ownerId}/`) && value.state === "pending")
          .map(([key]) => key.slice(ownerId.length + 1)),
      ),
    markUploaded: (ownerId, fileName) => {
      queue.set(`${ownerId}/${fileName}`, { state: "uploaded", attempts: 0 });
      return Promise.resolve();
    },
    markFailed: (ownerId, fileName) => {
      const entry = queue.get(`${ownerId}/${fileName}`)!;
      entry.attempts += 1;
      return Promise.resolve();
    },
  };
  return {
    service: new AttachmentService(files, remote, uploadQueue),
    local,
    queue,
    uploads,
    downloads,
  };
}

describe("AttachmentService", () => {
  it("queues added files and uploads them on flush", async () => {
    const { service, queue, uploads } = setup();
    expect(await service.add("u1", { uri: "file:///tmp/a.png", name: "a.png" })).toBe(png);
    expect(queue.get(`u1/${png}`)?.state).toBe("pending");
    expect(await service.flush("u1")).toEqual({ uploaded: 1, failed: 0 });
    expect(uploads).toEqual([png]);
    expect(queue.get(`u1/${png}`)?.state).toBe("uploaded");
    expect(await service.flush("u1")).toEqual({ uploaded: 0, failed: 0 });
  });

  it("keeps failed uploads queued for the next sync", async () => {
    const { service, queue } = setup({ failUpload: new Set([pdf]) });
    await service.add("u1", { uri: "file:///tmp/a.png", name: "a.png" });
    await service.add("u1", { uri: "file:///tmp/b.pdf", name: "b.pdf" });
    expect(await service.flush("u1")).toEqual({ uploaded: 1, failed: 1 });
    expect(queue.get(`u1/${pdf}`)).toEqual({ state: "pending", attempts: 1 });
  });

  it("drops queue entries whose local file is gone", async () => {
    const { service, local, queue, uploads } = setup();
    await service.add("u1", { uri: "file:///tmp/a.png", name: "a.png" });
    local.clear();
    expect(await service.flush("u1")).toEqual({ uploaded: 0, failed: 0 });
    expect(uploads).toEqual([]);
    expect(queue.get(`u1/${png}`)?.state).toBe("uploaded");
  });

  it("resolves local files directly and downloads missing ones once", async () => {
    const { service, downloads } = setup();
    const [first, second] = await Promise.all([
      service.resolve("u2", pdf),
      service.resolve("u2", pdf),
    ]);
    expect(first).toBe(`file:///u2/${pdf}`);
    expect(second).toBe(first);
    expect(downloads).toEqual([pdf]);
    await service.resolve("u2", pdf);
    expect(downloads).toEqual([pdf]);
    await expect(service.resolve("u2", "../secret.png")).rejects.toThrow(/invalid/u);
  });
});
