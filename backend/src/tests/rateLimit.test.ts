/**
 * Rate limiting for the business API.
 *
 * ## What these tests are for
 *
 * The production-readiness review found a gap the existing suite could not see:
 * the rate-limit test built a throwaway Express app with a fake `/probe` route,
 * so **deleting a limiter from a real router would have failed no test at all.**
 * Two things are therefore pinned here:
 *
 *   1. the behaviour of the limiter itself — 429, the error envelope, the
 *      headers, and above all the tenant-aware identity;
 *   2. the **wiring** — that every business router actually mounts the limiter,
 *      and that the auth router still mounts its own stricter ones.
 *
 * The behaviour tests drive the real `createBusinessRateLimiter` factory with a
 * low limit and no `skip`, because the production instances deliberately skip in
 * tests. Testing the real factory is what makes these assertions meaningful.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import express, { type Express, type Request, type RequestHandler } from 'express';
import cors from 'cors';

import { RATE_LIMIT_POLICY } from '../config/rateLimitPolicy.js';
import { actionsRouter } from '../routes/actions.routes.js';
import { analyticsRouter } from '../routes/analytics.routes.js';
import { authRouter } from '../routes/auth.routes.js';
import { categoryRouter } from '../routes/category.routes.js';
import { healthRouter } from '../routes/health.routes.js';
import { intelligenceRouter } from '../routes/intelligence.routes.js';
import { inventoryRouter } from '../routes/inventory.routes.js';
import { productRouter } from '../routes/product.routes.js';
import { purchaseOrderRouter } from '../routes/purchaseOrder.routes.js';
import { recommendationsRouter } from '../routes/recommendations.routes.js';
import { salesRouter } from '../routes/sales.routes.js';
import { supplierRouter } from '../routes/supplier.routes.js';
import {
  authRateLimiter,
  businessApiLimiter,
  businessKeyGenerator,
  createBusinessApiLimiter,
  loginRateLimiter,
  registerRateLimiter,
} from '../middlewares/rateLimit.js';
import { closeTestDatabase, prepareTestDatabase, resetTestDatabase } from './helpers/testDatabase.js';
import { startTestServer, type TestServer } from './helpers/testServer.js';

let server: TestServer;

/** Reads the window from the policy table so the tests cannot drift from it. */
const WINDOW_MS = RATE_LIMIT_POLICY.businessRead.windowMs;

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

/**
 * A stand-in for `requireAuth`.
 *
 * The real one resolves a session from the database; here the identity arrives in
 * a header, which is enough to exercise the key generator and the tenant split
 * without a database round trip on every request.
 */
function fakeAuth(req: Request, _res: express.Response, next: express.NextFunction): void {
  const userId = req.header('x-test-user');
  const businessId = req.header('x-test-business');
  if (!userId || !businessId) {
    res401(req);
    return;
  }
  (req as Request & { auth?: unknown }).auth = {
    id: userId,
    businessId,
    name: 'Test',
    email: 'test@example.com',
    role: 'owner',
    business: { id: businessId, name: 'Test Business' },
  };
  next();

  function res401(request: Request): void {
    request.res?.status(401).json({ status: 'error', error: 'Unauthenticated.', code: 'UNAUTHENTICATED' });
  }
}

/**
 * An app with `cors()`, a health route and a business router behind a limiter.
 *
 * The limiter is the production factory — only the limits are lowered so a test
 * reaches the ceiling in a handful of requests. Reads and writes are given the
 * same low number here so the read/write split can be observed directly.
 */
async function startLimitedApp(limit: number): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app: Express = express();

  // Same ordering as the real application: CORS answers preflight before any
  // router, so a limiter can never swallow an OPTIONS request.
  app.use(cors());
  app.use(express.json());
  app.use(healthRouter);

  const limited = express.Router();
  // Order matters and mirrors production: the limiter keys on `req.auth`, so
  // authentication must resolve first. Putting the limiter first would silently
  // collapse every caller into one shared IP bucket.
  limited.use(fakeAuth);
  limited.use(createBusinessApiLimiter({ readLimit: limit, writeLimit: limit, windowMs: WINDOW_MS }));
  limited.get('/probe', (_req, res) => {
    res.json({ ok: true });
  });
  limited.post('/probe', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/limited', limited);

  const httpServer = app.listen(0);
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));

  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
  };
}

