import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getPantryItemById, PantryItem } from '../data/pantryItems';

export function usePantryItem(id?: string) {
  const [item, setItem] = useState<PantryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);

      getPantryItemById(id)
        .then((result) => {
          if (!cancelled) setItem(result ?? null);
        })
        .catch(() => {
          if (!cancelled) setError("Couldn't load this item.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [id])
  );

  return { item, loading, error };
}