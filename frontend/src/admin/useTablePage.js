import { useState } from "react";

export function useTablePage(items, size = 25) {
  const [selection, setSelection] = useState({ items, page: 0 });
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(selection.items === items ? selection.page : 0, pages - 1);
  const start = page * size;
  return { rows: items.slice(start, start + size), page, pages, start, end: Math.min(start + size, items.length), total: items.length,
    previous: () => setSelection({ items, page: Math.max(0, page - 1) }),
    next: () => setSelection({ items, page: Math.min(pages - 1, page + 1) }) };
}
