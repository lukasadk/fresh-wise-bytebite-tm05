import { useEffect, useState } from 'react';

import { getFoodValueMeta } from '../api/freshwise';

// AC 9.1.4: the price-data label ("Based on Malaysian market prices, August
// 2026 (PriceCatcher)") comes from the server, which owns the snapshot -- so
// rebuilding the snapshot for a newer month updates every screen at once.
// The snapshot never changes while the app runs, so it's fetched once and
// shared by every screen; a failed fetch is retried on the next mount.
let cached: string | null = null;
let inflight: Promise<string | null> | null = null;

function loadLabel(): Promise<string | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = getFoodValueMeta()
      .then((meta) => {
        cached = meta.label;
        return cached;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function usePriceLabel(): string | null {
  const [label, setLabel] = useState<string | null>(cached);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    loadLabel().then((value) => alive && value && setLabel(value));
    return () => {
      alive = false;
    };
  }, []);
  return label;
}
