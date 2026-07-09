import { describe, expect, it } from 'vitest';
import {
  buildLifecycleWritePayload,
  toGenericRecordSummary,
} from '../../../src/swsd/mappers/record.js';

describe('generic record mapper', () => {
  it('projects common summary fields defensively', () => {
    expect(
      toGenericRecordSummary({
        id: '42',
        number: '1007',
        name: 'Firewall change',
        state: 'Pending Approval',
        priority: 'High',
        category: { name: 'Network' },
        requester: { id: '5', name: 'Pat', email: 'pat@example.com' },
        assignee: { id: 6, name: 'Sam', email: 'sam@example.com' },
        site: { name: 'HQ' },
        href_account_domain: 'https://example.samanage.com/changes/42',
      }),
    ).toEqual({
      id: 42,
      number: 1007,
      name: 'Firewall change',
      state: 'Pending Approval',
      status: undefined,
      priority: 'High',
      category: 'Network',
      subcategory: undefined,
      site: 'HQ',
      department: undefined,
      requester: { id: 5, name: 'Pat', email: 'pat@example.com' },
      assignee: { id: 6, name: 'Sam', email: 'sam@example.com' },
      owner: undefined,
      user: undefined,
      asset_tag: undefined,
      serial_number: undefined,
      manufacturer: undefined,
      model: undefined,
      ip_address: undefined,
      created_at: undefined,
      updated_at: undefined,
      url: 'https://example.samanage.com/changes/42',
    });
  });

  it('builds change/release write payloads with SWSD nested shapes', () => {
    expect(
      buildLifecycleWritePayload('change', {
        name: 'Patch firewall',
        requester_email: 'pat@example.com',
        assignee_email: 'sam@example.com',
        group_assignee_id: 12,
        site_id: 44,
        configuration_item_ids: [101, 102],
        custom_fields: [{ name: 'Risk', value: 'Medium' }],
      }),
    ).toEqual({
      change: {
        name: 'Patch firewall',
        configuration_item_ids: [101, 102],
        requester: { email: 'pat@example.com' },
        assignee: { email: 'sam@example.com' },
        group_assignee: { id: 12 },
        site_id: 44,
        custom_fields_values: {
          custom_fields_value: [{ name: 'Risk', value: 'Medium' }],
        },
      },
    });
  });
});
