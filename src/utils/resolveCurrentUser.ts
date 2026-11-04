import { decodeJwtPayload, getUserIdFromJwtClaims } from '../swsd/jwt.js';
import { toUserMeRecord } from '../swsd/mappers/me.js';
import type { SwsdClient } from '../swsd/client.js';
import type { UserMeRecord } from '../swsd/types.js';

export interface ResolvedUser extends UserMeRecord {
  email: string;
}

export interface ResolveCurrentUserResult {
  ok: true;
  me: ResolvedUser;
}

export interface ResolveCurrentUserError {
  ok: false;
  message: string;
}

/**
 * Resolve the authenticated user's record from the JWT + /users/{id}.json.
 *
 * Factored out of listMyIncidents so swsd_my_queue (and any future tool that
 * needs "who am I?") can reuse it without copy-pasting the three-step
 * decode → extract id → fetch flow.
 */
export async function resolveCurrentUser(
  token: string,
  client: SwsdClient,
): Promise<ResolveCurrentUserResult | ResolveCurrentUserError> {
  const claims = decodeJwtPayload(token);
  if (claims === null) {
    return { ok: false, message: 'Could not decode SWSD JWT to identify the authenticated user.' };
  }
  const userId = getUserIdFromJwtClaims(claims);
  if (userId === null) {
    return {
      ok: false,
      message: 'JWT payload missing user_id (or legacy user_ic). The token may be from an unsupported issuer.',
    };
  }
  const usersResult = await client.get<unknown>(`/users/${String(userId)}.json`);
  const me = toUserMeRecord(usersResult.body);
  if (me === null || me.email === undefined) {
    return { ok: false, message: `Could not resolve email for user id ${String(userId)}.` };
  }
  return { ok: true, me: { ...me, email: me.email } };
}
