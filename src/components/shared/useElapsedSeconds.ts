import { useEffect, useState } from 'react';

/**
 * Running whole-seconds counter while `active` is true, resetting to 0 when it
 * goes false. Turns the 30–90 s ChatHPC reasoning wait into visible progress so
 * a long generation reads as "working", not "hung". Ticks every 250 ms.
 */
export function useElapsedSeconds(active: boolean): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) {
      setSecs(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return secs;
}
