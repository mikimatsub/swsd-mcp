import { describe, expect, it } from 'vitest';
import { ListCatalogItemsInput } from '../../../src/schemas/catalogItem.js';
import { CustomFieldsArray } from '../../../src/schemas/customFieldWrite.js';
import { CreateIncidentInput, ListIncidentsInput } from '../../../src/schemas/incident.js';
import {
  MAX_CUSTOM_FIELDS,
  MAX_FILTER_ITEMS,
  MAX_LONG_TEXT_CHARS,
  MAX_QUERY_CHARS,
  MAX_RELATION_IDS,
  MAX_REQUEST_VARIABLES,
} from '../../../src/schemas/limits.js';
import { CreateChangeInput } from '../../../src/schemas/record.js';
import { CreateServiceRequestInput } from '../../../src/schemas/serviceRequest.js';
import { CreateIncidentTaskInput } from '../../../src/schemas/task.js';

describe('shared MCP input boundaries', () => {
  it('accepts documented ISO dates, RFC 3339 datetimes, and relative aliases', () => {
    expect(
      ListIncidentsInput.safeParse({
        updated_from: '2026-08-01',
        updated_to: '2026-08-04T12:30:00-04:00',
        updated_within: '7d',
      }).success,
    ).toBe(true);
    expect(
      CreateIncidentTaskInput.safeParse({
        incident_id: 123,
        name: 'Follow up',
        due_at: '2026-08-05T16:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('rejects invalid calendar dates, timezone-free datetimes, and relative aliases', () => {
    expect(ListIncidentsInput.safeParse({ updated_from: '2026-02-30' }).success).toBe(false);
    expect(ListIncidentsInput.safeParse({ updated_to: '2026-08-04T12:30:00' }).success).toBe(false);
    expect(ListIncidentsInput.safeParse({ updated_within: '366d' }).success).toBe(false);
    expect(ListIncidentsInput.safeParse({ updated_within: 'last week' }).success).toBe(false);
  });

  it('rejects oversized query strings and filter arrays', () => {
    expect(
      ListCatalogItemsInput.safeParse({ query: 'q'.repeat(MAX_QUERY_CHARS + 1) }).success,
    ).toBe(false);
    expect(
      ListIncidentsInput.safeParse({ states: Array(MAX_FILTER_ITEMS + 1).fill('New') }).success,
    ).toBe(false);
    expect(
      ListIncidentsInput.safeParse({ assignee_email: `${'a'.repeat(310)}@example.com` }).success,
    ).toBe(false);
  });

  it('rejects oversized long-form fields', () => {
    expect(
      CreateIncidentInput.safeParse({
        name: 'Bounded incident',
        description: 'x'.repeat(MAX_LONG_TEXT_CHARS + 1),
      }).success,
    ).toBe(false);
  });

  it('rejects oversized custom-field and request-variable collections', () => {
    expect(
      CustomFieldsArray.safeParse(
        Array.from({ length: MAX_CUSTOM_FIELDS + 1 }, (_, index) => ({
          name: `Field ${String(index)}`,
          value: 'value',
        })),
      ).success,
    ).toBe(false);
    expect(
      CreateServiceRequestInput.safeParse({
        catalog_item_id: 123,
        request_variables: Array.from({ length: MAX_REQUEST_VARIABLES + 1 }, (_, index) => ({
          custom_field_id: index + 1,
          value: 'value',
        })),
      }).success,
    ).toBe(false);
  });

  it('rejects oversized relationship collections', () => {
    expect(
      CreateChangeInput.safeParse({
        name: 'Bounded change',
        incident_ids: Array.from({ length: MAX_RELATION_IDS + 1 }, (_, index) => index + 1),
      }).success,
    ).toBe(false);
  });
});
