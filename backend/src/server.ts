import type { Server } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/index.js';
import { startSessionCleanup, type SessionCleanup } from './jobs/sessionCleanup.js';

const app = createApp();

/**
 * Set the moment shutdown begins, so a `listen` callback that has not yet run
 * cannot start a background timer we are about to abandon.
 */
let shuttingDown = false;
let sessionCleanup: SessionCleanup | null = null;

const server: Server = app.listen(env.port, env.host, () => {
  console.log(
    `[stockpilot-api] listening on http://${env.host}:${env.port} (env: ${env.nodeEnv})`,
  );
  console.log(`[stockpilot-api] health check: http://localhost:${env.port}/api/health`);

  // Only once the socket is actually accepting traffic.
  if (!shuttingDown) {
    sessionCleanup = startSessionCleanup();
  }
});

/** Drain in-flight requests, then release the PostgreSQL pool. */
function shutdown(signal: string): void {
  shuttingDown = true;
  console.log(`[stockpilot-api] ${signal} received — shutting down gracefully`);

  void (async () => {
    // Stop scheduling first, then wait for a sweep already in flight. Closing
    // the pool underneath it would turn a healthy request into a failure.
    if (sessionCleanup) {
      const job = sessionCleanup;
      sessionCleanup = null;
      await job.stop();
    }

    await new Promise<void>((resolve) => {
      server.close((error) => {
        if (error) {
          console.error('[stockpilot-api] error while closing HTTP server:', error);
          process.exitCode = 1;
        }
        resolve();
      });
    });

    // Reported rather than swallowed: a pool that will not close cleanly is
    // exactly the kind of thing a shutdown log exists to record. The process
    // still exits, so behaviour is unchanged apart from the message.
    await closePool().catch((error: unknown) => {
      console.error('[stockpilot-api] error while closing the database pool:', error);
    });
    process.exit();
  })();

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
