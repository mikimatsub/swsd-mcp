import type { McpServer } from '@modelcontextprotocol/server';
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
import { EmailInput, MAX_LABEL_CHARS, MAX_LONG_TEXT_CHARS } from '../../schemas/limits.js';
import { registerSafeDelete } from '../shared/safeDelete.js';
import { PaginationOutput } from '../../schemas/output.js';
import { structuredResult } from '../../mcp/output.js';
import { toolError } from '../../mcp/errors.js';
import { mapSwsdError } from '../../swsd/errors.js';
import { requireListArray } from '../../swsd/list-helper.js';
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

interface RecordConfig {
  toolList: string;
  toolGet?: string;
  collectionPath: string;
  labelPlural: string;
  labelSingular: string;
  summaryKey: string;
  detailKey?: string;
  supportsLayout?: boolean;
  readRoot?: string;
  descriptionUse: string;
  write?: {
    root: string;
    create?: z.ZodType<Record<string, unknown>>;
    update?: z.ZodType<{ id: number } & Record<string, unknown>>;
    delete?: boolean;
    required?: string;
  };
}

interface WriteConfig {
  collectionPath: string;
  root: 'change' | 'release';
  labelSingular: string;
}

const RecordLabelInput = z.string().min(1).max(MAX_LABEL_CHARS);
const RecordIdInput = z.number().int().positive().describe('Internal record ID.');
const AssetFields = {
  status_name: RecordLabelInput.optional(),
  site_name: RecordLabelInput.optional(),
  department_name: RecordLabelInput.optional(),
  description: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
};
const CreateHardwareAssetInput = z.object({
  ...AssetFields,
  name: RecordLabelInput,
  asset_tag: RecordLabelInput.optional(),
  owner_email: EmailInput.optional(),
  user_email: EmailInput.optional(),
  technical_contact_email: EmailInput.optional(),
  ip_address: RecordLabelInput.optional(),
  serial_number: RecordLabelInput.optional().describe('Hardware serial number, sent as bio.ssn.'),
});
const CreateMobileDeviceInput = z.object({
  ...AssetFields,
  device_type: RecordLabelInput.optional(),
  manufacturer: RecordLabelInput,
  model: RecordLabelInput,
  serial_number: RecordLabelInput.optional(),
  user_email: EmailInput.optional(),
});
const CreateOtherAssetInput = z.object({
  ...AssetFields,
  name: RecordLabelInput,
  asset_id: RecordLabelInput.optional(),
  asset_type_name: RecordLabelInput.optional(),
  manufacturer: RecordLabelInput.optional(),
  model: RecordLabelInput.optional(),
  serial_number: RecordLabelInput.optional(),
  owner_email: EmailInput.optional(),
  user_email: EmailInput.optional(),
});
const CreateConfigurationItemInput = z.object({
  name: RecordLabelInput,
  description: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
  state: RecordLabelInput.optional().describe('Configuration item state name, such as Active.'),
  site_id: RecordIdInput.optional().describe('Site ID from swsd_list_sites.'),
  department_id: RecordIdInput.optional().describe('Department ID from swsd_list_departments.'),
  user_email: EmailInput.optional(),
});
const UpdatePrinterInput = z.object({
  ...AssetFields,
  id: RecordIdInput,
  name: RecordLabelInput.optional(),
});

