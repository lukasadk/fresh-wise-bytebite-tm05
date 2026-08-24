# FreshWise — React Native (Expo)

Converted from the Figma export (`Generate_React_Code.zip`) — 3 screens done: **Home**, **Pantry**, **Use First**.

## What changed vs. the raw Figma export

- **Absolute positioning → Flexbox.** The Figma export pins every element with `left/top` pixel coordinates, which only looks right at exactly 393×852. All screens here use Flexbox so they adapt to real device sizes.
- **Unicode glyphs → real icons.** `⌂ ▤ ⚡ ◷ ✦ ＋` etc. are replaced with `lucide-react-native` icons and the food illustrations are rebuilt as `react-native-svg` components (pixel-identical paths, ported from the export).
- **Duplicated markup → shared components.** The bottom nav, food row, expiry pill, stat card, etc. were copy-pasted per screen in the export. Here they're single components in `src/components/`, driven by props/data — so visual tweaks happen once.
- **3 separate "preview" screens → real navigation.** The export's `App.tsx` just laid screens side-by-side for the Figma canvas preview. This version wires them into an actual bottom-tab navigator (`@react-navigation/bottom-tabs`) with a custom tab bar matching the design.

## Setup

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android), or press `i` / `a` for a simulator.

## Structure

```
App.tsx                  # font loading + tab navigation
src/theme/theme.ts        # single source of truth for colors, spacing, radii, fonts
src/icons/FoodIcons.tsx   # food illustration SVGs (milk, chicken, spinach, pasta, tomato)
src/icons/NavIcons.tsx    # lucide icon re-exports
src/components/           # Button, ExpiryPill, FoodRow, BottomNav, StatCard, QuickAction, etc.
src/screens/               # HomeScreen, PantryScreen, UseFirstScreen
```

## Not built yet (send PNGs + specs for these)

- Add Food / Add Food — Category
- Food Detail
- Recipes tab content
- Remaining ~20 frames from the 26-frame file

## Known placeholders

- `AddFoodScreen` and `RecipesScreen` in `App.tsx` are empty stubs so navigation doesn't crash — replace once those screens are built.
- Pantry item data is hardcoded in `PantryScreen.tsx` / `UseFirstScreen.tsx` — swap for real API calls once the FastAPI backend is up (see architecture doc: `GET /pantry`, etc.).
