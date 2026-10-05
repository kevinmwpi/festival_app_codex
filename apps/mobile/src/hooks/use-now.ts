import { useEffect, useState } from 'react';

/** Current time in ms, re-rendering every `intervalMs` (default one minute) while mounted. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** "just now", "3 min ago", "1 h ago" for a past ISO timestamp. */
export function formatAgo(iso: string | number, now: number): string {
  const then = typeof iso === 'number' ? iso : new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return '';
  }
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ago`;
}
