import type { ApiErrorEnvelope } from './api';

export const GENERIC_SERVER_MESSAGE = 'Something went wrong.';

export interface FormErrors {
  /** Everything that belongs to the form as a whole, rendered in one alert. */
  banner: string[];
  /** Messages keyed by the field whose name prefixed them. */
  fields: Record<string, string[]>;
  statusCode: number;
  /** The original envelope, for the Copy details control on a 5xx. */
  details: string;
}

export function emptyFormErrors(): FormErrors {
  return { banner: [], fields: {}, statusCode: 0, details: '' };
}

/**
 * The one normalizer for every form. A message is field-scoped only when it
 * starts with `<name>: ` for a field this form renders; an explicit allowlist,
 * never a blind split. The renderer keys off statusCode, never off message.
 */
export function normalizeError(error: ApiErrorEnvelope, fields: readonly string[]): FormErrors {
  const details = JSON.stringify(error, null, 2);

  if (error.statusCode >= 500) {
    return {
      banner: [GENERIC_SERVER_MESSAGE],
      fields: {},
      statusCode: error.statusCode,
      details,
    };
  }

  const messages = Array.isArray(error.message) ? error.message : [error.message];
  const normalized = emptyFormErrors();
  normalized.statusCode = error.statusCode;
  normalized.details = details;

  for (const message of messages) {
    const field = fields.find((name) => message.startsWith(`${name}: `));

    if (field === undefined) {
      normalized.banner.push(message);
    } else {
      (normalized.fields[field] ??= []).push(message.slice(field.length + 2));
    }
  }

  return normalized;
}