const RecordTextInput = z.string().max(MAX_LONG_TEXT_CHARS);
const RecordDateInput = z.iso.date().max(MAX_LABEL_CHARS);
const CurrencyInput = z.string().max(MAX_LABEL_CHARS).regex(/^[A-Z]{3}$/, 'Use a three-letter uppercase currency code.');
const ProcurementLocationFields = {
  site_name: RecordLabelInput.optional(),
  department_name: RecordLabelInput.optional(),
};
const CatalogAssignmentFields = {
  default_assignee_id: RecordIdInput.optional(),
  default_group_assignee_id: RecordIdInput.optional(),
  site_id: RecordIdInput.optional(),
  department_id: RecordIdInput.optional(),
};
const CreateContractInput = z.object({
  name: RecordLabelInput,
  type: RecordLabelInput.optional(),
  status_name: RecordLabelInput.optional(),
  manufacturer_name: RecordLabelInput.optional(),
  start_date: RecordDateInput.optional(),
  end_date: RecordDateInput.optional(),
  ...ProcurementLocationFields,
  note: RecordTextInput.optional(),
});
const CreatePurchaseOrderInput = z.object({
  name: RecordLabelInput,
  state: RecordLabelInput.optional(),
  vendor_name: RecordLabelInput.optional(),
  requester_email: EmailInput.optional(),
  buyer_email: EmailInput.optional(),
  order_date: RecordDateInput.optional(),
  due_date: RecordDateInput.optional(),
  currency: CurrencyInput.optional(),
  payment_terms: RecordLabelInput.optional(),
  notes: RecordTextInput.optional(),
  ...ProcurementLocationFields,
});
const CreateVendorInput = z.object({
  name: RecordLabelInput,
  vendor_type: RecordLabelInput.optional(),
  url: z.url({ protocol: /^https?$/ }).max(MAX_LABEL_CHARS).optional(),
  contact_name: RecordLabelInput.optional(),
  contact_email: EmailInput.optional(),
  contact_phone: RecordLabelInput.optional(),
  telephone: RecordLabelInput.optional(),
  address: RecordLabelInput.optional(),
  city: RecordLabelInput.optional(),
  state: RecordLabelInput.optional(),
  zip: RecordLabelInput.optional(),
  note: RecordTextInput.optional(),
});
const CreateCatalogItemInput = z.object({
  name: RecordLabelInput,
  description: RecordTextInput.optional(),
  state: RecordLabelInput.optional(),
  category_name: RecordLabelInput.optional(),
  price: z.number().nonnegative().optional(),
  currency: CurrencyInput.optional(),
  show_price: z.boolean().optional(),
  ...CatalogAssignmentFields,
  expected_delivery_time: RecordLabelInput.optional(),
});
const CreateChangeCatalogInput = z.object({
  name: RecordLabelInput,
  description: RecordTextInput.optional(),
  change_type: RecordLabelInput.optional(),
  priority: RecordLabelInput.optional(),
  state_id: RecordIdInput.optional().describe('Internal change-catalog state ID.'),
  change_plan: RecordTextInput.optional(),
  rollback_plan: RecordTextInput.optional(),
  test_plan: RecordTextInput.optional(),
  show_in_portal: z.boolean().optional(),
  ...CatalogAssignmentFields,
});

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
    write: {
      root: 'hardware',
      create: CreateHardwareAssetInput,
      update: CreateHardwareAssetInput.partial().extend({ id: RecordIdInput }),
      delete: true,
      required: 'name',
    },
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
    write: {
      root: 'mobile',
      create: CreateMobileDeviceInput,
      update: CreateMobileDeviceInput.partial().extend({ id: RecordIdInput }),
      delete: true,
      required: 'manufacturer and model',
    },
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
    write: {
      root: 'printer',
      update: UpdatePrinterInput,
    },
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
    write: {
      root: 'other_asset',
      create: CreateOtherAssetInput,
      update: CreateOtherAssetInput.partial().extend({ id: RecordIdInput }),
      delete: true,
      required: 'name',
    },
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
    write: {
      root: 'configuration_item',
      create: CreateConfigurationItemInput,
      update: CreateConfigurationItemInput.partial().extend({ id: RecordIdInput }),
      delete: true,
      required: 'name',
    },
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
    write: {
      root: 'contract',
      create: CreateContractInput,
      update: CreateContractInput.partial().extend({ id: RecordIdInput }),
      delete: true,
      required: 'name',
    },
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
    write: {
      root: 'purchase_order',
      create: CreatePurchaseOrderInput,
      update: CreatePurchaseOrderInput.partial().extend({ id: RecordIdInput }),
      delete: true,
      required: 'name',
    },
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
    write: {
      root: 'vendor',
      create: CreateVendorInput,
      update: CreateVendorInput.partial().extend({ id: RecordIdInput }),
      delete: true,
      required: 'name',
    },
  },
  changeCatalogs: {
    toolList: 'swsd_list_change_catalogs',
    toolGet: 'swsd_get_change_catalog',
    collectionPath: '/change_catalogs',
    labelPlural: 'change catalogs',
    labelSingular: 'change catalog',
    summaryKey: 'change_catalogs',
    detailKey: 'change_catalog',
    readRoot: 'change_catalog',
    descriptionUse: 'Use for change catalog template lookup.',
    write: {
      root: 'change_catalog',
      create: CreateChangeCatalogInput,
      update: CreateChangeCatalogInput.partial().extend({ id: RecordIdInput }),
      delete: true,
      required: 'name',
    },
  },
  risks: {
    toolList: 'swsd_list_risks',
    collectionPath: '/risks',
    labelPlural: 'risks',
    labelSingular: 'risk',
    summaryKey: 'risks',
    descriptionUse: 'Use for risk context surfaced by SWSD.',
  },
} as const satisfies Record<string, RecordConfig>;

