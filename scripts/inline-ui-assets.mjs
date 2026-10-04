// MCP widgets need self-contained HTML, with no glob matching.
/** @returns {import('vite').Plugin} */
export function inlineUiAssets() {
  return {
    name: 'swsd-inline-ui-assets',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const inlined = new Set();
      const resolveAsset = (reference) => {
        const name = reference.split('/').at(-1);
        const asset = bundle[name];
        if (!asset) throw new Error(`UI asset is missing from the bundle: ${reference}`);
        return asset;
      };
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.html')) continue;
        let html = String(asset.source);
        html = html.replace(/<script\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>\s*<\/script>/g, (_tag, before, _quote, reference, after) => {
          const script = resolveAsset(reference);
          if (script.type !== 'chunk') throw new Error(`Expected a JavaScript chunk: ${reference}`);
          inlined.add(script.fileName);
          // A literal closing tag in JavaScript must not terminate the HTML script.
          const code = script.code.replace(/<(\/script\b|!--)/gi, '\\x3C$1');
          return `<script${before}${after}>${code}</script>`;
        });
        html = html.replace(/<link\b([^>]*?)\bhref=(["'])([^"']+)\2([^>]*)>/g, (tag, before, _quote, reference, after) => {
          if (!/\brel=(["'])stylesheet\1/.test(before + after)) return tag;
          const style = resolveAsset(reference);
          if (style.type !== 'asset' || !style.fileName.endsWith('.css')) throw new Error(`Expected a stylesheet: ${reference}`);
          inlined.add(style.fileName);
          const css = String(style.source).replace(/<(\/style)/gi, '\\3C $1');
          return `<style>${css}</style>`;
        });
        asset.source = html;
      }
      for (const name of inlined) delete bundle[name];
      for (const asset of Object.values(bundle)) {
        if (asset.type === 'chunk' || asset.fileName.endsWith('.css')) {
          throw new Error(`UI build left an external asset: ${asset.fileName}`);
        }
      }
    },
  };
}
