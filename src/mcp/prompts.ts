import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

/**
 * Built-in MCP prompts. Each prompt is a read-only playbook that steers the
 * model through existing tools. A prompt is registered only when every tool
 * it depends on is enabled in the active profile, so hosts never see a
 * playbook they cannot run.
 */

const HoursArg = z
  .string()
  .regex(/^(?:[1-9]|[1-9]\d|1[0-5]\d|16[0-8])$/, 'Use a whole number of hours from 1 to 168.')
  .optional();

const GroupArg = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\r\n<>`]+$/, 'Group name must be plain single-line text.')
  .optional();

const GroupIdArg = z
  .string()
  .regex(/^[1-9]\d*$/, 'Use a positive numeric group ID.')
  .refine((v) => Number.isSafeInteger(Number(v)), 'Group ID must be a safe integer.')
  .optional();

const WeekStartArg = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/, 'Use an ISO date like 2026-11-02.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a real calendar date.')
  .optional();

const READ_ONLY_RULE =
  'This is a read-only review. Do not create, update, assign, or delete anything. ' +
  'If a change looks warranted, propose it and wait for the user to approve it explicitly.';

interface PromptDef {
  name: string;
  title: string;
  description: string;
  requires: readonly string[];
  argsSchema: z.ZodObject<z.ZodRawShape>;
  build: (args: Record<string, string | undefined>) => string;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const PROMPTS: readonly PromptDef[] = [
  {
    name: 'swsd_morning_triage',
    title: 'Morning triage',
    description:
      'Start-of-day triage of my SWSD queue: what is new, what is close to breaching SLA, and what to pick up first.',
    requires: ['swsd_get_me', 'swsd_my_queue', 'swsd_sla_risk'],
    argsSchema: z.object({
      group: GroupArg.describe('Optional assignment group name to focus on instead of all my groups.'),
      since_hours: HoursArg.describe('Look-back window for new tickets, in hours (1-168). Default 16.'),
    }),
    build: ({ group, since_hours }) => {
      const hours = since_hours ?? '16';
      const scope = group ? `the "${group}" group` : 'me and my groups';
      return [
        `Run my morning SWSD triage for ${scope}.`,
        '1. Call swsd_get_me to learn my user id, email, and group memberships.',
        `2. Call swsd_my_queue to get open work for ${scope}. Note tickets created or updated in the last ${hours} hours.`,
        '3. Call swsd_sla_risk for the same scope to find breached and critical tickets.',
        '4. Produce a short brief: (a) breached or critical first, with number, title, priority, and time to breach; ' +
          '(b) new since the look-back window; (c) unassigned tickets in my groups; (d) a suggested pick-up order of at most 5 tickets with one-line reasons.',
        'Show times in my local time zone. Link each ticket by its URL when the tool returns one.',
        READ_ONLY_RULE,
      ].join('\n');
    },
  },
  {
    name: 'swsd_sla_risk_review',
    title: 'SLA risk review',
    description: 'Review open incidents at risk of breaching SLA and recommend actions per ticket.',
    requires: ['swsd_sla_risk'],
    argsSchema: z.object({
      within_hours: HoursArg.describe('Treat tickets due within this many hours as at risk (1-168). Default 24.'),
      group: GroupIdArg.describe('Optional positive numeric group ID to limit the review (not a group name).'),
    }),
    build: ({ within_hours, group }) => {
      const hours = within_hours ?? '24';
      return [
        `Review SWSD SLA risk${group ? ` for group ID ${group}` : ''}.`,
        `1. Call swsd_sla_risk with at_risk_within_hours=${hours}${group ? ` and assigned_to_group=${group}` : ''}.`,
        '2. Group the results by risk level: breached, critical, warning.',
        '3. For each breached or critical ticket give number, title, priority, assignee, due time, and one concrete next action (for example reassign, escalate, or update the requester).',
        '4. Call out tickets with no assignee and patterns such as one assignee holding several at-risk tickets.',
        '5. End with counts per risk level and the single most urgent ticket.',
        'Show times in my local time zone.',
        READ_ONLY_RULE,
      ].join('\n');
    },
  },
  {
    name: 'swsd_weekly_change_review',
    title: 'Weekly change review',
    description: 'Review the change calendar for a week: what is scheduled, conflicts, and changes missing approval or plans.',
    requires: ['swsd_change_calendar', 'swsd_list_changes', 'swsd_get_change'],
    argsSchema: z.object({
      week_start: WeekStartArg.describe('ISO date of the first day of the week to review. Default: the next 7 days from today.'),
    }),
    build: ({ week_start }) => {
      const window = week_start
        ? `from ${week_start} to ${addDaysIso(week_start, 7)} (end exclusive)`
        : 'for the next 7 days starting today';
      return [
        `Run a weekly SWSD change review ${window}.`,
        `1. Call swsd_change_calendar ${week_start ? `with from=${week_start} and to=${addDaysIso(week_start, 7)}` : 'with a 7-day window starting today'}.`,
        '2. Use swsd_list_changes and swsd_get_change for any change where you need state, approval, risk, or plan details.',
        '3. Report: (a) changes by day; (b) overlapping windows on the same site, department, or configuration item; ' +
          '(c) changes that are scheduled but not approved, or missing a rollback or test plan; (d) high-risk changes.',
        '4. Finish with a short list of questions to raise at the change advisory meeting.',
        'Show times in my local time zone.',
        READ_ONLY_RULE,
      ].join('\n');
    },
  },
];

export function registerPrompts(server: McpServer, enabledTools: readonly string[]): string[] {
  const enabled = new Set(enabledTools);
  const registered: string[] = [];
  for (const p of PROMPTS) {
    if (!p.requires.every((t) => enabled.has(t))) continue;
    server.registerPrompt(
      p.name,
      { title: p.title, description: p.description, argsSchema: p.argsSchema },
      (args: Record<string, unknown>) => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.build(args as Record<string, string | undefined>) } }],
      }),
    );
    registered.push(p.name);
  }
  return registered;
}
