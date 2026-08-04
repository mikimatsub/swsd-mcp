import { z } from 'zod';

/** Conservative request-shape limits for MCP inputs accepted over stdio or HTTP. */
export const MAX_LABEL_CHARS = 500;
export const MAX_QUERY_CHARS = 2_000;
export const MAX_LONG_TEXT_CHARS = 100_000;
export const MAX_FILTER_ITEMS = 100;
export const MAX_RELATION_IDS = 1_000;
export const MAX_CUSTOM_FIELDS = 100;
export const MAX_REQUEST_VARIABLES = 100;
export const MAX_TIME_ENTRY_NAME_CHARS = 2_000;
export const MAX_EMAIL_CHARS = 320;

export const EmailInput = z.string().max(MAX_EMAIL_CHARS).email();

export const IsoDateOrDateTimeInput = z
  .union([z.iso.date().max(64), z.iso.datetime({ offset: true }).max(64)])
  .describe('ISO 8601 date (YYYY-MM-DD) or RFC 3339 datetime with a timezone.');

export const RelativeTimeAliasInput = z
  .string()
  .trim()
  .max(4)
  .regex(/^[1-9]\d{0,2}[hdw]$/, 'Use Nh, Nd, or Nw with an amount from 1 to 365.')
  .refine((value) => Number.parseInt(value, 10) <= 365, {
    message: 'Relative time amount must be between 1 and 365.',
  });
