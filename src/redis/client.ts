import Redis from 'ioredis';
import { config } from '../config/env';
import { logger } from '../shared/logger';

let client: Redis | null = null;

/**
 * Returns the singleton ioredis client.
 * Creates it on the first call; subsequent calls return the same instance.
 */
export function getRedisClient(): Redis {
  if (client) {
    return client;
  }

  client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,

    // Do not retry individual commands forever.
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,

    // Connect as soon as the client is created.
    lazyConnect: false,
  });

  client.on('connect', () => {
    logger.info('redis.connect', {
      host: config.redis.host,
      port: config.redis.port,
    });
  });

  client.on('ready', () => {
    logger.info('redis.ready');
  });

  client.on('error', (err: Error) => {
    logger.error('redis.error', err.message);
  });

  return client;
}

/**
 * Gracefully closes the singleton Redis connection.
 *
 * Safe to call multiple times.
 * Handles both fully-connected and still-connecting clients.
 */
export async function closeRedisClient(): Promise<void> {
  if (!client) {
    return;
  }

  // Clear the singleton reference immediately so a failed shutdown
  // cannot leave a stale client available to future callers.
  const currentClient = client;
  client = null;

  try {
    if (currentClient.status === 'ready') {
      await currentClient.quit();
    } else {
      // If Redis is still connecting/reconnecting, terminate immediately.
      currentClient.disconnect();
    }
  } catch {
    // Ensure the socket/timers are cleaned up even if QUIT fails.
    currentClient.disconnect();
  }
}