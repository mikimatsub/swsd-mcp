import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ToolContext } from '../../config/toolRegistry.js';
import { IsoDateOrDateTimeInput, MAX_LABEL_CHARS } from '../../schemas/limits.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { toGenericRecordDetail } from '../../swsd/mappers/record.js';
import { SafeDeleteInput } from '../shared/safeDelete.js';
import { checkWriteMode } from '../shared/writeMode.js';

const InternalId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Label = z.string().min(1).max(MAX_LABEL_CHARS);
const HardwareInput = z.object({ hardware_id: InternalId.describe('Internal hardware asset ID.') });
const WarrantyRefInput = HardwareInput.extend({ warranty_id: InternalId.describe('Internal warranty ID.') });
const ContractInput = z.object({ contract_id: InternalId.describe('Internal contract ID.') });
const WarrantyFields = z.object({
  service: Label,
  provider: Label.optional(),
  start_date: IsoDateOrDateTimeInput.optional(),
  end_date: IsoDateOrDateTimeInput.optional(),
  status: Label.optional(),
});
const ItemFields = z.object({
  name: Label,
  version: z.string().max(MAX_LABEL_CHARS).optional(),
  tag: z.string().max(MAX_LABEL_CHARS).optional(),
  quantity: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
    .describe('Item quantity; sent to SWSD as `qty`.'),
});
const Confirmation = SafeDeleteInput.pick({ confirm: true, confirm_id: true });

const SUBRESOURCES = {
  warranty: {
    kind: 'hardware warranty', stem: 'hardware_warranty', root: 'warranty',
    parent: 'hardware_id', child: 'warranty_id', collection: 'hardwares', children: 'warranties',
    add: HardwareInput.extend(WarrantyFields.shape),
    update: WarrantyRefInput.extend(WarrantyFields.partial().shape),
    delete: WarrantyRefInput.extend(Confirmation.shape),
    fields: Object.keys(WarrantyFields.shape), identity: ['service', 'provider'],
    apiNames: {} as Record<string, string>,
  },
  item: {
    kind: 'contract item', stem: 'contract_item', root: 'item',
    parent: 'contract_id', child: 'item_id', collection: 'contracts', children: 'items',
    add: ContractInput.extend(ItemFields.shape),
    // SWSD contract items expose no stable ids (SolarWinds support confirmed), so only add is offered.
    update: ContractInput.extend(ItemFields.partial().shape),
    delete: ContractInput.extend(Confirmation.shape),
    fields: Object.keys(ItemFields.shape), identity: ['name', 'version', 'tag'],
    // SWSD names the item quantity `qty`; the tool input keeps the readable name.
    apiNames: { quantity: 'qty' } as Record<string, string>,
  },
} as const;

type Subresource = typeof SUBRESOURCES[keyof typeof SUBRESOURCES];

function unwrap(raw: unknown, root: string): unknown {
  return raw && typeof raw === 'object' && root in raw
    ? (raw as Record<string, unknown>)[root]
    : raw;
}

function readRecord(raw: unknown, root: string) {
  const record = toGenericRecordDetail(unwrap(raw, root));
  return record && Number.isSafeInteger(record.id) && record.id > 0 ? record : null;
}

function collectionPath(cfg: Subresource, parentId: number): string {
  return '/' + cfg.collection + '/' + String(parentId) + '/' + cfg.children;
}

