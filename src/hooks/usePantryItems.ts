import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getPantryItems, PantryItem } from '../data/pantryItems';

export function usePantryItems() {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getPantryItems()
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your pantry.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(refresh);

  return { items, loading, error, refresh };
}