async function call(
  baseUrl: string,
  path: string,
  init: { method?: string; user?: string; business?: string } = {},
): Promise<JsonResponse> {
  const headers: Record<string, string> = {};
  if (init.user) headers['x-test-user'] = init.user;
  if (init.business) headers['x-test-business'] = init.business;

  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
  });

  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    headers: response.headers,
  };
}

/**
 * Parse the `RateLimit` header.
 *
 * `standardHeaders: 'draft-7'` emits one combined header — `limit=…, remaining=…,
 * reset=…` — rather than separate `RateLimit-Limit`/`-Remaining`/`-Reset`
 * headers. Parsing it keeps these assertions honest about what a client actually
 * receives, instead of asserting a header shape that was never sent.
 */
function rateLimitHeader(headers: Headers): Record<string, number> {
  const raw = headers.get('ratelimit');
  assert.ok(raw, `expected a RateLimit header, got: ${[...headers.keys()].join(', ')}`);

  const parsed: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [key, value] = part.trim().split('=');
    parsed[key!] = Number(value);
  }
  return parsed;
}

before(async () => {
  await prepareTestDatabase();
  server = await startTestServer();
});

after(async () => {
  await server.close();
  await closeTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase();
});

describe('Rate limiting — the policy is documented and bounded', () => {
  it('states a limit and a window for every class', () => {
    for (const [name, rule] of Object.entries(RATE_LIMIT_POLICY)) {
      assert.ok(rule.limit > 0, `${name} must have a positive limit`);
      assert.ok(rule.windowMs > 0, `${name} must have a positive window`);
    }
  });

  it('keeps the auth class tighter than the business classes', () => {
    // Credentials must remain the most protected surface in the API.
    assert.ok(
      RATE_LIMIT_POLICY.login.limit < RATE_LIMIT_POLICY.businessRead.limit,
      'login must stay tighter than a business read',
    );
    assert.ok(
      RATE_LIMIT_POLICY.register.limit < RATE_LIMIT_POLICY.login.limit,
      'registration must stay tighter than login',
    );
  });

  it('allows more reads than writes', () => {
    // A page of intelligence is many reads; genuine writes are rarer.
    assert.ok(
      RATE_LIMIT_POLICY.businessRead.limit > RATE_LIMIT_POLICY.businessWrite.limit,
    );
  });
});

describe('Rate limiting — identity is tenant aware', () => {
  it('keys on the session user and business, never on the request', () => {
    const asUser = (userId: string, businessId: string) =>
      businessKeyGenerator({
        auth: { id: userId, businessId },
      } as unknown as Request);

    assert.equal(asUser('u1', 'b1'), 'u:u1:b:b1');
    // Two users in one business are distinct keys.
    assert.notEqual(asUser('u1', 'b1'), asUser('u2', 'b1'));
    // The same user id in a different business is a different key too.
    assert.notEqual(asUser('u1', 'b1'), asUser('u1', 'b2'));
  });

  it('falls back to the client IP when there is no session', () => {
    const withoutSession = businessKeyGenerator({ ip: '10.0.0.1' } as unknown as Request);
    assert.match(withoutSession, /^ip:/);
  });

  it('ignores a businessId supplied in the query string', () => {
    // Requirement: a client must not be able to claim, or dodge, a quota by
    // putting a tenant id in the URL. The key is built from the session alone.
    const key = businessKeyGenerator({
      auth: { id: 'u1', businessId: 'b1' },
      query: { businessId: 'someone-elses-business' },
      ip: '10.0.0.1',
    } as unknown as Request);

    assert.equal(key, 'u:u1:b:b1');
    assert.ok(!key.includes('someone-elses-business'));
  });

  it('ignores a businessId supplied in the request body', () => {
    const key = businessKeyGenerator({
      auth: { id: 'u1', businessId: 'b1' },
      body: { businessId: 'someone-elses-business' },
      ip: '10.0.0.1',
    } as unknown as Request);

    assert.equal(key, 'u:u1:b:b1');
    assert.ok(!key.includes('someone-elses-business'));
  });
});

