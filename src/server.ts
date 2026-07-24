import http from 'http';
import app from './app';
import { config } from './config/env';
import { getRedisClient, closeRedisClient } from './redis/client';

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

// Ensure Redis client is initialised at startup so connection errors surface early.
getRedisClient();

const server = http.createServer(app);

server.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'server.start',
      port: config.port,
      ts: new Date().toISOString(),
    }),
  );
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'server.shutdown',
      signal,
      ts: new Date().toISOString(),
    }),
  );

  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  await closeRedisClient();

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'server.shutdown.complete',
      ts: new Date().toISOString(),
    }),
  );

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'unhandledRejection',
      reason: String(reason),
      ts: new Date().toISOString(),
    }),
  );
  process.exit(1);
});
