export const STARTUP_FONT_FAIL_OPEN_MS = 3_000;
export const STARTUP_IDENTITY_FAIL_OPEN_MS = 2_000;

type StartupReadiness = {
  fontsLoaded: boolean;
  fontLoadFailed: boolean;
  fontDeadlineReached: boolean;
  deviceReady: boolean;
};

/**
 * Startup must remain usable offline. Bundled font failures fall back to the
 * platform font after a short deadline, while remote API registration is not
 * part of this gate at all.
 */
export function canEnterApp(state: StartupReadiness): boolean {
  const typographyReady = state.fontsLoaded
    || state.fontLoadFailed
    || state.fontDeadlineReached;
  return typographyReady && state.deviceReady;
}
