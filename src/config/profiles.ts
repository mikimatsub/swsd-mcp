import type { ProfileName } from './env.js';

const READ_BASE = [
  'swsd_get_server_info',
  'swsd_health_check',
  'swsd_get_me',
  'swsd_list_incidents',
  'swsd_list_my_incidents',
  'swsd_get_incident',
  'swsd_list_incident_comments',
  'swsd_list_categories',
  'swsd_list_users',
  'swsd_list_catalog_items',
  'swsd_get_catalog_item',
] as const;

const TIME_AND_ATTACHMENT_TOOLS = [
  'swsd_list_time_tracks',
  'swsd_log_time',
  'swsd_update_time_track',
  'swsd_upload_attachment',
] as const;

const OPERATIONS_RECORD_TOOLS = [
  'swsd_list_changes',
  'swsd_get_change',
  'swsd_create_change',
  'swsd_update_change',
  'swsd_list_releases',
  'swsd_get_release',
  'swsd_create_release',
  'swsd_update_release',
  'swsd_list_hardware_assets',
  'swsd_get_hardware_asset',
  'swsd_list_mobile_devices',
  'swsd_get_mobile_device',
  'swsd_list_printers',
  'swsd_get_printer',
  'swsd_list_software_assets',
  'swsd_get_software_asset',
  'swsd_list_other_assets',
  'swsd_get_other_asset',
  'swsd_list_configuration_items',
  'swsd_get_configuration_item',
  'swsd_list_contracts',
  'swsd_get_contract',
  'swsd_list_purchase_orders',
  'swsd_get_purchase_order',
  'swsd_list_vendors',
  'swsd_get_vendor',
  'swsd_list_risks',
] as const;

const AGENT_TOOLS = [
  ...READ_BASE,
  'swsd_add_incident_comment',
  'swsd_update_comment',
  'swsd_create_incident',
  'swsd_update_incident',
  'swsd_assign_incident',
  'swsd_update_incident_state',
  'swsd_link_solution_to_incident',
  // Service catalog WRITE — submit a catalog request as an SR-flagged incident
  'swsd_create_service_request',
  'swsd_list_sites',
  'swsd_list_departments',
  'swsd_list_groups',
  'swsd_list_roles',
  // Solution reads — agents often check the KB while triaging
  'swsd_search_solutions',
  'swsd_get_solution',
  // Custom-field schema introspection (validate before writing)
  'swsd_describe_custom_fields',
  // Audit log lookup — "who changed this ticket and when?"
  'swsd_get_record_audits',
  // Sub-task workflow — list/create/mark-complete inline-only sub-tasks
  'swsd_list_incident_tasks',
  'swsd_create_incident_task',
  'swsd_update_task_state',
  // Problem records — list/get/create lets agents promote recurring
  // incidents to a problem record for root-cause investigation.
  'swsd_list_problems',
  'swsd_get_problem',
  'swsd_create_problem',
  // Work-log and evidence workflow for active ticket handling.
  ...TIME_AND_ATTACHMENT_TOOLS,
] as const;

export const PROFILE_TOOLS = {
  triage: [
    ...READ_BASE,
    'swsd_add_incident_comment',
    // Sub-task visibility helps triagers see open work without escalating
    'swsd_list_incident_tasks',
    // Read-only problem visibility — surface root-cause records without
    // granting promote/create rights to first-line support.
    'swsd_list_problems',
  ],
  agent: AGENT_TOOLS,
  operations: [...AGENT_TOOLS, ...OPERATIONS_RECORD_TOOLS],
  knowledge: [
    'swsd_get_server_info',
    'swsd_health_check',
    'swsd_get_me',
    'swsd_list_incidents',
    'swsd_list_my_incidents',
    'swsd_get_incident',
    'swsd_list_categories',
    'swsd_list_users',
    'swsd_list_catalog_items',
    'swsd_get_catalog_item',
    // Full solution CRUD for KB authors
    'swsd_search_solutions',
    'swsd_get_solution',
    'swsd_create_solution',
    'swsd_update_solution',
    'swsd_describe_custom_fields',
  ],
  full: [
    'swsd_get_server_info',
    'swsd_health_check',
    'swsd_get_me',
    'swsd_list_incidents',
    'swsd_list_my_incidents',
    'swsd_get_incident',
    'swsd_list_incident_comments',
    'swsd_add_incident_comment',
    'swsd_update_comment',
    'swsd_create_incident',
    'swsd_update_incident',
    'swsd_assign_incident',
    'swsd_update_incident_state',
    'swsd_link_solution_to_incident',
    'swsd_list_categories',
    'swsd_list_sites',
    'swsd_list_departments',
    'swsd_list_users',
    'swsd_list_groups',
    'swsd_list_roles',
    'swsd_list_catalog_items',
    'swsd_get_catalog_item',
    'swsd_create_service_request',
    'swsd_search_solutions',
    'swsd_get_solution',
    'swsd_create_solution',
    'swsd_update_solution',
    'swsd_describe_custom_fields',
    'swsd_get_record_audits',
    'swsd_list_incident_tasks',
    'swsd_create_incident_task',
    'swsd_update_task_state',
    'swsd_list_problems',
    'swsd_get_problem',
    'swsd_create_problem',
    ...TIME_AND_ATTACHMENT_TOOLS,
    ...OPERATIONS_RECORD_TOOLS,
  ],
} as const satisfies Record<ProfileName, readonly string[]>;
