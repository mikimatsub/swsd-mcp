// Single source of truth for which UI bundles to build.
// Add an entry here when adding a new MCP Apps UI; both vite.config.ts and
// scripts/build-ui.mjs import from this file.
export const UI_TOOLS = [
  'incident-detail',
  'solution-detail',
  'incident-list',
  'custom-fields',
  'comment-thread',
  'audit-timeline',
  'catalog-item-form',
  'sla-risk',
  'change-calendar',
];
