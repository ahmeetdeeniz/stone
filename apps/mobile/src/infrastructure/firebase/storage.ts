import storage from "@react-native-firebase/storage";
import { Directory, File, Paths } from "expo-file-system";

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
    sourcePath: string,
    previewPath: string,
  ): Promise<DrawingStoragePayload> {
    const sourceStoragePath = storagePath(ownerId, drawingId, "source.stoneink");
    const previewStoragePath = storagePath(ownerId, drawingId, "preview.png");
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
}

export function storagePath(
  ownerId: string,
  drawingId: string,
  fileName: "source.stoneink" | "preview.png",
): string {
  return `users/${ownerId}/drawings/${drawingId}/${fileName}`;
}
