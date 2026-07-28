import storage from "@react-native-firebase/storage";
import { Directory, File, Paths } from "expo-file-system";
import { storagePath } from "./storage-path";

export { storagePath } from "./storage-path";

export interface DrawingStoragePayload {
  sourcePath: string;
  previewPath: string;
  sourceStoragePath: string;
  previewStoragePath: string;
}

export class FirebaseDrawingStorage {
  public async upload(
    ownerId: string,
    drawingId: string,
    revision: number,
    sourcePath: string,
    previewPath: string,
  ): Promise<DrawingStoragePayload> {
    const sourceStoragePath = storagePath(ownerId, drawingId, revision, "source.stoneink");
    const previewStoragePath = storagePath(ownerId, drawingId, revision, "preview.png");
    await storage().ref(sourceStoragePath).putFile(sourcePath, { contentType: "application/json" });
    await storage().ref(previewStoragePath).putFile(previewPath, { contentType: "image/png" });
    return { sourcePath, previewPath, sourceStoragePath, previewStoragePath };
  }

  public async download(
    ownerId: string,
    drawingId: string,
    sourceStoragePath: string,
    previewStoragePath: string,
  ): Promise<DrawingStoragePayload> {
    const directory = new Directory(Paths.document, "drawings");
    directory.create({ idempotent: true });
    const sourceFile = new File(directory, `${drawingId}.stoneink`);
    const previewFile = new File(directory, `${drawingId}.png`);
    await File.downloadFileAsync(
      await storage().ref(sourceStoragePath).getDownloadURL(),
      sourceFile,
      { idempotent: true },
    );
    await File.downloadFileAsync(
      await storage().ref(previewStoragePath).getDownloadURL(),
      previewFile,
      { idempotent: true },
    );
    return {
      sourcePath: sourceFile.uri,
      previewPath: previewFile.uri,
      sourceStoragePath,
      previewStoragePath,
    };
  }

  public async deleteOwnerDrawings(ownerId: string): Promise<void> {
    await deleteTree(storage().ref(`users/${ownerId}/drawings`));
  }
}

async function deleteTree(reference: ReturnType<ReturnType<typeof storage>["ref"]>): Promise<void> {
  const result = await reference.listAll();
  for (const prefix of result.prefixes) await deleteTree(prefix);
  for (const item of result.items) await item.delete();
}
