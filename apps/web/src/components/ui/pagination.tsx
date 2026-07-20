import type { PaginationMeta } from '@sph/types';
import { Button } from './button';

export function Pagination({ pagination, onPageChange }: { pagination: PaginationMeta; onPageChange: (page: number) => void }): JSX.Element {
  const { page, totalPages, total } = pagination;

  return (
    <div className="flex items-center justify-between text-sm text-slate-600">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span>
          Page {page} of {totalPages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
