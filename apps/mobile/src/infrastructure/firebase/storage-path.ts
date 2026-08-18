export function storagePath(
  ownerId: string,
  drawingId: string,
  revision: number,
  fileName: "source.stoneink" | "preview.png",
  uploadId?: string,
): string {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Drawing revision must be a positive safe integer.");
  }
  const encodedUploadId = uploadId === undefined ? null : encodeURIComponent(uploadId);
  if (encodedUploadId !== null && (encodedUploadId.length === 0 || encodedUploadId.length > 200)) {
    throw new Error("Drawing upload id must be between 1 and 200 characters.");
  }
  const variant = encodedUploadId === null ? "" : `/${encodedUploadId}`;
  return `users/${ownerId}/drawings/${drawingId}/revisions/${revision}${variant}/${fileName}`;
}
