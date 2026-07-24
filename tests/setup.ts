import { closeRedisClient } from '../src/redis/client';

/**
 * Global Jest setup for integration/unit tests.
 *
 * Any test suite that uses a rate limiter may initialize the shared
 * Redis singleton. The client must be closed before Jest tears down
 * the test environment; otherwise Redis connection events or open
 * sockets can remain active after the tests finish.
 */
afterAll(async () => {
  await closeRedisClient();
});