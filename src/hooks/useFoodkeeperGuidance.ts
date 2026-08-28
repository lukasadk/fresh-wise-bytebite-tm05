import { useEffect, useState } from 'react';
import { getStorageGuidance, FoodkeeperStorage } from '../data/foodkeeper';

// Looked up live rather than stored on the item -- food_item has no storage columns
// at all (see backend/db/erd-schema.sql), this is purely a reference-data lookup.
export function useFoodkeeperGuidance(name?: string, category?: string) {
  const [guidance, setGuidance] = useState<FoodkeeperStorage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!name && !category) {
      setGuidance(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    getStorageGuidance(name ?? '', category ?? '')
      .then((result) => {
        if (!cancelled) setGuidance(result);
      })
      .catch(() => {
        if (!cancelled) setGuidance(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [name, category]);

  return { guidance, loading };
}