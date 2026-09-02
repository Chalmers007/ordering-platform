'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * The new-order chime.
 *
 * Synthesised with the Web Audio API rather than shipping an audio file: no
 * asset to load, no format negotiation, and it cannot fail to decode on a
 * cheap kitchen tablet.
 *
 * Browsers refuse to start audio without a user gesture, so the context is
 * created lazily on the first interaction and `unlock()` is wired to the
 * board's first tap.
 */
export function useChime(enabled: boolean) {
  const contextRef = useRef<AudioContext | null>(null);

  const ensureContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!contextRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      contextRef.current = new Ctor();
    }
    return contextRef.current;
  }, []);

  const unlock = useCallback(() => {
    const context = ensureContext();
    if (context?.state === 'suspended') void context.resume();
  }, [ensureContext]);

  const play = useCallback(() => {
    if (!enabled) return;
    const context = ensureContext();
    if (!context) return;
    if (context.state === 'suspended') void context.resume();

    // Two rising tones — audible over a kitchen without being a siren.
    const now = context.currentTime;
    for (const [index, frequency] of [880, 1318.5].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const start = now + index * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    }
  }, [enabled, ensureContext]);

  useEffect(() => {
    return () => {
      void contextRef.current?.close();
      contextRef.current = null;
    };
  }, []);

  return { play, unlock };
}
