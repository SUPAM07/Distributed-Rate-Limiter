import type Redis from 'ioredis';
import { getRedisClient } from '../../redis/client';

export abstract class BaseRateLimiter {
  protected readonly redis: Redis;
  private scriptSha: string | null = null;
  protected abstract readonly LUA_SCRIPT: string;

  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Executes a Lua script securely with fallback from EVALSHA to LOAD.
   *
   * @param numKeys - Number of keys to pass to the script
   * @param args - An array of arguments where the first `numKeys` are keys, and the rest are regular ARGV
   */
  protected async evalScript<T = unknown>(numKeys: number, args: (string | number)[]): Promise<T> {
    const load = async (): Promise<string> => {
      const sha = await this.redis.script('LOAD', this.LUA_SCRIPT) as string;
      this.scriptSha = sha;
      return sha;
    };

    if (!this.scriptSha) {
      await load();
    }

    const run = async (sha: string): Promise<T> => {
      // ioredis evalsha takes (sha, numKeys, ...args)
      return await this.redis.evalsha(sha, numKeys, ...args) as T;
    };

    try {
      return await run(this.scriptSha!);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('NOSCRIPT')) {
        const newSha = await load();
        return await run(newSha);
      }
      throw err;
    }
  }
}
