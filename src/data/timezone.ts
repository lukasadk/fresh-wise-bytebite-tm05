// Device's IANA timezone (e.g. "Asia/Kuala_Lumpur"), sent to dashboard
// endpoints that bucket by calendar month -- e.g. the Report tab's
// "current month vs previous month" comparison -- so boundaries match the
// household's own calendar, not the backend server's.
//
// Intl.DateTimeFormat().resolvedOptions().timeZone is built into Hermes with
// full ICU support as of Expo SDK 50+ (this app is on 57), so no extra
// native module (e.g. expo-localization) is needed just for this.
export function getDeviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || 'UTC';
  } catch {
    // Extremely defensive -- resolvedOptions().timeZone essentially never
    // throws, but falling back to UTC beats crashing a tab over it.
    return 'UTC';
  }
}
