import { useState } from "react";
import useCompactLayout from "./useCompactLayout";

export default function useResponsiveList(items, key, batchSize = 6) {
  const compact = useCompactLayout();
  const [display, setDisplay] = useState({ key, count: batchSize });
  if (display.key !== key) setDisplay({ key, count: batchSize });
  const count = compact ? (display.key === key ? display.count : batchSize) : items.length;
  return {
    items: items.slice(0, count),
    count: Math.min(count, items.length),
    total: items.length,
    compact,
    loadMore: () => setDisplay({ key, count: count + batchSize }),
  };
}
