export function storagePath(
  ownerId: string,
  drawingId: string,
  revision: number,
  fileName: "source.stoneink" | "preview.png",
): string {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Drawing revision must be a positive safe integer.");
  }
  return `users/${ownerId}/drawings/${drawingId}/revisions/${revision}/${fileName}`;
}