// Catalog reads retain their dedicated tools in ../catalog/.
const CATALOG_ITEM_WRITE_CONFIG = {
  toolList: 'swsd_list_catalog_items',
  toolGet: 'swsd_get_catalog_item',
  collectionPath: '/catalog_items',
  labelPlural: 'catalog items',
  labelSingular: 'catalog item',
  summaryKey: 'catalog_items',
  detailKey: 'catalog_item',
  descriptionUse: 'Use for service catalog administration.',
  write: {
    root: 'catalog_item',
    create: CreateCatalogItemInput,
    update: CreateCatalogItemInput.partial().extend({ id: RecordIdInput }),
    delete: true,
    required: 'name',
  },
} satisfies RecordConfig;

function readRecord(raw: unknown, root?: string): unknown {
  return root && raw && typeof raw === 'object' && root in raw
    ? (raw as Record<string, unknown>)[root]
    : raw;
}

function pathJson(path: string): string {
  return `${path}.json`;
}

function layoutParams(
  detailLevel: 'short' | 'long' | undefined,
  supportsLayout?: boolean,
): Record<string, unknown> {
  return supportsLayout && detailLevel === 'long' ? { layout: 'long' } : {};
}

function registerListTool(server: McpServer, ctx: ToolContext, cfg: RecordConfig): void {
  server.registerTool(
    cfg.toolList,
    {
      description:
        `List SWSD ${cfg.labelPlural}. ${cfg.descriptionUse} Returns compact summaries` +
        (cfg.toolGet ? `; call ${cfg.toolGet} for full detail.` : '.') +
        ' Only documented pagination/layout parameters are exposed for this endpoint.',
      inputSchema: (cfg.supportsLayout ? ListRecordsInput : ListAssetsInput),
      outputSchema: z.object({
        [cfg.summaryKey]: z.array(GenericSummaryOutput),
        pagination: PaginationOutput,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
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
        const rows = requireListArray(body);
        const records = rows
          .map((row) => toGenericRecordSummary(readRecord(row, cfg.readRoot)))
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

function registerGetTool(server: McpServer, ctx: ToolContext, cfg: RecordConfig): void {
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
      inputSchema: (cfg.supportsLayout ? GetRecordInput : GetAssetInput),
      outputSchema: z.object({
        [detailKey]: z.record(z.string(), z.unknown()),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const { body } = await ctx.client.get<unknown>(
          pathJson(`${cfg.collectionPath}/${String(input.id)}`),
          layoutParams(input.detail_level, cfg.supportsLayout),
        );
        const record = toGenericRecordDetail(readRecord(body, cfg.readRoot));
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
      inputSchema: cfg.input,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
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
      inputSchema: cfg.input,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
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

function recordWriteFields(root: string, input: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'id' || value === undefined) continue;
    if (['status_name', 'site_name', 'department_name', 'asset_type_name', 'vendor_name', 'category_name'].includes(key)) {
      fields[key.slice(0, -5)] = { name: value };
    } else if (['owner_email', 'user_email', 'technical_contact_email', 'requester_email', 'buyer_email'].includes(key)) {
      fields[key.slice(0, -6)] = { email: value };
    } else if (root === 'hardware' && key === 'serial_number') {
      fields.bio = { ssn: value };
    } else {
      fields[key] = value;
    }
  }
  return fields;
}

function registerRecordWrite(
  server: McpServer,
  ctx: ToolContext,
  cfg: RecordConfig,
  action: 'create' | 'update',
): void {
  const write = cfg.write;
  const inputSchema = write?.[action];
  if (!write || !inputSchema || !cfg.toolGet || !cfg.detailKey) return;
  const detailKey = cfg.detailKey;
  const update = action === 'update';
  server.registerTool(
    cfg.toolGet.replace('swsd_get_', `swsd_${action}_`),
    {
      description:
        (update
          ? `Update a SWSD ${cfg.labelSingular} by internal id. Only provided fields are sent. `
          : `Create a SWSD ${cfg.labelSingular}. Required: ${write.required}. `) +
        'WRITE — honors SWSD_WRITE_MODE and does not retry on transient failure.',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: update, openWorldHint: true, idempotentHint: false },
    },
    async (input: Record<string, unknown>) => {
      try {
        const fields = recordWriteFields(write.root, input);
        const changed = Object.keys(fields);
        if (update && changed.length === 0) {
          return toolError('No fields to update — provide at least one field besides id.');
        }
        const payload = { [write.root]: fields };
        const path = pathJson(update ? `${cfg.collectionPath}/${String(input.id)}` : cfg.collectionPath);
        const gated = checkWriteMode(ctx, {
          method: update ? 'PUT' : 'POST',
          path,
          body: payload,
          action: `${action} ${cfg.labelSingular}${update ? ` ${String(input.id)}` : ''}`,
        });
        if (gated) return gated;
        const { body } = update
          ? await ctx.client.put<unknown>(path, payload)
          : await ctx.client.post<unknown>(path, payload);
        const raw = body && typeof body === 'object' && write.root in body
          ? (body as Record<string, unknown>)[write.root]
          : body;
        const record = toGenericRecordDetail(raw);
        if (!record) {
          return toolError(`Could not parse ${update ? 'updated' : 'created'}-${write.root} response from SWSD.`);
        }
        const name = typeof record.name === 'string' ? `: ${record.name}` : '';
        return structuredResult(
          { [detailKey]: record, ...(update ? { changed_fields: changed } : {}) },
          update
            ? `Updated ${cfg.labelSingular} ${String(record.id)} (${changed.join(', ')}).`
            : `Created ${cfg.labelSingular} ${String(record.id)}${name}`,
        );
      } catch (err) {
        return mapSwsdError(err);
      }
    },
  );
}

function registerRecordDelete(server: McpServer, ctx: ToolContext, cfg: RecordConfig): void {
  if (!cfg.write?.delete || !cfg.toolGet) return;
  registerSafeDelete(server, ctx, {
    kind: cfg.labelSingular,
    toolName: cfg.toolGet.replace('swsd_get_', 'swsd_delete_'),
    collectionPath: cfg.collectionPath,
    envelopeKey: cfg.write.root,
  });
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

export const registerCreateHardwareAsset = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.hardwareAssets, 'create');

export const registerUpdateHardwareAsset = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.hardwareAssets, 'update');

export const registerDeleteHardwareAsset = (server: McpServer, ctx: ToolContext): void =>
  registerRecordDelete(server, ctx, READ_CONFIGS.hardwareAssets);

export const registerCreateMobileDevice = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.mobileDevices, 'create');

export const registerUpdateMobileDevice = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.mobileDevices, 'update');

export const registerDeleteMobileDevice = (server: McpServer, ctx: ToolContext): void =>
  registerRecordDelete(server, ctx, READ_CONFIGS.mobileDevices);

export const registerCreateOtherAsset = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.otherAssets, 'create');

export const registerUpdateOtherAsset = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.otherAssets, 'update');

