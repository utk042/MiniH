import { listMessages } from '../lib/data/messages';
import { formatRelative } from '../lib/format';
import { SendMessageForm } from './SendMessageForm';

export async function MessageThread({ matchId, userId }: { matchId: string; userId: string }) {
  const messages = await listMessages(matchId, userId);

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        Arranging the hand-off
      </p>

      {messages.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.875rem', marginBottom: 'var(--space-4)' }}>
          Nobody has said anything yet. A time and a place is usually enough.
        </p>
      ) : (
        <div className="thread">
          {messages.map((message) => (
            <div key={message.id} className={`message-bubble${message.mine ? ' message-bubble--mine' : ''}`}>
              <p>{message.body}</p>
              <p className="message-meta">
                {message.mine ? 'you' : `@${message.senderHandle}`} · {formatRelative(message.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}

      <SendMessageForm matchId={matchId} />
    </div>
  );
}
