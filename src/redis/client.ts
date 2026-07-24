import Redis from 'ioredis';
import { config } from '../config/env';

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
    // Do not auto-reconnect forever — let the process surface failures clearly.
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on('connect', () => {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'redis.connect',
        host: config.redis.host,
        port: config.redis.port,
        ts: new Date().toISOString(),
      }),
    );
  });

  client.on('ready', () => {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'redis.ready',
        ts: new Date().toISOString(),
      }),
    );
  });

  client.on('error', (err: Error) => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'redis.error',
        message: err.message,
        ts: new Date().toISOString(),
      }),
    );
  });



  return client;
}

/**
 * Gracefully closes the Redis connection.
 * Safe to call multiple times.
 */
export async function closeRedisClient(): Promise<void> {
  if (!client) return;
  await client.quit();
  client = null;
}
