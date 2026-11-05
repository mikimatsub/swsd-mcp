import { describe, expect, it } from 'vitest';
import { toTask } from '../../../src/swsd/mappers/task.js';

describe('toTask completion', () => {
  it.each([
    { is_complete: true, state: undefined, expectedState: 'Completed', completed: true },
    { is_complete: true, state: 'In Progress', expectedState: 'Completed', completed: true },
    { is_complete: false, state: 'Completed', expectedState: 'New', completed: false },
    { is_complete: false, state: 'In Progress', expectedState: 'In Progress', completed: false },
    { is_complete: false, state: undefined, expectedState: 'New', completed: false },
  ])('honors is_complete=$is_complete with state=$state consistently', ({ is_complete, state, expectedState, completed }) => {
    expect(toTask({ id: 1234567, name: 'Synthetic task', is_complete, state })).toMatchObject({
      id: 1234567, state: expectedState, completed,
    });
  });

  it.each([
    { state: 'Completed', is_complete: undefined, completed: true },
    { state: 'New', is_complete: undefined, completed: false },
    { state: 'Completed', is_complete: 'false', completed: true },
    { state: undefined, is_complete: undefined, completed: false },
  ])('falls back to state=$state when is_complete=$is_complete is not boolean', ({ state, is_complete, completed }) => {
    expect(toTask({ id: 1234567, state, is_complete })).toMatchObject({ state: state ?? '', completed });
  });
});
