import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GetMeInput } from '../../schemas/me.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { decodeJwtPayload, getUserIdFromJwtClaims } from '../../swsd/jwt.js';
import { toUserMeRecord } from '../../swsd/mappers/me.js';
import type { ToolContext } from '../../config/toolRegistry.js';

export function registerGetMe(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_get_me',
    {
      description:
        "Get the SWSD user record for the token's owner — id, email, name, title, " +
        'role, department, site, group_ids, and assignment status. **Call this first** ' +
        'when the request mentions "me", "my", or "I" (e.g. "my tickets", "tickets ' +
        'in my group", "tickets assigned to me"), then pass the returned id/email to ' +
        'assignee_email or requester_email filters on swsd_list_incidents (or use ' +
        'swsd_list_my_incidents which does this in one call). Without this step, ' +
        '"my X" queries cannot be answered correctly.',
      inputSchema: GetMeInput.shape,
      outputSchema: z.object({
        user: z.object({
          id: z.number().int(),
          email: z.string().optional(),
          name: z.string().optional(),
          title: z.string().optional(),
          role: z.string().optional(),
          department: z.string().optional(),
          site: z.string().optional(),
          group_ids: z.array(z.number().int()),
          disabled: z.boolean().optional(),
          available_for_assignment: z.boolean().optional(),
          last_login: z.string().optional(),
        }),
        sources: z.array(z.string()).describe(
          'Which paths populated the response. "jwt" is always present (JWT decode is mandatory). "users-endpoint" is present when /users/{id}.json succeeded. "profile-fallback" is present when /profile.json succeeded (adds last_login).',
        ),
        jwt_claims: z.record(z.string(), z.unknown()).describe(
          'All claims found in the JWT payload. SWSD typically includes user_id (modern; observed in 2026 production tokens) or user_ic (legacy; cited in older API docs samples), plus generated_at. ESM tenants may include service_provider_id or similar.',
        ),
      }).shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      try {
        // Path A: JWT decode (zero-cost, always works if the token is well-formed).
        const claims = decodeJwtPayload(ctx.token);
        if (claims === null) {
          return toolError('Could not decode the SWSD JWT payload. The configured SWSD_TOKEN may be malformed.');
        }
        const userId = getUserIdFromJwtClaims(claims);
        if (userId === null) {
          return toolError('JWT payload missing user_id (or legacy user_ic). The token may be from an unsupported issuer.');
        }

        const sources: string[] = ['jwt'];

        // Path B: /users/{id}.json — documented endpoint.
        let usersBody: unknown;
        try {
          const result = await ctx.client.get<unknown>(`/users/${String(userId)}.json`);
          usersBody = result.body;
          sources.push('users-endpoint');
        } catch (err) {
          // Surface error rather than silently degrading — this is the documented path.
          return mapSwsdError(err);
        }

        // Path C: /profile.json — undocumented but live-verified fallback for the few extra fields.
        let profileBody: unknown = undefined;
        try {
          const result = await ctx.client.get<unknown>(`/profile.json`);
          profileBody = result.body;
          sources.push('profile-fallback');
        } catch {
          // Silent fail — /profile.json is undocumented and may go away. The
          // `users-endpoint` path already gives us the canonical record;
          // /profile.json only adds a few extras.
        }

        const user = toUserMeRecord(usersBody, profileBody);
        if (user === null) {
          return toolError(`Could not parse user record for id ${String(userId)}.`);
        }

        const summary = `You are ${user.name ?? '(unknown name)'} <${user.email ?? '(no email)'}>` +
          (user.role !== undefined ? `, role ${user.role}` : '') +
          (user.group_ids.length > 0 ? `, in ${String(user.group_ids.length)} group${user.group_ids.length === 1 ? '' : 's'}` : '') +
          '.';
        return structuredResult({ user, sources, jwt_claims: claims }, summary);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}
