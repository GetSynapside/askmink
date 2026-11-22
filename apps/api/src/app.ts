import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Pool } from 'pg';
import { createDb, createPool, runMigrations } from '@askmink/db';
import type { AppConfig } from './config.js';
import { CryptoService } from './crypto/encryption.js';
import { AuthService } from './auth/index.js';
import { createStorageAdapter } from './storage/index.js';
import { JobRunner } from './jobs/index.js';
import { AgentOrchestrator } from './ai/orchestrator.js';
import { csrfMiddleware, securityHeadersMiddleware } from './security/middleware.js';
import { registerRoutes } from './routes/index.js';

export interface AskminkAppContext {
  app: Hono;
  pool: Pool;
  jobs: JobRunner;
  close: () => Promise<void>;
}

export async function createAskminkApp(config: AppConfig): Promise<AskminkAppContext> {
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const db = createDb(pool);

  const crypto = new CryptoService(config.encryptionKeyHex);
  const auth = new AuthService(db, config);
  const storage = createStorageAdapter(config.storageDriver, config.uploadDir);
  const jobs = new JobRunner(db, pool, crypto, storage, config);
  await jobs.start();

  const orchestrator = new AgentOrchestrator(db, pool, crypto, jobs, config);

  const app = new Hono();

  // Global security headers
  app.use('*', securityHeadersMiddleware());

  // Strict CORS for Admin SPA (dev Vite server or configured origin, never wildcard *)
  const allowedAdminOrigins = new Set(
    [config.appUrl, config.corsOrigin, 'http://127.0.0.1:5173', 'http://localhost:5173'].filter(Boolean)
  );
  app.use(
    '/api/*',
    cors({
      origin: (origin) => (origin && allowedAdminOrigins.has(origin) ? origin : ''),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'],
    })
  );

  // CSRF protection on all state-changing routes (excluding /api/widget/*)
  app.use('/api/*', csrfMiddleware());

  // Generic error handler — never expose SQL errors or stack traces to clients
  app.onError((err, c) => {
    console.error('[api:error]', err.message);
    return c.json({ error: 'Internal server error' }, 500);
  });

  registerRoutes(app, { db, pool, config, auth, crypto, storage, jobs, orchestrator });

  // Serve compiled widget bundle (/widget.js) with permissive GET CORS for third-party embeds
  const widgetDistCandidates = [
    path.resolve(process.cwd(), 'public/widget/widget.js'),
    path.resolve(process.cwd(), '../widget/dist/widget.js'),
    path.resolve(process.cwd(), 'apps/widget/dist/widget.js'),
  ];
  app.get('/widget.js', (c) => {
    const found = widgetDistCandidates.find((p) => fs.existsSync(p));
    if (!found) {
      return c.text('// widget.js not built yet. Run pnpm build.', 404);
    }
    const content = fs.readFileSync(found, 'utf8');
    c.header('Content-Type', 'application/javascript; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(content);
  });

  // Serve built Admin SPA in production
  const webDistDir = [
    path.resolve(process.cwd(), 'public/web'),
    path.resolve(process.cwd(), '../web/dist'),
  ].find((d) => fs.existsSync(path.join(d, 'index.html')));

  if (webDistDir) {
    app.get('*', (c) => {
      if (c.req.path.startsWith('/api/')) {
        return c.json({ error: 'Not found' }, 404);
      }
      const reqRel = c.req.path === '/' ? 'index.html' : c.req.path.replace(/^\/+/, '');
      const resolved = path.resolve(webDistDir, reqRel);
      const target =
        resolved.startsWith(webDistDir + path.sep) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
          ? resolved
          : path.join(webDistDir, 'index.html');

      const ext = path.extname(target);
      const mimeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.json': 'application/json',
      };
      c.header('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
      return c.body(fs.readFileSync(target));
    });
  }

  return {
    app,
    pool,
    jobs,
    close: async () => {
      await jobs.stop();
      await pool.end();
    },
  };
}
