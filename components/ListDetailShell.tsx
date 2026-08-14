import type { ReactNode } from 'react';

/**
 * List-detail layout with a CSS-only mobile drill-in: both panes are always
 * in the DOM, and a media query hides one or the other based on
 * `hasSelection`. No client JS is needed for the responsive behaviour — the
 * "back" link is just a link to the list route.
 */
export function ListDetailShell({
  list,
  detail,
  hasSelection,
}: {
  list: ReactNode;
  detail: ReactNode;
  hasSelection: boolean;
}) {
  return (
    <div className={`list-detail${hasSelection ? ' list-detail--has-selection' : ''}`}>
      <div className="list-detail__list">{list}</div>
      <div className="list-detail__detail">{detail}</div>
    </div>
  );
}
