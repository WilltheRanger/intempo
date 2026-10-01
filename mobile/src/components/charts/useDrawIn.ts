import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useState } from 'react';

import { DRAW_IN_MS, drawProgress } from '../../lib/charts/drawIn';
import { useReducedMotion } from '../../lib/useReducedMotion';

/**
 * 0 to 1: how much of a graph to show, drawing in on arrival.
 *
 * **Again every time its screen comes back into view**, not only on mount:
 * tabs stay mounted, so a graph on Insights that drew once at launch would
 * never move again however often the tab was opened. Outside a navigator it
 * simply draws on mount. With reduced motion it is drawn at once.
 */
export function useDrawIn(): number {
  const reduceMotion = useReducedMotion();
  const navigation = useContext(NavigationContext);
  const [progress, setProgress] = useState(reduceMotion ? 1 : 0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!navigation) return;
    return navigation.addListener('focus', () => setRun((n) => n + 1));
  }, [navigation]);

  useEffect(() => {
    if (reduceMotion) {
      setProgress(1);
      return;
    }
    let frame = 0;
    const start = Date.now();
    setProgress(0);
    const step = () => {
      const p = drawProgress(Date.now() - start, DRAW_IN_MS);
      setProgress(p);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [run, reduceMotion]);

  return progress;
}
