// Design tokens extracted directly from the Figma file (colors, radii, spacing, type).
// Keep this file as the single source of truth — never hardcode a hex value in a screen/component.

export const colors = {
  background: '#FCF9F2',
  card: '#FFFFFF',

  primary: '#1F7A42',
  primaryDark: '#13331E',
  primaryPale: '#C7EDD1', // active nav tab bg / light pill
  primaryTint: '#E4F6EA', // stat card bg
  primaryTint2: '#E5F7EB', // food row bg

  // Neutral accent used by the design doc for non-green/non-red selections
  // (waste-reason chips, entry-source tags, filter chips, storage icons) —
  // deliberately distinct from `primary` so a selected state doesn't read as
  // "this is good" or `alertIcon` so it doesn't read as "this is bad".
  slateTeal: '#4A6B7A',
  slateTealDark: '#35505C',

  // Semantic expiry-status colours exactly as named in the Visual &
  // Interaction Design Reference (ACs 1.2.3, 2.1.4, 2.2.4). Used for section
  // headers and status accents. NOTE these are NOT the same values as the
  // expiry *pill* surfaces below -- those came from the Figma export and are
  // slightly different (e.g. Figma green #1F7A42 vs spec Forest Green
  // #2C5F3E). Both are kept rather than silently overwriting the Figma
  // palette; worth reconciling with the designer.
  statusToday: '#D9603B',   // Coral Red    -- expired or due today
  statusSoon: '#C68A2E',    // Amber Gold   -- 1-3 days left
  statusFresh: '#2C5F3E',   // Forest Green -- more than 3 days left

  textPrimary: '#13331E',
  textSecondary: '#63706B',
  border: '#D6E0D6',
  borderSoft: '#CFE5D6',
  borderFilter: '#D9E5DC',

  white: '#FFFFFF',

  // Expiry pill states
  expiryUrgentBg: '#FDE8E1',
  expiryUrgentText: '#B9472E',
  expiryWarnBg: '#FFE7A3',
  expiryWarnText: '#6F5600',
  expirySafeBg: '#C1EFCD',
  expirySafeText: '#1F7A42',

  // Alert banner
  alertBg: '#FFD0C1',
  alertBorder: '#F3C7BC',
  alertIcon: '#D9603B',
  alertTitle: '#6F2B21',
  alertBody: '#7B5A54',

  foodIconBg: '#F4FBF6',

  // Inline validation errors (Add Food form)
  errorText: '#D9603B',

  // Success confirmation toast (e.g. "Added" on My Pantry)
  toastSuccessBg: '#2C5F3E',

  // Entry-source tags on pantry rows
  sourceManual: '#8A8F87',
  sourcePhotoAI: '#4A6B7A',

  // Expiry status border + dot on inventory rows/cards (Epic 2)
  expiryUrgentBorder: '#D9603B', // Coral Red -- expired or due today
  expiryWarnBorder: '#C68A2E', // Amber Gold -- 1-3 days
  expirySafeBorder: '#2C5F3E', // Forest Green -- more than 3 days

  // Empty-state illustration on My Pantry
  emptyStateIllustration: '#D9E4DD',

  // Removable filter chip above the inventory list (Epic 2 continued)
  filterChipBg: '#4A6B7A',

  // Brief highlight on a row after its item was edited
  rowHighlightBg: '#E4EEF1',
} as const;

export const radii = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 26,
  xxl: 28,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

// Font family names as registered via expo-google-fonts. Load these in App.tsx with useFonts().
export const fonts = {
  serif: 'DMSerifDisplay_400Regular',
  regular: 'Inter_400Regular',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const fontSize = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 15,
  title: 16,
  heading: 20,
  display: 31,
} as const;