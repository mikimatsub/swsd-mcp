// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import astroD2 from 'astro-d2';

// https://astro.build/config
export default defineConfig({
  // Update if you ever switch to a custom domain (e.g., 'https://swsd-mcp.dev').
  // The `base` option below should remain '/' for any root-domain deploy
  // (Cloudflare Pages, custom domain). Only set base if you ever move to a
  // subpath deploy like GitHub Pages.
  site: 'https://mcp-swsd.pages.dev',

  integrations: [
    starlight({
      title: 'swsd-mcp',
      description:
        'MCP server for SolarWinds Service Desk (SWSD / Samanage). Lets AI assistants work with tickets, service catalog, KB articles, changes, releases, assets, CMDB, procurement, risk, time tracking, and attachments.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/mikimatsub/swsd-mcp' },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/swsd-mcp' },
      ],
      sidebar: [
        { label: 'Quick start', link: '/quickstart/' },
        { label: 'Compatibility', link: '/compatibility/' },
        { label: 'Architecture', link: '/architecture/' },
        { label: 'Configuration', link: '/configuration/' },
        { label: 'Tools reference', link: '/tools/' },
        { label: 'Widgets reference', link: '/widgets/' },
        { label: 'Deployment', link: '/deployment/' },
        { label: 'Security', link: '/security/' },
        { label: 'Contributing', link: '/contributing/' },
      ],
      editLink: {
        baseUrl: 'https://github.com/mikimatsub/swsd-mcp/edit/main/docs-site/',
      },
      lastUpdated: true,
    }),
    // D2 diagrams via WASM (no D2 binary required at build time — works on
    // Cloudflare Pages without apt access). The experimental flag is required
    // for the WASM path; if it ever destabilizes, the fallback is to commit
    // pre-rendered SVGs and remove this integration.
    astroD2({
      experimental: { useD2js: true },
    }),
  ],
});
