'use client';

import { useEffect, useRef, useState } from 'react';
import type { Datum } from './types';

export function useChart(onHover?: (item: Datum | null) => void) {
  const [active,setActive] = useState<Datum | null>(null);
  const [hidden,setHidden] = useState<Set<string>>(() => new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (next: Datum | null, delay = 0) => {
    clearTimeout(timer.current);
    const update = () => { setActive(next); onHover?.(next); };
    if (delay) timer.current = setTimeout(update,delay);
    else update();
  };
  const bind = (item: Datum) => ({
    tabIndex:0, onMouseEnter:() => change(item,80), onMouseLeave:() => change(null,60),
    onFocus:() => change(item), onBlur:() => change(null),
  });
  const toggle = (key: string) => {
    change(null);
    setHidden(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return { active, hidden, toggle, bind };
}
