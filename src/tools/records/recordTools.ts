import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CreateChangeInput,
  CreateReleaseInput,
  GetRecordInput,
  ListRecordsInput,
  UpdateChangeInput,
  UpdateReleaseInput,
} from '../../schemas/record.js';
import { GetAssetInput, ListAssetsInput } from '../../schemas/asset.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import {
  buildLifecycleWritePayload,
  toGenericRecordDetail,
  toGenericRecordSummary,
  type LifecycleWriteFields,
} from '../../swsd/mappers/record.js';
import { checkWriteMode } from '../shared/writeMode.js';
import type { ToolContext } from '../../config/toolRegistry.js';

const PersonOutput = z
  .object({
    id: z.number().int().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .optional();

const GenericSummaryOutput = z.object({
  id: z.number().int(),
  number: z.number().int().optional(),
  name: z.string(),
  state: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  site: z.string().optional(),
  department: z.string().optional(),
  requester: PersonOutput,
  assignee: PersonOutput,
  owner: PersonOutput,
  user: PersonOutput,
  asset_tag: z.string().optional(),
  serial_number: z.string().optional(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  ip_address: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  url: z.string().optional(),
});

interface ReadConfig {
  toolList: string;
  toolGet?: string;
  collectionPath: string;
  labelPlural: string;
  labelSingular: string;
  summaryKey: string;
  detailKey?: string;
  supportsLayout?: boolean;
  descriptionUse: string;
}

interface WriteConfig {
  collectionPath: string;
  root: 'change' | 'release';
  labelSingular: string;
}

const READ_CONFIGS = {
  changes: {
    toolList: 'swsd_list_changes',
    toolGet: 'swsd_get_change',
    collectionPath: '/changes',
    labelPlural: 'changes',
    labelSingular: 'change',
    summaryKey: 'changes',
    detailKey: 'change',
    supportsLayout: true,
    descriptionUse: 'Use for change-management review and change planning.',
  },
  releases: {
    toolList: 'swsd_list_releases',
    toolGet: 'swsd_get_release',
    collectionPath: '/releases',
    labelPlural: 'releases',
    labelSingular: 'release',
    summaryKey: 'releases',
    detailKey: 'release',
    supportsLayout: true,
    descriptionUse: 'Use for release-management planning and deployment review.',
  },
  hardwareAssets: {
    toolList: 'swsd_list_hardware_assets',
    toolGet: 'swsd_get_hardware_asset',
    collectionPath: '/hardwares',
    labelPlural: 'hardware assets',
    labelSingular: 'hardware asset',
    summaryKey: 'hardware_assets',
    detailKey: 'hardware_asset',
    supportsLayout: true,
    descriptionUse: 'Use for ITAM hardware inventory lookup before incident/change work.',
  },
  mobileDevices: {
    toolList: 'swsd_list_mobile_devices',
    toolGet: 'swsd_get_mobile_device',
    collectionPath: '/mobiles',
    labelPlural: 'mobile devices',
    labelSingular: 'mobile device',
    summaryKey: 'mobile_devices',
    detailKey: 'mobile_device',
    descriptionUse: 'Use for mobile-device inventory lookup.',
  },
  printers: {
    toolList: 'swsd_list_printers',
    toolGet: 'swsd_get_printer',
    collectionPath: '/printers',
    labelPlural: 'printers',
    labelSingular: 'printer',
    summaryKey: 'printers',
    detailKey: 'printer',
    descriptionUse: 'Use for printer inventory lookup.',
  },
  softwareAssets: {
    toolList: 'swsd_list_software_assets',
    toolGet: 'swsd_get_software_asset',
    collectionPath: '/softwares',
    labelPlural: 'software assets',
    labelSingular: 'software asset',
    summaryKey: 'software_assets',
    detailKey: 'software_asset',
    descriptionUse: 'Use for software inventory and license context.',
  },
  otherAssets: {
    toolList: 'swsd_list_other_assets',
    toolGet: 'swsd_get_other_asset',
    collectionPath: '/other_assets',
    labelPlural: 'other assets',
    labelSingular: 'other asset',
    summaryKey: 'other_assets',
    detailKey: 'other_asset',
    descriptionUse: 'Use for non-hardware/non-software asset lookup.',
  },
  configurationItems: {
    toolList: 'swsd_list_configuration_items',
    toolGet: 'swsd_get_configuration_item',
    collectionPath: '/configuration_items',
    labelPlural: 'configuration items',
    labelSingular: 'configuration item',
    summaryKey: 'configuration_items',
    detailKey: 'configuration_item',
    descriptionUse: 'Use for CMDB context and dependency review before changes.',
  },
  contracts: {
    toolList: 'swsd_list_contracts',
    toolGet: 'swsd_get_contract',
    collectionPath: '/contracts',
    labelPlural: 'contracts',
    labelSingular: 'contract',
    summaryKey: 'contracts',
    detailKey: 'contract',
    supportsLayout: true,
    descriptionUse: 'Use for support, warranty, and procurement context.',
  },
  purchaseOrders: {
    toolList: 'swsd_list_purchase_orders',
    toolGet: 'swsd_get_purchase_order',
    collectionPath: '/purchase_orders',
    labelPlural: 'purchase orders',
    labelSingular: 'purchase order',
    summaryKey: 'purchase_orders',
    detailKey: 'purchase_order',
    descriptionUse: 'Use for procurement context.',
  },
  vendors: {
    toolList: 'swsd_list_vendors',
    toolGet: 'swsd_get_vendor',
    collectionPath: '/vendors',
    labelPlural: 'vendors',
    labelSingular: 'vendor',
    summaryKey: 'vendors',
    detailKey: 'vendor',
    descriptionUse: 'Use for vendor/contact lookup.',
  },
  risks: {
    toolList: 'swsd_list_risks',
    collectionPath: '/risks',
    labelPlural: 'risks',
    labelSingular: 'risk',
    summaryKey: 'risks',
    descriptionUse: 'Use for risk context surfaced by SWSD.',
  },
} as const satisfies Record<string, ReadConfig>;

function pathJson(path: string): string {
  return `${path}.json`;
}

function layoutParams(
  detailLevel: 'short' | 'long' | undefined,
  supportsLayout?: boolean,
): Record<string, unknown> {
  return supportsLayout && detailLevel === 'long' ? { layout: 'long' } : {};
}

function registerListTool(server: McpServer, ctx: ToolContext, cfg: ReadConfig): void {
  server.registerTool(
    cfg.toolList,
    {
      description:
        `List SWSD ${cfg.labelPlural}. ${cfg.descriptionUse} Returns compact summaries` +
        (cfg.toolGet ? `; call ${cfg.toolGet} for full detail.` : '.') +
        ' Only documented pagination/layout parameters are exposed for this endpoint.',
      inputSchema: (cfg.supportsLayout ? ListRecordsInput : ListAssetsInput).shape,
      outputSchema: z.object({
        [cfg.summaryKey]: z.array(GenericSummaryOutput),
        pagination: PaginationOutput,
      }).shape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const params = {
          page: input.page,
          per_page: input.per_page,
          ...layoutParams(input.detail_level, cfg.supportsLayout),
        };
        const { body, pagination } = await ctx.client.get<unknown>(
          pathJson(cfg.collectionPath),
          params,
        );
        const rows = Array.isArray(body) ? body : [];
        const records = rows
          .map(toGenericRecordSummary)
          .filter((x): x is NonNullable<typeof x> => x !== null);
        return structuredResult(
          { [cfg.summaryKey]: records, pagination },
          `Returned ${String(records.length)} ${cfg.labelPlural} (page ${String(pagination.page)}${pagination.has_more ? ', more available' : ''}).`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

function registerGetTool(server: McpServer, ctx: ToolContext, cfg: ReadConfig): void {
  const toolGet = cfg.toolGet;
  const detailKey = cfg.detailKey;
  if (!toolGet || !detailKey) return;
  server.registerTool(
    toolGet,
    {
      description:
        `Fetch one SWSD ${cfg.labelSingular} by internal id. ` +
        (cfg.supportsLayout ? 'Pass detail_level: "long" for SWSD layout=long extras. ' : '') +
        'Returns the upstream detail payload defensively parsed as a JSON object.',
      inputSchema: (cfg.supportsLayout ? GetRecordInput : GetAssetInput).shape,
      outputSchema: z.object({
        [detailKey]: z.record(z.string(), z.unknown()),
      }).shape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const { body } = await ctx.client.get<unknown>(
          pathJson(`${cfg.collectionPath}/${String(input.id)}`),
          layoutParams(input.detail_level, cfg.supportsLayout),
        );
        const record = toGenericRecordDetail(body);
        if (!record) {
          return toolError(`Could not parse ${cfg.labelSingular} ${String(input.id)} response from SWSD.`);
        }
        const name = typeof record.name === 'string' ? `: ${record.name}` : '';
        return structuredResult(
          { [detailKey]: record },
          `${cfg.labelSingular} ${String(record.id)}${name}`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

function registerCreateTool(
  server: McpServer,
  ctx: ToolContext,
  cfg: WriteConfig & {
    tool: string;
    input: typeof CreateChangeInput | typeof CreateReleaseInput;
  },
): void {
  server.registerTool(
    cfg.tool,
    {
      description:
        `Create a SWSD ${cfg.labelSingular}. Required: name. WRITE — honors SWSD_WRITE_MODE and does not retry on transient failure.`,
      inputSchema: cfg.input.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async (input: z.infer<typeof CreateChangeInput> | z.infer<typeof CreateReleaseInput>) => {
      try {
        const payload = buildLifecycleWritePayload(cfg.root, input as LifecycleWriteFields);
        const path = pathJson(cfg.collectionPath);
        const gated = checkWriteMode(ctx, {
          method: 'POST',
          path,
          body: payload,
          action: `create ${cfg.labelSingular}`,
        });
        if (gated) return gated;
        const { body } = await ctx.client.post<unknown>(path, payload);
        const record = toGenericRecordDetail(body);
        if (!record) return toolError(`Could not parse created-${cfg.root} response from SWSD.`);
        const name = typeof record.name === 'string' ? `: ${record.name}` : '';
        return structuredResult({ [cfg.root]: record }, `Created ${cfg.labelSingular} ${String(record.id)}${name}`);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

function registerUpdateTool(
  server: McpServer,
  ctx: ToolContext,
  cfg: WriteConfig & {
    tool: string;
    input: typeof UpdateChangeInput | typeof UpdateReleaseInput;
  },
): void {
  server.registerTool(
    cfg.tool,
    {
      description:
        `Update a SWSD ${cfg.labelSingular}. Pass only fields to change. WRITE — honors SWSD_WRITE_MODE and does not retry on transient failure.`,
      inputSchema: cfg.input.shape,
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async (input: z.infer<typeof UpdateChangeInput> | z.infer<typeof UpdateReleaseInput>) => {
      try {
        const { id, ...fields } = input as { id: number } & LifecycleWriteFields;
        const payload = buildLifecycleWritePayload(cfg.root, fields);
        const path = pathJson(`${cfg.collectionPath}/${String(id)}`);
        const gated = checkWriteMode(ctx, {
          method: 'PUT',
          path,
          body: payload,
          action: `update ${cfg.labelSingular} ${String(id)}`,
        });
        if (gated) return gated;
        const { body } = await ctx.client.put<unknown>(path, payload);
        const record = toGenericRecordDetail(body);
        if (!record) return toolError(`Could not parse updated-${cfg.root} response from SWSD.`);
        const name = typeof record.name === 'string' ? `: ${record.name}` : '';
        return structuredResult({ [cfg.root]: record }, `Updated ${cfg.labelSingular} ${String(record.id)}${name}`);
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

export const registerListChanges = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.changes);
export const registerGetChange = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.changes);
export const registerListReleases = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.releases);
export const registerGetRelease = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.releases);

export const registerListHardwareAssets = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.hardwareAssets);
export const registerGetHardwareAsset = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.hardwareAssets);
export const registerListMobileDevices = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.mobileDevices);
export const registerGetMobileDevice = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.mobileDevices);
export const registerListPrinters = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.printers);
export const registerGetPrinter = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.printers);
export const registerListSoftwareAssets = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.softwareAssets);
export const registerGetSoftwareAsset = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.softwareAssets);
export const registerListOtherAssets = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.otherAssets);
export const registerGetOtherAsset = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.otherAssets);
export const registerListConfigurationItems = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.configurationItems);
export const registerGetConfigurationItem = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.configurationItems);
export const registerListContracts = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.contracts);
export const registerGetContract = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.contracts);
export const registerListPurchaseOrders = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.purchaseOrders);
export const registerGetPurchaseOrder = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.purchaseOrders);
export const registerListVendors = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.vendors);
export const registerGetVendor = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.vendors);
export const registerListRisks = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.risks);

export const registerCreateChange = (server: McpServer, ctx: ToolContext): void =>
  registerCreateTool(server, ctx, {
    tool: 'swsd_create_change',
    collectionPath: '/changes',
    root: 'change',
    labelSingular: 'change',
    input: CreateChangeInput,
  });
export const registerUpdateChange = (server: McpServer, ctx: ToolContext): void =>
  registerUpdateTool(server, ctx, {
    tool: 'swsd_update_change',
    collectionPath: '/changes',
    root: 'change',
    labelSingular: 'change',
    input: UpdateChangeInput,
  });
export const registerCreateRelease = (server: McpServer, ctx: ToolContext): void =>
  registerCreateTool(server, ctx, {
    tool: 'swsd_create_release',
    collectionPath: '/releases',
    root: 'release',
    labelSingular: 'release',
    input: CreateReleaseInput,
  });
export const registerUpdateRelease = (server: McpServer, ctx: ToolContext): void =>
  registerUpdateTool(server, ctx, {
    tool: 'swsd_update_release',
    collectionPath: '/releases',
    root: 'release',
    labelSingular: 'release',
    input: UpdateReleaseInput,
  });
