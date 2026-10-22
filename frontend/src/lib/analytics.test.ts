// @vitest-environment node
/**
 * Analytics query-contract regression tests.
 *
 * ## The incident
 *
 * `AnalyticsPage` built one range object — `{ from, to, groupBy }` — and handed it
 * to every analytics endpoint. The sales route accepts `groupBy`; the inventory
 * route does not. Its `inventoryAnalyticsQuerySchema` is `.strict()`, so the extra
 * key was refused with:
 *
 *     400 Unrecognized key: "groupBy"
 *
 * The failure was quiet. Nothing threw, the console stayed clean, and the build
 * stayed green. Three KPIs silently fell back to their "unavailable" placeholder —
 * stock received, units issued and net movement — and the page raised a partial
 * data banner, even though the server could have answered every one of them.
 *
 * ## Why a test is the real defence
 *
 * The declared type is *not* what stopped this. `InventoryAnalyticsQuery` is
 * `Omit<AnalyticsQuery, 'groupBy'>`, but TypeScript's excess-property check only
 * fires on object literals. A caller passing a **variable** that happens to carry
 * `groupBy` type-checks cleanly — and `AnalyticsPage` passed exactly such a
 * variable. The guarantee that actually holds is the runtime whitelist inside
 * `analyticsApi.inventory()`.
 *
 * These tests therefore feed the client a variable carrying `groupBy`, reproducing
 * the precise shape that slipped through, and assert on the URL that reaches
 * `fetch` — the last point where a stray key is still observable.
 *
 * ## What is asserted
 *
 * The query string, never the client's source text. The contract is about what
 * goes on the wire; a source-text assertion would break on any refactor that
 * preserves behaviour.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { analyticsApi, type AnalyticsQuery, type GroupBy } from './analytics';

const WINDOW = { from: '2026-09-22', toExclusive: '2026-10-23', days: 30 };

/** A realistic `GET /api/analytics/inventory` envelope. */
const INVENTORY_PAYLOAD = {
  data: {
    currentStock: {
      totalStockUnits: 120,
      productsWithStock: 6,
      outOfStockProducts: 1,
      productsWithNoMovements: 0,
    },
    movements: {
      inQuantity: 40,
      outQuantity: 25,
      adjustmentQuantity: -2,
      netMovement: '13.00',
      movementCount: 12,
    },
    analysisWindow: WINDOW,
  },
};

/** A realistic `GET /api/analytics/sales` envelope. */
const SALES_PAYLOAD = {
  data: {
    series: [
      { period: '2026-09-29', salesCount: 3, unitsSold: 7, revenue: '184.50' },
      { period: '2026-10-06', salesCount: 5, unitsSold: 11, revenue: '290.00' },
    ],
    summary: {
      salesCount: 8,
      unitsSold: 18,
      revenue: '474.50',
      averageSaleValue: '59.31',
    },
    analysisWindow: WINDOW,
    groupBy: 'week',
  },
};

/** The call signature of the stubbed global, so `mock.calls` is typed like a fetch. */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Stub `fetch` and hand the mock back, so a test can read the URL that was
 * actually requested. The payload is only there to keep `request()` on its
 * success path; these assertions never read it.
 */
