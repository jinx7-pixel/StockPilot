import type { Server } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/index.js';

const app = createApp();

const server: Server = app.listen(env.port, env.host, () => {
  console.log(
    `[stockpilot-api] listening on http://${env.host}:${env.port} (env: ${env.nodeEnv})`,
  );
  console.log(`[stockpilot-api] health check: http://localhost:${env.port}/api/health`);
});

/** Drain in-flight requests, then release the PostgreSQL pool. */
function shutdown(signal: string): void {
  console.log(`[stockpilot-api] ${signal} received — shutting down gracefully`);

  server.close((error) => {
    if (error) {
      console.error('[stockpilot-api] error while closing HTTP server:', error);
      process.exitCode = 1;
    }

    void closePool().finally(() => {
      process.exit();
    });
  });

  // Force-exit if connections refuse to drain in time.
  setTimeout(() => {
    console.error('[stockpilot-api] forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[stockpilot-api] unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[stockpilot-api] uncaught exception:', error);
  process.exit(1);
});
