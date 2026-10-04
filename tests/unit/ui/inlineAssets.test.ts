import { describe, expect, it } from 'vitest';
import { inlineUiAssets } from '../../../scripts/inline-ui-assets.mjs';

function inline(bundle: Record<string, unknown>) {
  const plugin = inlineUiAssets();
  return plugin.generateBundle.call({}, {}, bundle);
}

describe('self-contained widget assets', () => {
  it('inlines scripts and styles, escapes HTML terminators, and removes consumed assets', () => {
    const html = { type: 'asset', fileName: 'index.html', source: '<script type="module" src="./app.js"></script><link rel="stylesheet" href="./app.css">' };
    const bundle = {
      'index.html': html,
      'app.js': { type: 'chunk', fileName: 'app.js', code: 'const text = "</ScRiPt><!--";' },
      'app.css': { type: 'asset', fileName: 'app.css', source: 'a::before { content: "</STYLE>"; }' },
    };
    inline(bundle);
    expect(html.source).toContain('<script type="module" >const text = "\\x3C/ScRiPt>\\x3C!--";</script>');
    expect(html.source).toContain('<style>a::before { content: "\\3C /STYLE>"; }</style>');
    expect(html.source).not.toMatch(/\b(?:src|href)=/);
    expect(Object.keys(bundle)).toEqual(['index.html']);
  });

  it('fails when an HTML reference cannot be resolved', () => {
    expect(() => inline({ 'index.html': { type: 'asset', fileName: 'index.html', source: '<script src="./missing.js"></script>' } })).toThrow('UI asset is missing');
  });

  it('rejects a stylesheet masquerading as a JavaScript chunk', () => {
    expect(() => inline({
      'index.html': { type: 'asset', fileName: 'index.html', source: '<script src="./app.css"></script>' },
      'app.css': { type: 'asset', fileName: 'app.css', source: 'body{}' },
    })).toThrow('Expected a JavaScript chunk');
  });

  it('fails if an external chunk remains after inlining', () => {
    expect(() => inline({
      'index.html': { type: 'asset', fileName: 'index.html', source: '<h1>Widget</h1>' },
      'shared.js': { type: 'chunk', fileName: 'shared.js', code: 'export const shared = 1;' },
    })).toThrow('UI build left an external asset: shared.js');
  });
});
