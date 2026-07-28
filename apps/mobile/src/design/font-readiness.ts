export interface StoneFontReadiness {
  ready: boolean;
  usingFallback: boolean;
}

export function resolveStoneFontReadiness(
  interLoaded: boolean,
  bongitaLoaded: boolean,
  interFailed: boolean,
  bongitaFailed: boolean,
): StoneFontReadiness {
  return {
    ready: (interLoaded || interFailed) && (bongitaLoaded || bongitaFailed),
    usingFallback: interFailed || bongitaFailed,
  };
}
