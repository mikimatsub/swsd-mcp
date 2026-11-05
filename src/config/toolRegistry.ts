import type { McpServer } from '@modelcontextprotocol/server';
import { registerPrompts } from '../mcp/prompts.js';
import type { Env, ProfileName } from './env.js';
import { PROFILE_TOOLS } from './profiles.js';
import type { SwsdClient } from '../swsd/client.js';

import { registerGetServerInfo } from '../tools/utility/getServerInfo.js';
import { registerHealthCheck } from '../tools/utility/healthCheck.js';
import { registerGetMe } from '../tools/utility/getMe.js';

import { registerListIncidents } from '../tools/incidents/listIncidents.js';
import { registerListMyIncidents } from '../tools/incidents/listMyIncidents.js';
import { registerSlaRisk } from '../tools/incidents/slaRisk.js';
import { registerTicketStats } from '../tools/incidents/ticketStats.js';
import { registerMyQueue } from '../tools/incidents/myQueue.js';
import { registerGetIncident } from '../tools/incidents/getIncident.js';
import { registerCreateIncident } from '../tools/incidents/createIncident.js';
import { registerUpdateIncident } from '../tools/incidents/updateIncident.js';
import { registerAssignIncident } from '../tools/incidents/assignIncident.js';
import { registerUpdateIncidentState } from '../tools/incidents/updateIncidentState.js';
import { registerLinkSolutionToIncident } from '../tools/incidents/linkSolutionToIncident.js';

import { registerListIncidentComments } from '../tools/comments/listIncidentComments.js';
import { registerAddIncidentComment } from '../tools/comments/addIncidentComment.js';
import { registerListRecordComments } from '../tools/comments/listRecordComments.js';
import { registerAddRecordComment } from '../tools/comments/addRecordComment.js';
import { registerUpdateComment } from '../tools/comments/updateComment.js';

import { registerListIncidentTasks } from '../tools/tasks/listIncidentTasks.js';
import { registerCreateIncidentTask } from '../tools/tasks/createIncidentTask.js';
import { registerListRecordTasks } from '../tools/tasks/listRecordTasks.js';
import { registerCreateRecordTask } from '../tools/tasks/createRecordTask.js';
import { registerUpdateTaskState } from '../tools/tasks/updateTaskState.js';

import { registerListProblems } from '../tools/problems/listProblems.js';
import { registerGetProblem } from '../tools/problems/getProblem.js';
import { registerCreateProblem } from '../tools/problems/createProblem.js';
import { registerUpdateProblem } from '../tools/problems/updateProblem.js';

import { registerListCategories } from '../tools/lookups/listCategories.js';
import { registerListSites } from '../tools/lookups/listSites.js';
import {
  registerGetCategory,
  registerGetDepartment,
  registerGetGroup,
  registerGetRole,
  registerGetSite,
  registerGetUser,
} from '../tools/lookups/getLookups.js';
import {
  registerCreateUser,
  registerUpdateUser,
  registerDeleteUser,
  registerCreateGroup,
  registerUpdateGroup,
  registerDeleteGroup,
  registerCreateSite,
  registerUpdateSite,
  registerDeleteSite,
  registerCreateDepartment,
  registerUpdateDepartment,
  registerDeleteDepartment,
  registerCreateCategory,
  registerUpdateCategory,
  registerDeleteCategory,
  registerCreateRole,
  registerUpdateRole,
  registerDeleteRole,
  registerAddGroupMember,
  registerRemoveGroupMember,
} from '../tools/lookups/directoryWrites.js';
import { registerListDepartments } from '../tools/lookups/listDepartments.js';
import { registerListUsers } from '../tools/lookups/listUsers.js';
import { registerListGroups } from '../tools/lookups/listGroups.js';
import { registerListRoles } from '../tools/lookups/listRoles.js';

import { registerSearchSolutions } from '../tools/solutions/searchSolutions.js';
import { registerGetSolution } from '../tools/solutions/getSolution.js';
import { registerCreateSolution } from '../tools/solutions/createSolution.js';
import { registerUpdateSolution } from '../tools/solutions/updateSolution.js';

