'use client';

import { useState } from 'react';

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
  const [copied, setCopied] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(details)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        Copy details
      </button>
      {copied ? <span role="status">Copied.</span> : null}
    </>
  );
}