describe('Rate limiting — a normal request under the limit succeeds', () => {
  it('answers 200 while the caller is inside the budget', async () => {
    const app = await startLimitedApp(5);
    try {
      for (let i = 0; i < 4; i += 1) {
        const response = await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
        assert.equal(response.status, 200, `request ${i + 1} should be allowed`);
      }
    } finally {
      await app.close();
    }
  });

  it('reports the remaining budget in the standard headers', async () => {
    const app = await startLimitedApp(5);
    try {
      const first = await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
      const header = rateLimitHeader(first.headers);
      assert.equal(header['limit'], 5);
      assert.equal(header['remaining'], 4, 'one request has been spent');

      const second = await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
      assert.equal(
        rateLimitHeader(second.headers)['remaining'],
        3,
        'the budget must decrease as requests are made',
      );
    } finally {
      await app.close();
    }
  });
});

describe('Rate limiting — exceeding the budget returns a safe 429', () => {
  it('returns 429 with the standard error envelope and no internal detail', async () => {
    const app = await startLimitedApp(3);
    try {
      for (let i = 0; i < 3; i += 1) {
        await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
      }

      const blocked = await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });

      assert.equal(blocked.status, 429);
      // The same shape every other error on this API uses.
      assert.equal(blocked.body['status'], 'error');
      assert.equal(blocked.body['code'], 'RATE_LIMITED');
      assert.equal(typeof blocked.body['error'], 'string');

      // Must not disclose the limit, the window or the key, which would let an
      // attacker tune around them.
      const serialised = JSON.stringify(blocked.body);
      assert.ok(!serialised.includes(String(3)), 'the numeric limit must not be disclosed');
      assert.ok(!serialised.includes('u1'), 'the key must not be disclosed');
      assert.ok(!serialised.includes('b1'), 'the tenant must not be disclosed');
    } finally {
      await app.close();
    }
  });

  it('includes reset information a client can act on', async () => {
    const app = await startLimitedApp(1);
    try {
      await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
      const blocked = await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });

      assert.equal(blocked.status, 429);

      // The combined `RateLimit` header carries the seconds until the window
      // resets, which is what a client needs in order to back off correctly.
      const reset = rateLimitHeader(blocked.headers)['reset'];
      assert.ok(Number.isFinite(reset), 'a reset value is expected');
      const seconds = reset ?? 0;
      assert.ok(seconds > 0, 'the reset must be a positive number of seconds');
      assert.ok(seconds <= Math.ceil(WINDOW_MS / 1000), 'the reset must fall inside the window');

      // A throttled response still reports the budget, so a client can show it.
      assert.equal(rateLimitHeader(blocked.headers)['remaining'], 0);
    } finally {
      await app.close();
    }
  });

  it('keeps blocking for the rest of the window', async () => {
    const app = await startLimitedApp(1);
    try {
      await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
      for (let i = 0; i < 3; i += 1) {
        const blocked = await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
        assert.equal(blocked.status, 429, `request ${i + 2} should stay blocked`);
      }
    } finally {
      await app.close();
    }
  });
});

