# Connecting the app to the API

## 1. Install the two missing dependencies

```bash
npx expo install @react-native-async-storage/async-storage expo-crypto
```

Neither is in `package.json` yet. They're needed because the app's identity is a
device-generated UUID that has to persist across launches — `expo-crypto` makes it
(`Math.random()` is not a safe source for an identifier that keys a household's data)
and AsyncStorage keeps it.

## 2. Point the app at your machine

Edit `src/api/config.ts` and set `LAN_IP` to your computer's IP:

```bash
ipconfig                    # Windows -> "IPv4 Address"
ipconfig getifaddr en0      # macOS
```

Then start the API bound to all interfaces:

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**`localhost` will not work from a phone or Android emulator** — there it means the
device itself, not your laptop. That single mistake accounts for most "Network request
failed" errors; the API client detects it and says so in the error message.

Phone and computer must be on the same Wi-Fi, and Windows Firewall has to allow
inbound `:8000` (it prompts the first time — if you dismissed it, allow `python.exe`).

## 3. Register the device once, on app start

In `App.tsx`, before rendering the navigator:

```tsx
import { useEffect, useState } from 'react';
import { registerDevice } from './src/api/freshwise';

// inside App()
const [ready, setReady] = useState(false);
useEffect(() => {
  registerDevice(1)               // household size; update later via updateMe()
    .then(() => setReady(true))
    .catch((e) => { console.warn('API unreachable:', e.message); setReady(true); });
}, []);
```

**Every other endpoint returns 404 until this has run** — it's what creates the profile
for this device's UUID. Note the app still renders if the call fails, so a dead backend
doesn't leave users stuck on a blank screen.

## 4. Swap the screens over

The new data layer ships as **`src/data/pantryItems.api.ts`** so it sits alongside your
existing mock file and nothing breaks on install. Your screens keep compiling against
the old `pantryItems.ts` until you're ready.

When you are, either update the imports screen-by-screen (recommended — you can migrate
one screen at a time and keep the app runnable), or once every screen is converted,
delete the old file and rename this one to `pantryItems.ts`.

It keeps the same helper names, so most screens change by one or two lines.

### `PantryScreen.tsx`

```diff
- import { PANTRY_ITEMS, formatQuantity, getExpiryInfo } from '../data/pantryItems';
+ import { usePantry, formatQuantity, getExpiryInfo } from '../data/pantryItems.api';

+ const { items, loading, error, refresh } = usePantry();
- data={PANTRY_ITEMS}
+ data={items}

- const expiry = getExpiryInfo(item.purchasedDate, item.expiryDate);
+ const expiry = getExpiryInfo(item);
```

### `UseFirstScreen.tsx`

```tsx
const { items } = usePantry({ expiringWithinDays: 3 });   // server-side filter
```

### `FoodDetailScreen` / `RecordOutcomeScreen` / `MarkConsumedScreen` / `MarkWastedScreen`

```diff
- const item = getPantryItemById(route?.params?.id) ?? getPantryItemById('milk')!;
+ // import { usePantryItem } from '../data/pantryItems.api';
+ const { item, loading } = usePantryItem(route?.params?.id);
+ if (loading || !item) return null;   // or a spinner
```

The `?? getPantryItemById('milk')!` fallback has to go — it was covering for mock data
that always existed. With a real API a missing id means the item was deleted or belongs
to another device, and silently showing milk instead would be worse than showing nothing.

### `MarkWastedScreen.tsx` — the actual save

Replace the `// TODO: POST the wasted outcome` block:

```tsx
import { recordOutcome } from '../api/freshwise';

const handleSave = async () => {
  try {
    await recordOutcome({
      itemId: item.id,
      status: 'wasted',
      quantity: Number(wastedQty) || 0,
      reasonLabel: reason,                                  // 'Over-purchased' etc.
      notes: reason === 'Other' ? otherReason : undefined,  // free text goes here
    });
    navigation.navigate('WasteRecorded', { id: item.id, wastedQty: Number(wastedQty) || 0, reason });
  } catch (e: any) {
    Alert.alert("Couldn't save", e.message);
  }
};
```

`recordOutcome` translates your UI labels (`'Over-purchased'`) into the API's enum
(`bought_too_much`). **This mapping is required, not cosmetic** — sending the raw label
returns 422. Verified: all six labels in `WASTE_REASONS` map to values the API accepts.

`MarkConsumedScreen` is the same with `status: 'consumed'` and no reason — the API
rejects a reason on a consumed log.

## What logging does

`recordOutcome` is the **only** way an item becomes consumed or wasted. In one
transaction it writes the log row *and* decrements the item's quantity. Log less than
the full amount and the item stays in the pantry as `partially_used` with the remainder.

`updatePantryItem` deliberately won't accept `consumed`/`wasted` — that path would skip
the log, and the waste would never reach the insights dashboard.

After any outcome, call `refresh()` from `usePantry()` so the list reflects the change.

## Quick reference

| What you want | Call |
|---|---|
| Register on first launch | `registerDevice(householdSize)` |
| Pantry list | `usePantry()` |
| Expiring soon | `usePantry({ expiringWithinDays: 3 })` |
| One item | `usePantryItem(id)` |
| Add food | `addPantryItem({ name, quantity, unit, expiry_date })` |
| Mark consumed/wasted | `recordOutcome({ itemId, status, quantity, reasonLabel })` |
| Home stats | `getDashboardSummary(30)` |
| Waste over time | `getWeeklyWaste(12)` |
| Recipes from pantry | `getRecipeRecommendations({ limit: 20 })` |
| Barcode scan | `lookupProduct(barcode)` |
| Storage guidance | `lookupStorage(canonicalFoodName)` |
| Price (national) | `lookupPrice(canonicalFoodName)` |
| Price (your state) | `lookupPriceByState(name, 'Selangor')` |

Full interactive docs: **http://YOUR_IP:8000/docs** while the server runs.

## Two things that will bite you

**Nutrition is mostly missing.** Only ~6% of the 6,885 Malaysian products carry any
nutrient values. `null` means *unknown*, never zero — render "—", not "0 g". Check
`nutrition_source` to see whether a figure came off the label or is Open Food Facts'
own estimate.

**Attribution is legally required.** Open Food Facts data is ODbL — wherever you show
product info, show the `license` field. PriceCatcher is CC BY 4.0, same idea.

## Sanity check before wiring screens

```bash
curl http://YOUR_IP:8000/health
# {"status":"ok"}
```

If that fails from your laptop, the API isn't running. If it works on the laptop but
the app still errors, it's the `localhost`/LAN_IP problem in step 2.
