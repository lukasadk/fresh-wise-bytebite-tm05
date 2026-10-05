import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { getFoodValueWasted } from '../api/freshwise';
import { ApiError } from '../api/client';
import type { FoodValueWasted } from '../api/types';

export type FoodValueWastedState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: FoodValueWasted };

/** Epic 9 (US 9.3 / 9.4): estimated value wasted in one month. Refetches on
 *  every focus, so a waste just recorded is reflected when the user comes back. */
export function useFoodValueWasted(month?: string) {
  const [state, setState] = useState<FoodValueWastedState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setState((prev) => (prev.status === 'ready' && prev.data.month === month ? prev : { status: 'loading' }));
      getFoodValueWasted(month)
        .then((data) => alive && setState({ status: 'ready', data }))
        .catch((err) =>
          alive &&
          setState({
            status: 'error',
            message: err instanceof ApiError ? err.message : 'Could not load food value.',
          }),
        );
      return () => {
        alive = false;
      };
    }, [month, nonce]),
  );

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { state, retry };
}