import { registerDescribeCustomFields } from '../tools/customFields/describeCustomFields.js';

import { registerGetRecordAudits } from '../tools/audits/getRecordAudits.js';

import { registerListCatalogItems } from '../tools/catalog/listCatalogItems.js';
import { registerGetCatalogItem } from '../tools/catalog/getCatalogItem.js';
import { registerCreateServiceRequest } from '../tools/catalog/createServiceRequest.js';
import {
  registerCreateContract,
  registerUpdateContract,
  registerDeleteContract,
  registerCreatePurchaseOrder,
  registerUpdatePurchaseOrder,
  registerDeletePurchaseOrder,
  registerCreateVendor,
  registerUpdateVendor,
  registerDeleteVendor,
  registerCreateCatalogItem,
  registerUpdateCatalogItem,
  registerDeleteCatalogItem,
  registerCreateChangeCatalog,
  registerUpdateChangeCatalog,
  registerDeleteChangeCatalog,
  registerListChangeCatalogs,
  registerGetChangeCatalog,
  registerCreateHardwareAsset,
  registerUpdateHardwareAsset,
  registerDeleteHardwareAsset,
  registerCreateMobileDevice,
  registerUpdateMobileDevice,
  registerDeleteMobileDevice,
  registerCreateOtherAsset,
  registerUpdateOtherAsset,
  registerDeleteOtherAsset,
  registerCreateConfigurationItem,
  registerUpdateConfigurationItem,
  registerDeleteConfigurationItem,
  registerUpdatePrinter,
  registerCreateChange,
  registerCreateRelease,
  registerGetChange,
  registerGetConfigurationItem,
  registerGetContract,
  registerGetHardwareAsset,
  registerGetMobileDevice,
  registerGetOtherAsset,
  registerGetPrinter,
  registerGetPurchaseOrder,
  registerGetRelease,
  registerGetSoftwareAsset,
  registerGetVendor,
  registerListChanges,
  registerListConfigurationItems,
  registerListContracts,
  registerListHardwareAssets,
  registerListMobileDevices,
  registerListOtherAssets,
  registerListPrinters,
  registerListPurchaseOrders,
  registerListReleases,
  registerListRisks,
  registerListSoftwareAssets,
  registerListVendors,
  registerUpdateChange,
  registerUpdateRelease,
} from '../tools/records/recordTools.js';
import {
  registerListTimeTracks,
  registerLogTime,
  registerUpdateTimeTrack,
} from '../tools/timeTracks/timeTrackTools.js';
import { registerUploadAttachment } from '../tools/attachments/uploadAttachment.js';
import { registerDeleteIncident } from '../tools/incidents/deleteIncident.js';
import { registerDeleteProblem } from '../tools/problems/deleteProblem.js';
import { registerDeleteChange } from '../tools/records/deleteChange.js';
import { registerDeleteRelease } from '../tools/records/deleteRelease.js';
import { registerDeleteSolution } from '../tools/solutions/deleteSolution.js';
import { registerChangeCalendar } from '../tools/records/changeCalendar.js';

export interface ToolContext {
  env: Env;
  profile: ProfileName;
  client: SwsdClient;
  enabledTools: string[];
  token: string;
}

type Registrar = (server: McpServer, ctx: ToolContext) => void;

