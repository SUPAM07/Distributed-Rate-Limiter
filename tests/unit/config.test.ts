// ---------------------------------------------------------------------------
// Config validation tests
// We manipulate process.env directly and re-require env.ts via Jest module
// isolation so each test gets a clean parse without affecting other suites.
//
// IMPORTANT: dotenv/config runs inside env.ts on import. Each jest.resetModules()
// causes env.ts to re-run dotenv, which re-reads .env. To test specific values
// we always explicitly set the env var we want to assert against.
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

async function loadConfig() {
  const { config } = await import('../../src/config/env');
  return config;
}

describe('env config', () => {
  it('reads RATE_LIMIT_ALGORITHM from env', async () => {
    // Explicitly set — we cannot test the hard-coded default because dotenv
    // always re-loads .env on every module import within this process.
    process.env['RATE_LIMIT_ALGORITHM'] = 'fixed-window';
    const cfg = await loadConfig();
    expect(cfg.rateLimit.algorithm).toBe('fixed-window');
  });

  it('reads RATE_LIMIT_CAPACITY from env', async () => {
    process.env['RATE_LIMIT_CAPACITY'] = '25';
    const cfg = await loadConfig();
    expect(cfg.rateLimit.capacity).toBe(25);
  });

  it('parses PORT from env', async () => {
    process.env['PORT'] = '8080';
    const cfg = await loadConfig();
    expect(cfg.port).toBe(8080);
  });

  it('throws for invalid RATE_LIMIT_ALGORITHM', async () => {
    process.env['RATE_LIMIT_ALGORITHM'] = 'magic-algo';
    await expect(loadConfig()).rejects.toThrow('RATE_LIMIT_ALGORITHM');
  });

  it('throws for non-positive PORT', async () => {
    process.env['PORT'] = '0';
    await expect(loadConfig()).rejects.toThrow('PORT');
  });

  it('throws for non-integer PORT', async () => {
    process.env['PORT'] = 'abc';
    await expect(loadConfig()).rejects.toThrow('PORT');
  });

  it('accepts all valid algorithm names', async () => {
    const algorithms = [
      'token-bucket',
      'fixed-window',
      'sliding-window-log',
      'sliding-window-counter',
      'leaky-bucket',
      'gcra',
    ];
    for (const alg of algorithms) {
      jest.resetModules();
      process.env['RATE_LIMIT_ALGORITHM'] = alg;
      const cfg = await loadConfig();
      expect(cfg.rateLimit.algorithm).toBe(alg);
    }
  });

  it('parses GCRA config', async () => {
    process.env['GCRA_EMISSION_INTERVAL'] = '200';
    process.env['GCRA_BURST_CAPACITY'] = '5';
    const cfg = await loadConfig();
    expect(cfg.rateLimit.gcra.emissionIntervalMs).toBe(200);
    expect(cfg.rateLimit.gcra.burstCapacity).toBe(5);
  });

  it('parses leaky bucket config', async () => {
    process.env['LEAKY_BUCKET_CAPACITY'] = '20';
    process.env['LEAKY_BUCKET_LEAK_RATE'] = '3';
    const cfg = await loadConfig();
    expect(cfg.rateLimit.leakyBucket.capacity).toBe(20);
    expect(cfg.rateLimit.leakyBucket.leakRate).toBe(3);
  });

  it('parses REDIS_HOST and REDIS_PORT', async () => {
    process.env['REDIS_HOST'] = 'myredis';
    process.env['REDIS_PORT'] = '6380';
    const cfg = await loadConfig();
    expect(cfg.redis.host).toBe('myredis');
    expect(cfg.redis.port).toBe(6380);
  });
});
