// Exécute un script TypeScript du projet avec le Vite du projet (import.meta.env, alias).
// Usage : node scripts/run-ts.mjs scripts/verify-vat.ts [args]
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  await server.ssrLoadModule('/' + process.argv[2].split(String.fromCharCode(92)).join('/'));
} finally {
  // le script appelle process.exit lui-même
}
