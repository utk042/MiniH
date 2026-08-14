import type { MatchLeg } from '../lib/data/matches';

/**
 * The demo moment: a loop of 2–4 cards with arrows showing who gives what to
 * whom. Pure SVG, no physics library — node positions are placed by hand on a
 * circle, arrows are quadratic béziers bowed away from the centre so a 2-way
 * swap's two arrows don't sit on top of each other.
 *
 * The reveal animation is plain CSS keyframes with no trigger logic at all:
 * every time this renders into fresh DOM — a first page load, or a Next.js
 * navigation to a different match — the browser runs it once automatically,
 * because that is what CSS animations do on newly inserted elements. No
 * IntersectionObserver, no client component, no "has it played yet" state.
 * prefers-reduced-motion is handled once, globally, in app/globals.css.
 */

const SIZE = 440;
const CENTER = SIZE / 2;
const RADIUS = 148;
const CARD_W = 122;
const CARD_H = 54;

interface Point {
  x: number;
  y: number;
}

function nodePosition(index: number, count: number): Point {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return { x: CENTER + RADIUS * Math.cos(angle), y: CENTER + RADIUS * Math.sin(angle) };
}

/** Where a straight line from `from` toward `to` crosses that card's border. */
function edgePoint(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const scaleX = CARD_W / 2 / Math.abs(dx || 1e-6);
  const scaleY = CARD_H / 2 / Math.abs(dy || 1e-6);
  const scale = Math.min(scaleX, scaleY, 1);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

export function CycleView({ legs, currentUserId }: { legs: MatchLeg[]; currentUserId: string | null }) {
  const count = legs.length;
  const nodes = legs.map((leg, i) => ({
    id: leg.giverId,
    handle: leg.giverHandle,
    name: leg.giverDisplayName,
    isYou: leg.giverId === currentUserId,
    pos: nodePosition(i, count),
  }));

  return (
    <div className="cycle-wrap">
      <svg
        className="cycle-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        style={{ maxWidth: `${SIZE}px` }}
        role="img"
        aria-label={`A ${count}-way cycle: ${legs
          .map((l) => `${l.giverHandle} gives ${l.bookTitle} to ${l.receiverHandle}`)
          .join('; ')}.`}
      >
        <defs>
          <marker id="cycle-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--stamp)" />
          </marker>
        </defs>

        {legs.map((leg, i) => {
          const from = nodes[i].pos;
          const to = nodes[(i + 1) % count].pos;
          const start = edgePoint(from, to);
          const end = edgePoint(to, from);

          // Bow the curve away from the ring's centre, clockwise, so a 2-way
          // swap's two opposite arrows separate into a lens shape instead of
          // overlapping.
          const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
          const away = { x: mid.x - CENTER, y: mid.y - CENTER };
          const awayLength = Math.hypot(away.x, away.y) || 1;
          const bow = count === 2 ? 46 : 30;
          const control = {
            x: mid.x + (away.x / awayLength) * bow,
            y: mid.y + (away.y / awayLength) * bow,
          };

          // Point on the quadratic curve at t=0.5, pushed a little further out
          // for the label so it clears the stroke.
          const labelBase = {
            x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
            y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
          };
          const labelOut = { x: labelBase.x - CENTER, y: labelBase.y - CENTER };
          const labelOutLength = Math.hypot(labelOut.x, labelOut.y) || 1;
          const label = {
            x: labelBase.x + (labelOut.x / labelOutLength) * 12,
            y: labelBase.y + (labelOut.y / labelOutLength) * 12,
          };

          const bookLabel = truncate(leg.bookTitle, 24);
          const labelWidth = Math.min(Math.max(bookLabel.length * 6.1, 40), 170);

          return (
            <g key={`${leg.giverId}-${leg.receiverId}`} className="cycle-arrow" style={{ animationDelay: `${220 + i * 140}ms` }}>
              <path
                d={`M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`}
                fill="none"
                stroke="var(--stamp)"
                strokeWidth={2}
                markerEnd="url(#cycle-arrowhead)"
                className="cycle-arrow__path"
              />
              <rect
                x={label.x - labelWidth / 2}
                y={label.y - 9}
                width={labelWidth}
                height={16}
                fill="var(--paper)"
              />
              <text x={label.x} y={label.y + 3} textAnchor="middle" className="cycle-book-label">
                {bookLabel}
              </text>
            </g>
          );
        })}

        {nodes.map((node, i) => (
          // Position and animation are split across two nested groups on
          // purpose: a CSS `transform` (which the keyframe animation sets)
          // takes precedence over an SVG `transform` attribute on the SAME
          // element, so animating the positioned group directly would
          // silently discard its translate(x, y) once the animation applied
          // — every card would end up stacked at the origin. The animated
          // scale/opacity lives on an inner, unpositioned group instead.
          <g key={node.id} transform={`translate(${node.pos.x - CARD_W / 2}, ${node.pos.y - CARD_H / 2})`}>
            <g className="cycle-node" style={{ animationDelay: `${i * 140}ms` }}>
              <rect
                width={CARD_W}
                height={CARD_H}
                fill={node.isYou ? 'var(--paper-stamp)' : '#fff'}
                stroke={node.isYou ? 'var(--stamp)' : 'var(--border)'}
                strokeWidth={node.isYou ? 1.5 : 1}
              />
              <text x={CARD_W / 2} y={22} textAnchor="middle" className={node.isYou ? 'cycle-node-name cycle-node-you' : 'cycle-node-name'}>
                {node.isYou ? 'YOU' : `@${truncate(node.handle, 14)}`}
              </text>
              <text x={CARD_W / 2} y={38} textAnchor="middle" className="cycle-book-label">
                {truncate(node.isYou ? node.name : initials(node.name), 16)}
              </text>
            </g>
          </g>
        ))}
      </svg>

      <ol className="cycle-legend" aria-label="Who gives what to whom">
        {legs.map((leg) => {
          const giverIsYou = leg.giverId === currentUserId;
          const receiverIsYou = leg.receiverId === currentUserId;
          return (
            <li key={`${leg.giverId}-${leg.receiverId}`} className="cycle-leg">
              <span className={giverIsYou ? 'mono' : 'mono muted'} style={giverIsYou ? { fontWeight: 700 } : undefined}>
                {giverIsYou ? 'You' : `@${leg.giverHandle}`}
              </span>
              <span className="cycle-leg__arrow" aria-hidden="true">
                gives →
              </span>
              <span className="book-title">
                {leg.bookTitle}
                {leg.bookEditionLabel && <span className="muted"> ({leg.bookEditionLabel})</span>}
                {!leg.exact && <span className="tag mono" style={{ marginLeft: '0.4rem' }}>different edition</span>}
              </span>
              <span className="cycle-leg__arrow" aria-hidden="true">
                →
              </span>
              <span className={receiverIsYou ? 'mono' : 'mono muted'} style={receiverIsYou ? { fontWeight: 700 } : undefined}>
                {receiverIsYou ? 'you' : `@${leg.receiverHandle}`}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