function stubFetch(body: unknown) {
  // The call signature is declared so `mock.calls` is typed as a real fetch call
  // and the requested URL can be read back below. The stub ignores both
  // arguments; only the shape matters here.
  const fetchMock = vi.fn<FetchLike>(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The URL passed to `fetch` on the single call the client made. */
function requestedUrl(fetchMock: ReturnType<typeof stubFetch>): string {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return String(fetchMock.mock.calls[0]![0]);
}

/**
 * Path and parsed query of the request, read independently of any configured API
 * base URL so the assertions describe the path this client chose.
 */
function requestOf(fetchMock: ReturnType<typeof stubFetch>) {
  const url = new URL(requestedUrl(fetchMock), 'http://localhost');
  return { pathname: url.pathname, params: url.searchParams };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('analyticsApi.inventory — strict query whitelist', () => {
  it('drops groupBy when a caller supplies it through a variable, keeping from and to', async () => {
    // Reproduces the original bug exactly. Typed as `AnalyticsQuery` and passed as
    // a variable, this compiles even though inventory accepts only from/to — which
    // is precisely why the type alone could not have prevented the 400.
    const range: AnalyticsQuery = { from: '2026-09-22', to: '2026-10-22', groupBy: 'day' };

    const fetchMock = stubFetch(INVENTORY_PAYLOAD);
    await analyticsApi.inventory(range);

    const { pathname, params } = requestOf(fetchMock);
    expect(pathname).toBe('/api/analytics/inventory');
    expect(params.get('from')).toBe('2026-09-22');
    expect(params.get('to')).toBe('2026-10-22');
    expect(params.has('groupBy')).toBe(false);
    // The whole whitelist, so a future key cannot slip in unnoticed.
    expect([...params.keys()]).toEqual(['from', 'to']);
  });

  it.each<GroupBy>(['day', 'week', 'month'])(
    'never emits groupBy=%s, for any grouping the caller asks for',
    async (groupBy) => {
      const fetchMock = stubFetch(INVENTORY_PAYLOAD);
      const query: AnalyticsQuery = { from: '2026-09-22', to: '2026-10-22', groupBy };

      await analyticsApi.inventory(query);

      expect(requestOf(fetchMock).params.has('groupBy')).toBe(false);
    },
  );

  it('ignores an unknown extra key alongside a valid range', async () => {
    const fetchMock = stubFetch(INVENTORY_PAYLOAD);
    const query = {
      from: '2026-09-22',
      to: '2026-10-22',
      // A key the strict schema would also refuse if it ever reached the wire.
      limit: 10,
    } as AnalyticsQuery & { limit: number };

    await analyticsApi.inventory(query);

    expect([...requestOf(fetchMock).params.keys()]).toEqual(['from', 'to']);
  });

  it('resolves the inventory payload rather than the envelope', async () => {
    // Guards the unwrap contract: a caller reads `result.movements`, not
    // `result.data.movements`.
    const fetchMock = stubFetch(INVENTORY_PAYLOAD);

    const result = await analyticsApi.inventory({ from: '2026-09-22', to: '2026-10-22' });

    expect(result).not.toHaveProperty('data');
    expect(result.movements.netMovement).toBe('13.00');
    expect(requestOf(fetchMock).pathname).toBe('/api/analytics/inventory');
  });
});

describe('analyticsApi.inventory — optional date parameters', () => {
  it('omits the query string entirely when nothing is supplied', async () => {
    const fetchMock = stubFetch(INVENTORY_PAYLOAD);

    await analyticsApi.inventory();

    const { pathname, params } = requestOf(fetchMock);
    expect(pathname).toBe('/api/analytics/inventory');
    expect([...params.keys()]).toEqual([]);
    expect(requestedUrl(fetchMock)).not.toContain('?');
  });

  it('sends only from when to is omitted', async () => {
    const fetchMock = stubFetch(INVENTORY_PAYLOAD);

    await analyticsApi.inventory({ from: '2026-09-22' });

    const { params } = requestOf(fetchMock);
    expect(params.get('from')).toBe('2026-09-22');
    expect([...params.keys()]).toEqual(['from']);
  });

  it('sends only to when from is omitted', async () => {
    const fetchMock = stubFetch(INVENTORY_PAYLOAD);

    await analyticsApi.inventory({ to: '2026-10-22' });

    const { params } = requestOf(fetchMock);
    expect(params.get('to')).toBe('2026-10-22');
    expect([...params.keys()]).toEqual(['to']);
  });

  it('skips a key whose value is an empty string', async () => {
    const fetchMock = stubFetch(INVENTORY_PAYLOAD);

    await analyticsApi.inventory({ from: '2026-09-22', to: '' });

    expect([...requestOf(fetchMock).params.keys()]).toEqual(['from']);
  });
});

describe('analyticsApi.sales — groupBy stays supported', () => {
  it('forwards from, to and groupBy together', async () => {
    const fetchMock = stubFetch(SALES_PAYLOAD);

    await analyticsApi.sales({ from: '2026-09-22', to: '2026-10-22', groupBy: 'week' });

    const { pathname, params } = requestOf(fetchMock);
    expect(pathname).toBe('/api/analytics/sales');
    expect(params.get('from')).toBe('2026-09-22');
    expect(params.get('to')).toBe('2026-10-22');
    expect(params.get('groupBy')).toBe('week');
  });

  it.each<GroupBy>(['day', 'week', 'month'])('forwards groupBy=%s', async (groupBy) => {
    const fetchMock = stubFetch(SALES_PAYLOAD);

    await analyticsApi.sales({ from: '2026-09-22', to: '2026-10-22', groupBy });

    expect(requestOf(fetchMock).params.get('groupBy')).toBe(groupBy);
  });

  it('omits groupBy when the caller does not choose one', async () => {
    const fetchMock = stubFetch(SALES_PAYLOAD);

    await analyticsApi.sales({ from: '2026-09-22', to: '2026-10-22' });

    const { params } = requestOf(fetchMock);
    expect(params.has('groupBy')).toBe(false);
    expect([...params.keys()]).toEqual(['from', 'to']);
  });

  it('keeps accepting the full AnalyticsQuery object that AnalyticsPage builds', async () => {
    // The shared `range` object is the thing the page passes to both endpoints.
    const range: AnalyticsQuery = { from: '2026-09-22', to: '2026-10-22', groupBy: 'day' };

    const salesFetch = stubFetch(SALES_PAYLOAD);
    await analyticsApi.sales(range);

    const inventoryFetch = stubFetch(INVENTORY_PAYLOAD);
    await analyticsApi.inventory(range);

    expect(requestOf(salesFetch).params.get('groupBy')).toBe('day');
    expect(requestOf(inventoryFetch).params.has('groupBy')).toBe(false);
    expect(requestOf(inventoryFetch).params.get('from')).toBe('2026-09-22');
  });
});