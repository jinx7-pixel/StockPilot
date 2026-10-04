/**
 * Minimal HTTP client for exercising the real Express app.
 *
 * Apps are mounted on an ephemeral port so the full middleware stack runs —
 * helmet, CORS, cookie parsing, rate limiting and all — rather than being
 * bypassed by calling handlers directly.
 *
 * A tiny cookie jar stands in for a browser: it captures `Set-Cookie` and
 * replays it, which is how the session cookie is asserted end to end. The jar
 * is portable between clients, so a session obtained from the real app can be
 * replayed against a purpose-built test app.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';

export interface JsonResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  setCookie: string[];
}

/** Per-client cookie jar, so two clients in one test act as two browsers. */
export class TestClient {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async post<T = unknown>(path: string, body?: unknown): Promise<JsonResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<JsonResponse<T>> {
    return this.request<T>('PATCH', path, body);
  }

  async delete<T = unknown>(path: string): Promise<JsonResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  async get<T = unknown>(path: string): Promise<JsonResponse<T>> {
    return this.request<T>('GET', path);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<JsonResponse<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (body !== undefined) headers['Content-Type'] = 'application/json';

    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });

    this.captureCookies(response.headers);

    const text = await response.text();
    let parsed: unknown;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    return {
      status: response.status,
      body: parsed as T,
      headers: response.headers,
      setCookie: response.headers.getSetCookie(),
    };
  }

  private captureCookies(headers: Headers): void {
    for (const raw of headers.getSetCookie()) {
      const [pair] = raw.split(';');
      if (!pair) continue;

      const separator = pair.indexOf('=');
      if (separator < 0) continue;

      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();

      // An empty value is how `clearCookie` instructs the browser to drop it.
      if (value === '') {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  /** Current jar contents, for replaying a session into another client. */
  cookieMap(): Record<string, string> {
    return Object.fromEntries(this.cookies);
  }

  /** Load cookies obtained elsewhere, e.g. a session from the real app. */
  seedCookies(cookies: Record<string, string>): void {
    for (const [name, value] of Object.entries(cookies)) {
      this.cookies.set(name, value);
    }
  }

  cookieNames(): string[] {
    return [...this.cookies.keys()];
  }

  hasCookie(name: string): boolean {
    return this.cookies.has(name);
  }
}

export interface TestServer {
  baseUrl: string;
  /** A fresh client with an empty cookie jar. */
  client(): TestClient;
  /** A client seeded with an existing jar, i.e. an already-signed-in browser. */
  clientWith(cookies: Record<string, string>): TestClient;
  close(): Promise<void>;
}

/** Mount any Express app on an ephemeral port. */
export async function startServerWith(app: Express): Promise<TestServer> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    client: () => new TestClient(baseUrl),
    clientWith: (cookies) => {
      const client = new TestClient(baseUrl);
      client.seedCookies(cookies);
      return client;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** Start the real application, exactly as production wires it. */
export async function startTestServer(): Promise<TestServer> {
  // Imported lazily so this module can be loaded by the test bootstrap without
  // pulling in the whole application graph.
  const { createApp } = await import('../../app.js');
  return startServerWith(createApp());
}
