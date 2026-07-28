export interface StoneFontReadiness {
  ready: boolean;
  usingFallback: boolean;
}

export function resolveStoneFontReadiness(
  interLoaded: boolean,
  interFailed: boolean,
): StoneFontReadiness {
  return {
    ready: interLoaded || interFailed,
    usingFallback: interFailed,
  };
}
