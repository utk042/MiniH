import type { ReactNode } from 'react';

/**
 * Empty / error state chrome. The words are written per-call-site in a dry
 * campus-noticeboard voice — this component only supplies the frame.
 */
export function Notice({
  heading,
  children,
  tone = 'default',
}: {
  heading: string;
  children: ReactNode;
  tone?: 'default' | 'error';
}) {
  return (
    <div className={`notice${tone === 'error' ? ' notice--error' : ''}`} role={tone === 'error' ? 'alert' : undefined}>
      <p className="notice__heading">{heading}</p>
      <div className="notice__body">{children}</div>
    </div>
  );
}