const REGISTRARS: Record<string, Registrar> = {
  swsd_change_calendar: registerChangeCalendar,
  swsd_get_server_info: registerGetServerInfo,
  swsd_health_check: registerHealthCheck,
  swsd_get_me: registerGetMe,

  swsd_list_incidents: registerListIncidents,
  swsd_list_my_incidents: registerListMyIncidents,
  swsd_sla_risk: registerSlaRisk,
  swsd_ticket_stats: registerTicketStats,
  swsd_my_queue: registerMyQueue,
  swsd_get_incident: registerGetIncident,
  swsd_create_incident: registerCreateIncident,
  swsd_delete_incident: registerDeleteIncident,
  swsd_update_incident: registerUpdateIncident,
  swsd_assign_incident: registerAssignIncident,
  swsd_update_incident_state: registerUpdateIncidentState,
  swsd_link_solution_to_incident: registerLinkSolutionToIncident,

  swsd_list_incident_comments: registerListIncidentComments,
  swsd_add_incident_comment: registerAddIncidentComment,
  swsd_update_comment: registerUpdateComment,
  swsd_list_record_comments: registerListRecordComments,
  swsd_add_record_comment: registerAddRecordComment,

  swsd_list_incident_tasks: registerListIncidentTasks,
  swsd_create_incident_task: registerCreateIncidentTask,
  swsd_update_task_state: registerUpdateTaskState,
  swsd_list_record_tasks: registerListRecordTasks,
  swsd_create_record_task: registerCreateRecordTask,

  swsd_list_problems: registerListProblems,
  swsd_get_problem: registerGetProblem,
  swsd_create_problem: registerCreateProblem,
  swsd_delete_problem: registerDeleteProblem,
  swsd_update_problem: registerUpdateProblem,

  swsd_list_categories: registerListCategories,
  swsd_list_sites: registerListSites,
  swsd_list_departments: registerListDepartments,
  swsd_list_users: registerListUsers,
  swsd_list_groups: registerListGroups,
  swsd_list_roles: registerListRoles,
  swsd_create_user: registerCreateUser,
  swsd_update_user: registerUpdateUser,
  swsd_delete_user: registerDeleteUser,
  swsd_create_group: registerCreateGroup,
  swsd_update_group: registerUpdateGroup,
  swsd_delete_group: registerDeleteGroup,
  swsd_create_site: registerCreateSite,
  swsd_update_site: registerUpdateSite,
  swsd_delete_site: registerDeleteSite,
  swsd_create_department: registerCreateDepartment,
  swsd_update_department: registerUpdateDepartment,
  swsd_delete_department: registerDeleteDepartment,
  swsd_create_category: registerCreateCategory,
  swsd_update_category: registerUpdateCategory,
  swsd_delete_category: registerDeleteCategory,
  swsd_create_role: registerCreateRole,
  swsd_update_role: registerUpdateRole,
  swsd_delete_role: registerDeleteRole,
  swsd_add_group_member: registerAddGroupMember,
  swsd_remove_group_member: registerRemoveGroupMember,
  swsd_get_role: registerGetRole,
  swsd_get_user: registerGetUser,
  swsd_get_group: registerGetGroup,
  swsd_get_site: registerGetSite,
  swsd_get_department: registerGetDepartment,
  swsd_get_category: registerGetCategory,

  swsd_search_solutions: registerSearchSolutions,
  swsd_get_solution: registerGetSolution,
  swsd_create_solution: registerCreateSolution,
  swsd_delete_solution: registerDeleteSolution,
  swsd_update_solution: registerUpdateSolution,

  swsd_describe_custom_fields: registerDescribeCustomFields,

  swsd_get_record_audits: registerGetRecordAudits,

  swsd_list_catalog_items: registerListCatalogItems,
  swsd_get_catalog_item: registerGetCatalogItem,
  swsd_create_service_request: registerCreateServiceRequest,

  swsd_list_changes: registerListChanges,
  swsd_get_change: registerGetChange,
  swsd_create_change: registerCreateChange,
  swsd_delete_change: registerDeleteChange,
  swsd_update_change: registerUpdateChange,
  swsd_list_releases: registerListReleases,
  swsd_get_release: registerGetRelease,
  swsd_create_release: registerCreateRelease,
  swsd_delete_release: registerDeleteRelease,
  swsd_update_release: registerUpdateRelease,

  swsd_create_contract: registerCreateContract,
  swsd_update_contract: registerUpdateContract,
  swsd_delete_contract: registerDeleteContract,
  swsd_create_purchase_order: registerCreatePurchaseOrder,
  swsd_update_purchase_order: registerUpdatePurchaseOrder,
  swsd_delete_purchase_order: registerDeletePurchaseOrder,
  swsd_create_vendor: registerCreateVendor,
  swsd_update_vendor: registerUpdateVendor,
  swsd_delete_vendor: registerDeleteVendor,
  swsd_create_catalog_item: registerCreateCatalogItem,
  swsd_update_catalog_item: registerUpdateCatalogItem,
  swsd_delete_catalog_item: registerDeleteCatalogItem,
  swsd_create_change_catalog: registerCreateChangeCatalog,
  swsd_update_change_catalog: registerUpdateChangeCatalog,
  swsd_delete_change_catalog: registerDeleteChangeCatalog,
  swsd_list_change_catalogs: registerListChangeCatalogs,
  swsd_get_change_catalog: registerGetChangeCatalog,

  swsd_create_hardware_asset: registerCreateHardwareAsset,
  swsd_update_hardware_asset: registerUpdateHardwareAsset,
  swsd_delete_hardware_asset: registerDeleteHardwareAsset,
  swsd_create_mobile_device: registerCreateMobileDevice,
  swsd_update_mobile_device: registerUpdateMobileDevice,
  swsd_delete_mobile_device: registerDeleteMobileDevice,
  swsd_create_other_asset: registerCreateOtherAsset,
  swsd_update_other_asset: registerUpdateOtherAsset,
  swsd_delete_other_asset: registerDeleteOtherAsset,
  swsd_create_configuration_item: registerCreateConfigurationItem,
  swsd_update_configuration_item: registerUpdateConfigurationItem,
  swsd_delete_configuration_item: registerDeleteConfigurationItem,
  swsd_update_printer: registerUpdatePrinter,

  swsd_list_hardware_assets: registerListHardwareAssets,
  swsd_get_hardware_asset: registerGetHardwareAsset,
  swsd_list_mobile_devices: registerListMobileDevices,
  swsd_get_mobile_device: registerGetMobileDevice,
  swsd_list_printers: registerListPrinters,
  swsd_get_printer: registerGetPrinter,
  swsd_list_software_assets: registerListSoftwareAssets,
  swsd_get_software_asset: registerGetSoftwareAsset,
  swsd_list_other_assets: registerListOtherAssets,
  swsd_get_other_asset: registerGetOtherAsset,
  swsd_list_configuration_items: registerListConfigurationItems,
  swsd_get_configuration_item: registerGetConfigurationItem,
  swsd_list_contracts: registerListContracts,
  swsd_get_contract: registerGetContract,
  swsd_list_purchase_orders: registerListPurchaseOrders,
  swsd_get_purchase_order: registerGetPurchaseOrder,
  swsd_list_vendors: registerListVendors,
  swsd_get_vendor: registerGetVendor,
  swsd_list_risks: registerListRisks,

  swsd_list_time_tracks: registerListTimeTracks,
  swsd_log_time: registerLogTime,
  swsd_update_time_track: registerUpdateTimeTrack,
  swsd_upload_attachment: registerUploadAttachment,
};

export function registerTools(server: McpServer, ctx: ToolContext): void {
  for (const t of ctx.env.SWSD_ENABLE_EXTRAS) {
    if (!(t in REGISTRARS)) {
      const known = Object.keys(REGISTRARS).sort().join(', ');
      throw new Error(
        `Unknown tool in SWSD_ENABLE_EXTRAS: "${t}". Known tools: ${known}`,
      );
    }
  }

  const profileTools = PROFILE_TOOLS[ctx.profile];
  const all = new Set<string>([...profileTools, ...ctx.env.SWSD_ENABLE_EXTRAS]);

  for (const tool of all) {
    const register = REGISTRARS[tool];
    if (!register) continue;
    register(server, ctx);
    ctx.enabledTools.push(tool);
  }
  registerPrompts(server, ctx.enabledTools);
}
