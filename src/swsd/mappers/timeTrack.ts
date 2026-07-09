export interface TimeTrackSummary {
  id: number;
  name: string;
  minutes_parsed?: number;
  creator?: { id?: number; name?: string; email?: string };
  created_at?: string;
  updated_at?: string;
}

export function toTimeTrack(raw: unknown): TimeTrackSummary | null {
  if (!isPlainObject(raw)) return null;
  const id = numberOrNull(raw.id);
  if (id === null) return null;
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : '',
    minutes_parsed: numberOrUndefined(raw.minutes_parsed),
    creator: nestedPerson(raw.creator),
    created_at: stringOrUndefined(raw.created_at),
    updated_at: stringOrUndefined(raw.updated_at),
  };
}

export function buildTimeTrackPayload(fields: {
  name?: string;
  minutes_parsed?: number;
}): { time_track: Record<string, unknown> } {
  const time_track: Record<string, unknown> = {};
  if (fields.name !== undefined) time_track.name = fields.name;
  if (fields.minutes_parsed !== undefined) time_track.minutes_parsed = fields.minutes_parsed;
  return { time_track };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function numberOrUndefined(v: unknown): number | undefined {
  const n = numberOrNull(v);
  return n === null ? undefined : n;
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function nestedPerson(
  parent: unknown,
): { id?: number; name?: string; email?: string } | undefined {
  if (!isPlainObject(parent)) return undefined;
  const id = numberOrUndefined(parent.id);
  const name = stringOrUndefined(parent.name);
  const email = stringOrUndefined(parent.email);
  if (id === undefined && name === undefined && email === undefined) return undefined;
  return { id, name, email };
}
