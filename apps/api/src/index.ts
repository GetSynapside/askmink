import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { createAskminkApp } from './app.js';

const config = loadConfig();
const { app, close } = await createAskminkApp(config);

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    console.log(`✓ Askmink API listening on http://${info.address}:${info.port} (mode=${config.appMode})`);
  }
);

const shutdown = async () => {
  server.close();
  await close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