describe('Rate limiting — reads and writes draw on separate budgets', () => {
  it('exhausting the read budget does not block writes', async () => {
    // A page of intelligence must not spend the allowance for recording a sale.
    const app = await startLimitedApp(2);
    try {
      for (let i = 0; i < 3; i += 1) {
        await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
      }
      const readBlocked = await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
      assert.equal(readBlocked.status, 429, 'reads are exhausted');

      const write = await call(app.baseUrl, '/api/limited/probe', {
        method: 'POST',
        user: 'u1',
        business: 'b1',
      });
      assert.equal(write.status, 200, 'the write budget is untouched');
    } finally {
      await app.close();
    }
  });

  it('exhausting the write budget does not block reads', async () => {
    const app = await startLimitedApp(2);
    try {
      for (let i = 0; i < 3; i += 1) {
        await call(app.baseUrl, '/api/limited/probe', {
          method: 'POST',
          user: 'u1',
          business: 'b1',
        });
      }
      const writeBlocked = await call(app.baseUrl, '/api/limited/probe', {
        method: 'POST',
        user: 'u1',
        business: 'b1',
      });
      assert.equal(writeBlocked.status, 429, 'writes are exhausted');

      const read = await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
      assert.equal(read.status, 200, 'the read budget is untouched');
    } finally {
      await app.close();
    }
  });
});

describe('Rate limiting — tenants are isolated', () => {
  it('one tenant exhausting its budget does not throttle another', async () => {
    const app = await startLimitedApp(2);
    try {
      for (let i = 0; i < 3; i += 1) {
        await call(app.baseUrl, '/api/limited/probe', { user: 'ua', business: 'business-a' });
      }
      const blockedA = await call(app.baseUrl, '/api/limited/probe', {
        user: 'ua',
        business: 'business-a',
      });
      assert.equal(blockedA.status, 429, 'tenant A is throttled');

      // Tenant B must be completely unaffected.
      for (let i = 0; i < 2; i += 1) {
        const responseB = await call(app.baseUrl, '/api/limited/probe', {
          user: 'ub',
          business: 'business-b',
        });
        assert.equal(responseB.status, 200, `tenant B request ${i + 1} must be allowed`);
      }
    } finally {
      await app.close();
    }
  });

  it('one user cannot throttle a colleague in the same business', async () => {
    // This is why the bucket is per-user rather than per-business: a runaway tab
    // must not lock out everyone else in the business.
    const app = await startLimitedApp(2);
    try {
      for (let i = 0; i < 3; i += 1) {
        await call(app.baseUrl, '/api/limited/probe', { user: 'noisy', business: 'business-a' });
      }
      assert.equal(
        (await call(app.baseUrl, '/api/limited/probe', { user: 'noisy', business: 'business-a' })).status,
        429,
      );

      const colleague = await call(app.baseUrl, '/api/limited/probe', {
        user: 'colleague',
        business: 'business-a',
      });
      assert.equal(colleague.status, 200, 'a colleague in the same business is unaffected');
    } finally {
      await app.close();
    }
  });
});

describe('Rate limiting — health and CORS preflight are never throttled', () => {
  it('answers a CORS preflight even after the budget is exhausted', async () => {
    const app = await startLimitedApp(1);
    try {
      await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' });
      assert.equal(
        (await call(app.baseUrl, '/api/limited/probe', { user: 'u1', business: 'b1' })).status,
        429,
      );

      // OPTIONS carries no credentials and no session; blocking it would break
      // every cross-origin call from the browser.
      const preflight = await fetch(`${app.baseUrl}/api/limited/probe`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
      });

      assert.ok(preflight.status < 400, `preflight returned ${preflight.status}`);
      assert.equal(preflight.status, 204);
      assert.ok(
        preflight.headers.get('access-control-allow-origin'),
        'the preflight must still carry CORS headers',
      );
    } finally {
      await app.close();
    }
  });

  it('leaves the health endpoint usable regardless of budget state', async () => {
    const app = await startLimitedApp(1);
    try {
      // Health is mounted outside the limited router, exactly as in app.ts, so a
      // load balancer never gets a 429 from a health probe.
      for (let i = 0; i < 5; i += 1) {
        const response = await fetch(`${app.baseUrl}/health`);
        assert.equal(response.status, 200, `health probe ${i + 1} must succeed`);
        const body = (await response.json()) as { status: string };
        assert.equal(body.status, 'ok');
      }
    } finally {
      await app.close();
    }
  });
});

