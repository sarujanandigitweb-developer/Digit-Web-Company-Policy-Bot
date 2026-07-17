import { useEffect, useState } from "react";

/**
 * Delays a fast-changing value.
 *
 * Search inputs feed a react-query key; without this every keystroke is a
 * separate request and the results flicker through intermediate matches.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