export function registerListHardwareWarranties(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'swsd_list_hardware_warranties',
    {
      description: 'List warranties for an SWSD hardware asset by internal hardware_id.',
      inputSchema: HardwareInput,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const { body } = await ctx.client.get<unknown>(collectionPath(SUBRESOURCES.warranty, input.hardware_id) + '.json');
        const rows = unwrap(body, 'warranties');
        if (!Array.isArray(rows)) return toolError('Could not parse hardware warranties response from SWSD.');
        const warranties = rows.map((row: unknown) => readRecord(row, 'warranty'));
        if (warranties.some((record) => record === null)) {
          return toolError('Could not parse hardware warranties response from SWSD.');
        }
        return structuredResult(
          { hardware_id: input.hardware_id, warranties },
          'Returned ' + String(warranties.length) + ' warranties for hardware ' + String(input.hardware_id) + '.',
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

function registerSubresourceWrite(server: McpServer, ctx: ToolContext, cfg: Subresource, update: boolean): void {
  server.registerTool(
    'swsd_' + (update ? 'update_' : 'add_') + cfg.stem,
    {
      description:
        (update ? 'Update an SWSD ' : 'Add an SWSD ') + cfg.kind + '. Requires internal ' + cfg.parent +
        (update ? ' and ' + cfg.child + '. Only provided fields are sent. ' : '. Required: ' + cfg.fields[0] + '. ') +
        'WRITE — honors SWSD_WRITE_MODE and does not retry on transient failure.',
      inputSchema: update ? cfg.update : cfg.add,
      annotations: { readOnlyHint: false, destructiveHint: update, openWorldHint: true, idempotentHint: false },
    },
    async (input: Record<string, unknown>) => {
      try {
        const fields: Record<string, unknown> = {};
        for (const key of cfg.fields) {
          if (input[key] !== undefined) fields[cfg.apiNames[key] ?? key] = input[key];
        }
        const changed = cfg.fields.filter((key) => input[key] !== undefined);
        if (update && changed.length === 0) {
          return toolError('No fields to update — provide at least one field besides the parent and child IDs.');
        }
        const payload = { [cfg.root]: fields };
        const path = collectionPath(cfg, input[cfg.parent] as number) +
          (update ? '/' + String(input[cfg.child]) : '') + '.json';
        const gated = checkWriteMode(ctx, {
          method: update ? 'PUT' : 'POST', path, body: payload,
          action: (update ? 'update ' : 'add ') + cfg.kind,
        });
        if (gated) return gated;
        const { body } = update
          ? await ctx.client.put<unknown>(path, payload)
          : await ctx.client.post<unknown>(path, payload);
        const record = readRecord(body, cfg.root);
        if (!record) return toolError('Could not parse ' + (update ? 'updated-' : 'created-') + cfg.root + ' response from SWSD.');
        return structuredResult(
          { [cfg.root]: record, ...(update ? { changed_fields: changed } : {}) },
          (update ? 'Updated ' : 'Added ') + cfg.kind + ' ' + String(record.id) +
            (update ? ' (' + changed.join(', ') + ').' : '.'),
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

function registerSubresourceDelete(server: McpServer, ctx: ToolContext, cfg: typeof SUBRESOURCES.warranty): void {
  server.registerTool(
    'swsd_delete_' + cfg.stem,
    {
      description:
        'DESTRUCTIVE — delete an SWSD ' + cfg.kind + '. Requires internal ' + cfg.parent + ' and ' + cfg.child + '. ' +
        'First call without confirmation to preview the record from its parent. Ask the user to confirm, ' +
        'then re-call with confirm:true and confirm_id equal to the previewed child id. ' +
        'Dry-run mode always previews; disabled mode blocks. Does not retry DELETE requests.',
      inputSchema: cfg.delete,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input: Record<string, unknown>) => {
      try {
        const parentId = input[cfg.parent] as number;
        const id = input[cfg.child] as number;
        const request = { method: 'DELETE' as const, path: collectionPath(cfg, parentId) + '/' + String(id) + '.json' };
        // Follow safeDelete: disabled blocks before any lookup, and dry-run always previews.
        const gated = checkWriteMode(ctx, { ...request, action: 'delete ' + cfg.kind + ' ' + String(id) });
        if (gated?.isError) return gated;
        const { body } = await ctx.client.get<unknown>(collectionPath(cfg, parentId) + '.json');
        const rows = unwrap(body, cfg.children);
        if (!Array.isArray(rows)) {
          return toolError('Could not verify ' + cfg.kind + ' list from SWSD. No DELETE request was sent.');
        }
        const found = rows.map((row: unknown) => readRecord(row, cfg.root)).find((row) => row?.id === id);
        if (!found) return toolError('Not found: ' + cfg.kind + ' ' + String(id) + '. No DELETE request was sent.');
        const record: Record<string, unknown> = { id, [cfg.parent]: parentId };
        // Only identity fields are exposed, never the raw record, parent, or headers.
        for (const key of cfg.identity) record[key] = typeof found[key] === 'string' ? found[key] : null;
        if (gated || input.confirm !== true || input.confirm_id !== id) {
          const hint = 'Ask the user to confirm deletion of this ' + cfg.kind +
            ', then re-call with confirm:true and confirm_id:' + String(id) + ' (the internal child id).';
          return structuredResult(
            {
              ...(gated ? { dry_run: true } : { confirmation_required: true }),
              would_delete: record, request, hint,
            },
            (gated ? 'Dry run' : 'Confirmation required') + ': would delete ' + cfg.kind + ' ' + String(id) +
              '. No DELETE request was sent. ' + hint,
          );
        }
        await ctx.client.delete(request.path);
        return structuredResult(
          { deleted: true, record, request },
          'Deleted ' + cfg.kind + ' ' + String(id) + '.',
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

export const registerAddHardwareWarranty = (server: McpServer, ctx: ToolContext): void =>
  registerSubresourceWrite(server, ctx, SUBRESOURCES.warranty, false);
export const registerUpdateHardwareWarranty = (server: McpServer, ctx: ToolContext): void =>
  registerSubresourceWrite(server, ctx, SUBRESOURCES.warranty, true);
export const registerDeleteHardwareWarranty = (server: McpServer, ctx: ToolContext): void =>
  registerSubresourceDelete(server, ctx, SUBRESOURCES.warranty);
export const registerAddContractItem = (server: McpServer, ctx: ToolContext): void =>
  registerSubresourceWrite(server, ctx, SUBRESOURCES.item, false);
