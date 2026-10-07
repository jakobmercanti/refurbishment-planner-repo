// SSR component tests do not run a CSS bundler. Preserve class names, not styles.
require.extensions['.css'] = module => { module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }); };
