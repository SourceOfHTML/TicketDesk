'use client';

import { useRef, useState } from 'react';
import type { ApiResult } from './api';

interface MutationOptions<T> {
  onSuccess?: (data: T) => void;
}

export interface Mutation<T> {
  run: () => Promise<ApiResult<T> | undefined>;
  pending: boolean;
}

/**
 * The one write lifecycle. The ref is set synchronously, so a second Enter-key
 * or programmatic submission is a complete no-op; `pending` only mirrors it for
 * rendering. A rejected `run` never calls `request`.
 */
export function useMutation<T>(
  request: () => Promise<ApiResult<T>>,
  options: MutationOptions<T> = {},
): Mutation<T> {
  const [pending, setPending] = useState(false);
  const running = useRef(false);

  async function run(): Promise<ApiResult<T> | undefined> {
    if (running.current) {
      return undefined;
    }

    running.current = true;
    setPending(true);

    try {
      const result = await request();

      if (result.ok) {
        options.onSuccess?.(result.data);
      }

      return result;
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return { run, pending };
}
