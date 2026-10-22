'use client';

interface ErrorBannerProps {
  messages: string[];
  /** Present only for a 5xx, which also gets a Copy details control. */
  details?: string;
}

export function ErrorBanner({ messages, details }: ErrorBannerProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div role="alert">
      {messages.map((message, index) => (
        <p key={`${index}-${message}`}>{message}</p>
      ))}
      {details === undefined ? null : <CopyDetails details={details} />}
    </div>
  );
}

function CopyDetails({ details }: { details: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(details).catch(() => undefined);
      }}
    >
      Copy details
    </button>
  );
}