export const registerDeleteOtherAsset = (server: McpServer, ctx: ToolContext): void =>
  registerRecordDelete(server, ctx, READ_CONFIGS.otherAssets);

export const registerCreateConfigurationItem = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.configurationItems, 'create');

export const registerUpdateConfigurationItem = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.configurationItems, 'update');

export const registerDeleteConfigurationItem = (server: McpServer, ctx: ToolContext): void =>
  registerRecordDelete(server, ctx, READ_CONFIGS.configurationItems);

export const registerUpdatePrinter = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.printers, 'update');

export const registerListChangeCatalogs = (server: McpServer, ctx: ToolContext): void =>
  registerListTool(server, ctx, READ_CONFIGS.changeCatalogs);
export const registerGetChangeCatalog = (server: McpServer, ctx: ToolContext): void =>
  registerGetTool(server, ctx, READ_CONFIGS.changeCatalogs);

export const registerCreateContract = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.contracts, 'create');

export const registerUpdateContract = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.contracts, 'update');

export const registerDeleteContract = (server: McpServer, ctx: ToolContext): void =>
  registerRecordDelete(server, ctx, READ_CONFIGS.contracts);

export const registerCreatePurchaseOrder = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.purchaseOrders, 'create');

export const registerUpdatePurchaseOrder = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.purchaseOrders, 'update');

export const registerDeletePurchaseOrder = (server: McpServer, ctx: ToolContext): void =>
  registerRecordDelete(server, ctx, READ_CONFIGS.purchaseOrders);

export const registerCreateVendor = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.vendors, 'create');

export const registerUpdateVendor = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.vendors, 'update');

export const registerDeleteVendor = (server: McpServer, ctx: ToolContext): void =>
  registerRecordDelete(server, ctx, READ_CONFIGS.vendors);

export const registerCreateCatalogItem = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, CATALOG_ITEM_WRITE_CONFIG, 'create');

export const registerUpdateCatalogItem = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, CATALOG_ITEM_WRITE_CONFIG, 'update');

export const registerDeleteCatalogItem = (server: McpServer, ctx: ToolContext): void =>
  registerRecordDelete(server, ctx, CATALOG_ITEM_WRITE_CONFIG);

export const registerCreateChangeCatalog = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.changeCatalogs, 'create');

export const registerUpdateChangeCatalog = (server: McpServer, ctx: ToolContext): void =>
  registerRecordWrite(server, ctx, READ_CONFIGS.changeCatalogs, 'update');

export const registerDeleteChangeCatalog = (server: McpServer, ctx: ToolContext): void =>
  registerRecordDelete(server, ctx, READ_CONFIGS.changeCatalogs);
