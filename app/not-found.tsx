import Link from 'next/link';
import { Notice } from '../components/Notice';

export default function NotFound() {
  return (
    <Notice heading="No such page">
      Whatever you were looking for isn't filed here. <Link href="/browse">Back to the index.</Link>
    </Notice>
  );
}
