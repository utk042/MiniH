import { formatCents } from '../lib/format';

export function Price({ cents }: { cents: number | null }) {
  return <span className="price">{formatCents(cents)}</span>;
}
