import Link from 'next/link';

export interface Crumb {
  label: string;
  href?: string;
}

// Not wired into any page yet — introduced in 10A alongside the other
// navigation primitives; 10B/10C/10D add it to their respective detail
// pages once those pages exist in their updated form.
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-sm text-slate-500">
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden="true">/</span>}
          {crumb.href ? (
            <Link href={crumb.href} className="hover:text-slate-900 hover:underline">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-slate-900">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
