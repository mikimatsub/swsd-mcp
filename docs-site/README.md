# docs-site

[Astro Starlight](https://starlight.astro.build) documentation site for swsd-mcp. Deployed to Cloudflare Pages on every push to `main`.

Live at: **[mcp-swsd.pages.dev](https://mcp-swsd.pages.dev)** _(once Cloudflare Pages is connected: see setup below)_

## Local development

```bash
cd docs-site
npm install
npm run dev          # → http://localhost:4321
```

Hot-reload is enabled. Edit any `.md` / `.mdx` file under `src/content/docs/` and the browser refreshes automatically.

## Build

```bash
npm run build        # → docs-site/dist/
npm run preview      # serves the built site locally
```

Output is fully static HTML + a Pagefind search index. No server runtime.

## Cloudflare Pages setup (one-time, by maintainer)

The docs site auto-deploys via Cloudflare's GitHub integration. To wire it up the first time:

1. **Cloudflare dashboard → Workers & Pages → Create**
2. **Pick the "Pages" tab** at the top of the create flow (not "Workers": see [troubleshooting](#wrong-flow-workers-builds-instead-of-pages) if you only see Workers Builds)
3. **Connect to Git**, authorize Cloudflare to read this repository, select `mikimatsub/swsd-mcp`
4. Configure the build using **Root directory = `docs-site`** (this scopes everything below to the sub-package):

   | Setting | Value |
   |---|---|
   | **Production branch** | `main` |
   | **Framework preset** | `Astro` |
   | **Root directory** | `docs-site` |
   | **Build command** | `npm run build` _(Cloudflare auto-runs `npm install` first)_ |
   | **Build output directory** | `dist` _(relative to root directory; not `docs-site/dist`)_ |
   | **Environment variable: `NODE_VERSION`** | `24` |

5. Click **Save and Deploy**

After the first successful build, every push to `main` auto-deploys, and every PR gets a preview URL automatically (commented on the PR by Cloudflare's bot).

### Troubleshooting

#### Build "succeeds" but production URL returns 404 with empty body

Symptom: deployment shows green Success badge, but `https://mcp-swsd.pages.dev/` returns HTTP 404 with `Content-Length: 0`. Even the deployment-specific URL (`<sha>.mcp-swsd.pages.dev`) returns 404.

Cause: **Root directory is `/` (repo root) instead of `docs-site`.** With Root directory at the repo root, `npm install && npm run build` runs the *root* package's scripts, and the root has its own `build` script (`tsc`) that compiles the MCP server TypeScript. Cloudflare uploads the resulting `dist/` of compiled `.js` files (no `index.html`), reports success, and serves 404s.

The build "succeeded" because the build command exited 0; Cloudflare can't tell the wrong project was built. This is the most likely failure mode if Root directory wasn't set during initial wizard.

Fix: **Cloudflare dashboard → Settings → Builds & deployments → Build configurations → Edit**:

| Setting | Wrong | Right |
|---|---|---|
| Root directory | `/` | `docs-site` |
| Build output directory | `/dist` or `docs-site/dist` | `dist` _(relative to Root directory)_ |

Save, then **Deployments tab → Retry latest deployment**.

A `prebuild` guard in [`docs-site/package.json`](./package.json) catches this misconfiguration earlier: if Cloudflare ever runs the build at the repo root, the prebuild script fails before npm even tries to `astro build` the wrong source tree.

#### `cd: can't cd to docs-site`

Symptom: build log shows `/bin/sh: 1: cd: can't cd to docs-site`. Cause: an earlier configuration tried to `cd docs-site` from inside the build command *after* Cloudflare had already CD'd into the root directory: a double-cd. Fix: ensure Build command is just `npm run build` (no `cd` prefix) when Root directory is set to `docs-site`.

#### Wrong flow (Workers Builds instead of Pages)

Cloudflare is gradually unifying Pages into Workers Builds. If your dashboard only offers a "Deploy command" / "Path" form (not a Build output directory), you're on Workers Builds, which expects a `wrangler.jsonc` config we don't ship. For a static-only site like this, find the dedicated Pages flow first; if your account doesn't have it anymore, file an issue and we'll add a `wrangler.jsonc`.

### Optional: custom domain later

Cloudflare Pages → your project → Custom domains → Set up a custom domain. Add a `CNAME` record pointing at the `*.pages.dev` URL via your DNS provider. SSL provisions in ~1 minute.

## Project structure

```
docs-site/
├── astro.config.mjs              # Astro + Starlight config (sidebar, social, edit-link)
├── package.json                  # Sub-package; isolated from the root MCP server package
├── tsconfig.json
├── public/                       # Static assets (favicons, etc.)
└── src/
    ├── content.config.ts         # Starlight content-collection definition
    └── content/docs/             # Markdown pages → URLs
        ├── index.mdx             # Homepage (splash template)
        ├── quickstart.md
        ├── configuration.md
        ├── tools.md
        ├── deployment.md
        ├── security.md
        └── contributing.md
```

## Why a separate package?

The docs site has its own dependency tree (Astro, Starlight, sharp, ~350 packages) that isn't relevant to the runtime MCP server. Keeping it isolated:

- Lets the main `npm install` stay fast for contributors who only want to work on the server
- Prevents Astro/Starlight version pins from constraining the MCP server's TypeScript / Node version
- Keeps the published npm package (`swsd-mcp`) free of docs-only dependencies
- Lets Cloudflare's build run independently from GitHub Actions CI (saves CI minutes)

The root `eslint.config.js` ignores `docs-site/` for the same isolation reason.

## Adding a new page

1. Create `src/content/docs/your-page.md` with a `title` and `description` in frontmatter
2. Add an entry to the `sidebar` array in [`astro.config.mjs`](./astro.config.mjs)
3. `npm run dev` to preview
4. Commit; Cloudflare auto-deploys

## D2 diagrams

Diagrams are written as fenced code blocks with the `d2` language tag inside any markdown page:

````md
```d2
direction: right
a -> b: hello
```
````

`astro-d2` compiles them to SVG at build time using **D2.js (WASM)**: see the `experimental.useD2js: true` flag in [`astro.config.mjs`](./astro.config.mjs). This avoids requiring the D2 native binary, which Cloudflare Pages can't `apt install`.

**Known local-dev quirk on Windows:** the `<img src>` for D2-generated SVGs comes out with backslash path separators (e.g., `/d2/docs\architecture-0.svg`) when built on Windows. This is purely cosmetic and only affects local Windows builds: Cloudflare Pages (Linux) generates correct forward-slash paths. If the local preview shows a broken image, that's why; it'll render correctly on the deployed site.

If `experimental.useD2js` ever destabilizes, the fallback is to commit pre-rendered SVGs and remove the `astro-d2` integration.
