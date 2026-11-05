import { describe, it, expect } from 'vitest';
import {
  toCategorySummary,
  toUserSummary,
  toGroupSummary,
  toGroupMembers,
  toSiteSummary,
  toDepartmentSummary,
  toRoleSummary,
} from '../../../src/swsd/mappers/lookup.js';

describe('toCategorySummary', () => {
  it('projects category with hierarchy', () => {
    const raw = {
      id: 100,
      name: 'Hardware',
      parent_id: null,
      default_assignee_id: null,
      children: [
        { id: 101, name: 'Laptop', parent_id: 100 },
        { id: 102, name: 'Monitor', parent_id: 100 },
      ],
      deleted: false,
      default_tags: '',
    };
    const c = toCategorySummary(raw);
    expect(c?.id).toBe(100);
    expect(c?.name).toBe('Hardware');
    expect(c?.parent_id).toBeUndefined();
    expect(c?.children).toEqual([
      { id: 101, name: 'Laptop' },
      { id: 102, name: 'Monitor' },
    ]);
  });

  it('handles category with no children', () => {
    const c = toCategorySummary({ id: 1, name: 'Leaf', parent_id: 5 });
    expect(c?.children).toBeUndefined();
    expect(c?.parent_id).toBe(5);
  });

  it('drops malformed children', () => {
    const c = toCategorySummary({ id: 1, name: 'x', children: [{ name: 'no id' }, 'string', null] });
    expect(c?.children).toEqual([]);
  });

  it('returns null without id', () => {
    expect(toCategorySummary({ name: 'x' })).toBeNull();
  });
});

describe('toUserSummary', () => {
  it('projects a SWSD user', () => {
    const raw = {
      id: 200,
      name: 'Alice Test',
      email: 'alice@example.com',
      disabled: false,
      title: 'Engineer',
      role: { id: 1, name: 'User' },
      site: { id: 1, name: 'Office One' },
      department: { id: 2, name: 'Engineering' },
      available_for_assignment: true,
    };
    const u = toUserSummary(raw);
    expect(u).toEqual({
      id: 200,
      name: 'Alice Test',
      email: 'alice@example.com',
      disabled: false,
      available_for_assignment: true,
      role: 'User',
      site: 'Office One',
      department: 'Engineering',
      title: 'Engineer',
    });
  });

  it('handles disabled user with no email', () => {
    const u = toUserSummary({ id: 1, name: 'Disabled User', disabled: true });
    expect(u?.disabled).toBe(true);
    expect(u?.email).toBeUndefined();
    expect(u?.available_for_assignment).toBeUndefined();
  });

  it('handles site as a bare string (older API shape)', () => {
    const u = toUserSummary({ id: 1, name: 'x', disabled: false, site: 'Office Two' });
    expect(u?.site).toBe('Office Two');
  });
});

describe('toGroupSummary', () => {
  it('counts memberships for member_count', () => {
    const g = toGroupSummary({
      id: 100,
      name: 'Helpdesk',
      description: 'Front-line support',
      disabled: false,
      memberships: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    expect(g?.member_count).toBe(3);
  });

  it('returns undefined member_count when memberships missing', () => {
    const g = toGroupSummary({ id: 100, name: 'x', disabled: false });
    expect(g?.member_count).toBeUndefined();
  });
});

describe('toGroupMembers', () => {
  it('preserves documented membership ids and user labels without inventing user ids', () => {
    expect(toGroupMembers({ memberships: [{ id: '1234567', user: 'Synthetic member' }] })).toEqual([
      { membership_id: 1234567, name: 'Synthetic member' },
    ]);
  });

  it('exposes user ids only from explicit user_id or nested user.id', () => {
    expect(toGroupMembers({ memberships: [
      { id: 1234567, user_id: '1234568', user: 'Synthetic label', email: 'member@example.test' },
      { id: 1234569, user: { id: '1234570', name: 'Nested member', email: 'nested@example.test' } },
      { id: 1234571, name: 'Legacy label', email: 'legacy@example.test', is_user: true },
    ] })).toEqual([
      { membership_id: 1234567, id: 1234568, name: 'Synthetic label', email: 'member@example.test' },
      { membership_id: 1234569, id: 1234570, name: 'Nested member', email: 'nested@example.test' },
      { membership_id: 1234571, name: 'Legacy label', email: 'legacy@example.test' },
    ]);
  });
});

describe('toSiteSummary / toDepartmentSummary / toRoleSummary', () => {
  it('site: minimal projection', () => {
    const s = toSiteSummary({
      id: 300,
      name: 'Office One',
      location: 'OFC1',
      time_zone: 'UTC',
    });
    expect(s).toEqual({
      id: 300,
      name: 'Office One',
      location: 'OFC1',
      description: undefined,
      time_zone: 'UTC',
    });
  });

  it('department: minimal projection', () => {
    const d = toDepartmentSummary({ id: 400, name: 'Engineering', description: '' });
    expect(d?.id).toBe(400);
    expect(d?.name).toBe('Engineering');
    expect(d?.description).toBe('');
  });

  it('role: minimal projection', () => {
    const r = toRoleSummary({ id: 500, name: 'Administrator', description: 'admin role' });
    expect(r?.name).toBe('Administrator');
  });

  it('all return null without id', () => {
    expect(toSiteSummary({ name: 'x' })).toBeNull();
    expect(toDepartmentSummary({ name: 'x' })).toBeNull();
    expect(toRoleSummary({ name: 'x' })).toBeNull();
  });
});
