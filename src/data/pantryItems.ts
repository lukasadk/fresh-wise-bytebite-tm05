// API-backed replacement for the mock pantry data.
//
// The exported surface is deliberately close to the old mock file so screens
// change as little as possible:
//
//   KEPT, unchanged signature:  formatQuantity(item)
//   KEPT, SIMPLER signature:    getExpiryInfo(item)        <- was (purchased, expiry)
//   REPLACED:                   PANTRY_ITEMS               -> usePantry()
//   REPLACED:                   getPantryItemById(id)      -> usePantryItem(id)
//
// Why getExpiryInfo changed: the mock version measured days from the item's own
// purchasedDate, because every mock item was "just bought" (its own TODO said to
// swap this for a real `new Date()` once the backend existed). The server now
// computes `days_to_expiry` from the real today, so this just reads that field
// and the whole parseDisplayDate/Hermes workaround disappears.

import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { listPantry, getPantryItem } from '../api/freshwise';
import { ApiError } from '../api/client';
import type { FoodItem } from '../api/types';

export type ExpiryLevel = 'urgent' | 'warn' | 'safe';

/** What the screens render. A thin view over the API's FoodItem. */
export type PantryItem = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  purchaseDate: string | null; // ISO
  expiryDate: string | null; // ISO
  daysToExpiry: number | null;
  status: FoodItem['status'];
  /** The user's own storage choice; null = not specified. */
  storage: FoodItem['storage'];
  /** How the item was captured -- drives the Manual/Photo AI tag on pantry rows. */
  source: FoodItem['source'];
  canonicalFoodName: string | null;
  barcode: string | null;
};

// Display labels for the backend's raw source enum -- 'Manual'/'Photo AI'
// (Epic 1 AC4) are what the UI shows; 'barcode' isn't in that spec, so it
// falls back to the Manual (grey) styling rather than crashing or showing the
// raw lowercase enum value.
export const SOURCE_LABELS: Record<FoodItem['source'], string> = {
  manual: 'Manual',
  barcode: 'Barcode',
  photo: 'Photo AI',
};

export function toPantryItem(f: FoodItem): PantryItem {
  return {
    id: f.item_id,
    name: f.name,
    category: f.category ?? '',
    quantity: Number(f.quantity),
    unit: f.unit ?? '',
    purchaseDate: f.purchase_date ?? null,
    expiryDate: f.expiry_date ?? null,
    daysToExpiry: f.days_to_expiry,
    status: f.status,
    storage: f.storage,
    source: f.source,
    canonicalFoodName: f.canonical_food_name,
    barcode: f.barcode,
  };
}

// --- display helpers (pure -- unchanged behaviour) -------------------------

export function formatQuantity(item: Pick<PantryItem, 'quantity' | 'unit'>): string {
  const qty = Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(1);
  return `${qty} ${item.unit}`.trim();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO ("2026-08-27") -> the app's display format ("27 Aug 2026").
 *  Parsed by hand rather than with `new Date(str)`: non-ISO string parsing is
 *  implementation-defined, and Hermes (the RN engine) doesn't behave like V8 --
 *  the original file hit exactly this and rendered "NaN days" on device only. */
export function formatDisplayDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export type ExpiryInfo = {
  daysLeft: number | null;
  expiryLevel: ExpiryLevel;
  rowExpiryLabel: string;
  detailExpiryTitle: string;
  detailDaysLeftLabel: string;
};

/** Single source of truth for every expiry-derived label and colour.
 *  Now takes the item itself and reads the server-computed countdown. */
export function getExpiryInfo(item: Pick<PantryItem, 'daysToExpiry'>): ExpiryInfo {
  const daysLeft = item.daysToExpiry;

  if (daysLeft === null || daysLeft === undefined) {
    return {
      daysLeft: null,
      expiryLevel: 'safe',
      rowExpiryLabel: 'No date',
      detailExpiryTitle: 'No expiry date set',
      detailDaysLeftLabel: '—',
    };
  }

  // AC 2.1.4: Coral Red is 0-days/expired ONLY -- 1-3 days is Amber Gold.
  const expiryLevel: ExpiryLevel = daysLeft <= 0 ? 'urgent' : daysLeft <= 3 ? 'warn' : 'safe';
  const rowExpiryLabel =
    daysLeft < 0 ? 'Expired' : daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft} days`;
  const detailExpiryTitle =
    daysLeft < 0
      ? 'Expired'
      : daysLeft === 0
        ? 'Expires today'
        : daysLeft === 1
          ? 'Expires tomorrow'
          : `Expires in ${daysLeft} days`;
  const detailDaysLeftLabel =
    daysLeft < 0 ? 'Expired' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;

  return { daysLeft, expiryLevel, rowExpiryLabel, detailExpiryTitle, detailDaysLeftLabel };
}

// --- data hooks ------------------------------------------------------------

type ListState = {
  items: PantryItem[];
  loading: boolean;
  error: string | null;
  /** Call after adding an item or recording an outcome so the list re-fetches. */
  refresh: () => Promise<void>;
};

/** Replaces the old `PANTRY_ITEMS` constant.
 *  Pass expiringWithinDays for the "Use First" screen. */
export function usePantry(opts: { expiringWithinDays?: number } = {}): ListState {
  const { expiringWithinDays } = opts;
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPantry({ expiringWithinDays });
      setItems(data.map(toPantryItem));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your pantry.');
    } finally {
      setLoading(false);
    }
  }, [expiringWithinDays]);

  // Refetches every time this screen regains focus (not just when
  // expiringWithinDays changes) -- e.g. returning from Add Food, Edit, or after
  // a bulk action needs the list to already be current without the caller
  // remembering to call refresh() themselves.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        setLoading(true);
        try {
          const data = await listPantry({ expiringWithinDays });
          if (alive) setItems(data.map(toPantryItem));
        } catch (e) {
          // guard against setting state after unmount -- a slow request on a
          // screen the user already left would otherwise warn and leak
          if (alive) setError(e instanceof ApiError ? e.message : 'Could not load your pantry.');
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [expiringWithinDays])
  );

  return { items, loading, error, refresh };
}

/** Replaces the old synchronous `getPantryItemById(id)`. Refetches on focus, not
 *  just when `id` changes -- e.g. returning to Food Detail after Mark Consumed
 *  needs the updated quantity without the id itself ever changing. */
export function usePantryItem(id?: string) {
  const [item, setItem] = useState<PantryItem | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!id) {
        setItem(null);
        setLoading(false);
        return;
      }
      let alive = true;
      setLoading(true);
      setError(null);
      getPantryItem(id)
        .then((f) => alive && setItem(toPantryItem(f)))
        .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Could not load this item.'))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, [id])
  );

  return { item, loading, error };
}