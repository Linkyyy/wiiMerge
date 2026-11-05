import React, { useState } from "react";

export const PAGE_SIZE = 200;
export function usePagination(items, scope) {
  const [position, setPosition] = useState({ scope, page: 0 });
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page =
    position.scope === scope ? Math.min(position.page, pages - 1) : 0;
  return {
    page,
    pages,
    total: items.length,
    rows: items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    go: (next) =>
      setPosition({ scope, page: Math.max(0, Math.min(next, pages - 1)) }),
  };
}
export default function Pagination({ paging, label }) {
  const { page, pages, total, go } = paging;
  if (pages === 1) return null;
  return (
    <nav className="item-pagination" aria-label={label}>
      <span>
        {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} /{" "}
        {total}
      </span>
      <div>
        <button disabled={page === 0} onClick={() => go(0)} aria-label="第一页">
          «
        </button>
        <button
          disabled={page === 0}
          onClick={() => go(page - 1)}
          aria-label="上一页"
        >
          ‹
        </button>
        <small>
          {page + 1} / {pages}
        </small>
        <button
          disabled={page === pages - 1}
          onClick={() => go(page + 1)}
          aria-label="下一页"
        >
          ›
        </button>
        <button
          disabled={page === pages - 1}
          onClick={() => go(pages - 1)}
          aria-label="最后一页"
        >
          »
        </button>
      </div>
    </nav>
  );
}
