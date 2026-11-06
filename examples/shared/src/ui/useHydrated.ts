'use client';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * `false` on the server and while React hydrates, `true` once the component is interactive. The
 * components publish it as `data-hydrated` so a test can wait until event handlers are attached
 * (server-rendered HTML is visible, and clickable, before that).
 */
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
