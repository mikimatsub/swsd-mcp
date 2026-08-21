# Widget screenshots

This directory contains a self-contained harness for rendering each of the seven
MCP Apps widgets with synthetic fictional data ("Acme Corp"), so the docs site
and the README can show what the widgets look like without exposing any real
SWSD tenant data.

## Layout

```
screenshots/
├── README.md          (this file)
├── host-mock.html     (single-page harness: mocks the MCP Apps host bridge)
└── fixtures/          (synthetic structuredContent per widget: fictional Acme Corp data)
    ├── incident-detail.json
    ├── solution-detail.json
    ├── incident-list.json
    ├── comment-thread.json
    ├── audit-timeline.json
    ├── catalog-item-form.json
    └── custom-fields.json

docs-site/public/widgets/
├── *.png              (the captured screenshots: committed; served by Astro at /widgets/*.png)
```

The fixtures use a fictional company called **Acme Corp**:
- Domain: `acme.example`
- Users: Jane Doe, Alex Kim, Sam Patel, Morgan Lee, Taylor Gomez, Jordan Weiss, Casey Rivera
- Department: IT Services at Acme HQ in Boston

No SWSD tenant or real customer data is used. The fixtures are committed and serve
double-duty as canonical examples of each widget's expected `structuredContent` shape.

## How it works

`host-mock.html` is a single-page MCP Apps host emulator:

1. Reads `?widget=<name>` and `?theme=<light|dark>` query params.
2. Loads the matching widget bundle (`../dist/ui/<name>.html`) in an iframe.
3. Listens for `postMessage` from the iframe, replies to `ui/initialize`
   with a `McpUiInitializeResult` (theme + styles), then sends
   `ui/notifications/tool-result` with the fixture's `structuredContent`.
4. Renders the widget at fixed dimensions for clean screenshots.

The harness intentionally feeds the production `dist/ui/*.html` bundles, not the
source: screenshots reflect what users actually see in Claude Desktop / VS Code
Copilot Chat / Goose / etc.

## Regenerating the screenshots

```bash
# 1. Build the widget bundles (puts them in dist/ui/)
npm run build

# 2. Serve this directory + dist/ over a local HTTP server
#    (file:// URLs sometimes block iframe postMessage)
python -m http.server 5500 --bind 127.0.0.1

# 3. In another terminal, drive the screenshots with the Playwright MCP
#    (or your tool of choice). For each widget:
#      http://127.0.0.1:5500/screenshots/host-mock.html?widget=incident-detail&theme=dark
#    capture the iframe's content area and save to docs-site/public/widgets/<name>-<theme>.png
```

The committed PNGs live at `docs-site/public/widgets/*.png` and are served by
the docs site at `/widgets/*.png`.

If you change a widget's structured-content schema, update the matching fixture
here too: the smoke tests don't enforce fixture validity, but the screenshots
will degrade silently.