describe('Rate limiting — the wiring is actually present', () => {
  /**
   * The review's specific complaint: a test that builds its own app passes
   * whether or not the real routers are protected. These assertions inspect the
   * real router stacks so removing a limiter fails loudly.
   */
  const mountedOn = (router: express.Router, handler: RequestHandler): boolean =>
    router.stack.some((layer) => (layer as { handle?: unknown }).handle === handler);

  /**
   * Find a mounted route and inspect its own handler stack.
   *
   * `loginRateLimiter` and `registerRateLimiter` are passed per-route rather than
   * with `router.use`, so they live one level down — checking only the router's
   * own stack would miss them entirely.
   */
  const routeCarries = (
    router: express.Router,
    method: string,
    path: string,
    handler: RequestHandler,
  ): boolean => {
    const layer = router.stack.find(
      (entry) =>
        (entry as unknown as { route?: { path: string; methods?: Record<string, boolean> } })
          .route?.path === path &&
        (entry as unknown as { route: { methods: Record<string, boolean> } }).route.methods[
          method
        ] === true,
    ) as unknown as { route: { stack: Array<{ handle?: unknown }> } } | undefined;

    return (
      layer !== undefined &&
      layer.route.stack.some((entry) => entry.handle === handler)
    );
  };

  it('every authenticated business router applies the limiter', () => {
    const routers: Array<[string, express.Router]> = [
      ['categories', categoryRouter],
      ['products', productRouter],
      ['inventory', inventoryRouter],
      ['sales', salesRouter],
      ['suppliers', supplierRouter],
      ['purchase-orders', purchaseOrderRouter],
      ['analytics', analyticsRouter],
      ['intelligence', intelligenceRouter],
      ['recommendations', recommendationsRouter],
      ['actions', actionsRouter],
    ];

    for (const [name, router] of routers) {
      assert.ok(
        mountedOn(router, businessApiLimiter),
        `${name} must apply the business rate limiter`,
      );
    }
  });

  it('the auth router keeps its own stricter limiters', () => {
    // The broad backstop sits on the router itself.
    assert.ok(mountedOn(authRouter, authRateLimiter), 'the auth backstop must remain');
    // The tight ones are attached to their routes, so they are checked there.
    assert.ok(
      routeCarries(authRouter, 'post', '/login', loginRateLimiter),
      'the login limiter must remain on POST /auth/login',
    );
    assert.ok(
      routeCarries(authRouter, 'post', '/register', registerRateLimiter),
      'the register limiter must remain on POST /auth/register',
    );
  });

  it('the health router is not rate limited at all', () => {
    // Deployment and load-balancer checks must never be throttled.
    assert.equal(
      healthRouter.stack.some(
        (layer) =>
          typeof (layer as { handle?: unknown }).handle === 'function' &&
          (layer as { name?: string }).name?.length === 0,
      ),
      false,
      'the health router should contain only its handler',
    );
  });
});

describe('Rate limiting — existing auth and session behaviour is intact', () => {
  it('registration, login and session reads still work normally', async () => {
    const register = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: 'Rate Limited Co',
        name: 'Owner',
        email: 'owner@ratelimited.test',
        password: 'CorrectHorse9!',
      }),
    });
    assert.equal(register.status, 201, await register.text());

    // The session cookie was issued and `me` resolves from it.
    const cookie = register.headers.get('set-cookie');
    assert.ok(cookie, 'a session cookie must be set');

    const me = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie!.split(';')[0]! },
    });
    assert.equal(me.status, 200, await me.text());

    const logout = await fetch(`${server.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie!.split(';')[0]! },
    });
    assert.equal(logout.status, 200);
  });

  it('a business endpoint still answers normally for a real session', async () => {
    const register = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: 'Normal Traffic Co',
        name: 'Owner',
        email: 'owner@normaltraffic.test',
        password: 'CorrectHorse9!',
      }),
    });
    const cookie = register.headers.get('set-cookie')!.split(';')[0]!;

    // Real requests through the real routers, well inside the budget.
    for (let i = 0; i < 5; i += 1) {
      const response = await fetch(`${server.baseUrl}/api/products`, {
        headers: { Cookie: cookie },
      });
      assert.equal(response.status, 200, `request ${i + 1} should be allowed`);
    }
  });
});
