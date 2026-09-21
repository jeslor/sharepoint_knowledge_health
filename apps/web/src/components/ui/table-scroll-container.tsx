import type { ReactNode } from 'react';

// Scopes horizontal scrolling to the table itself, never the page. Without
// this, a <table> with more columns than a narrow viewport can show simply
// pushes the whole page wider — the browser then scrolls the entire
// document (header, sidebar and all) sideways to reveal the clipped
// columns, rather than just the table region.
export function TableScrollContainer({ children }: { children: ReactNode }): JSX.Element {
  return <div className="overflow-x-auto">{children}</div>;
}
