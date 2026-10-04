/**
 * The share extension opens the app with `stone://dataUrl=<key>`; expo-share-intent reads that
 * payload itself, so the router only needs to land on a real screen instead of "not found".
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return path.includes("dataUrl=") ? "/" : path;
}
