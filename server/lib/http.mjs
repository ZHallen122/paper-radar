// Shared HTTP helper: User-Agent, timeout, per-host spacing, retry on 429/503,
// and a small in-memory TTL cache that lives as long as the server process.

export const VERSION = "0.1.0";
const USER_AGENT = `paper-radar/${VERSION} (+https://github.com/ZHallen122/paper-radar)`;

// Minimum gap between requests to the same host. arXiv's API terms ask for
// no more than one request every three seconds.
const HOST_SPACING_MS = {
  "export.arxiv.org": 3000,
  "arxiv.org": 1000,
};

const CACHE_MAX_ENTRIES = 300;
const cache = new Map(); // url -> { expires, value }
const nextSlot = new Map(); // host -> earliest start time for the next request

export class HttpError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForSlot(host) {
  const spacing = HOST_SPACING_MS[host];
  if (!spacing) return;
  const now = Date.now();
  const start = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, start + spacing);
  if (start > now) await sleep(start - now);
}

function cacheGet(url) {
  const hit = cache.get(url);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(url);
    return undefined;
  }
  return hit.value;
}

function cacheSet(url, value, ttlMs) {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(url, { expires: Date.now() + ttlMs, value });
}

/**
 * GET a URL and return { status, headers, body } for 2xx responses.
 * Throws HttpError for other statuses after retries.
 * `ttlMs` > 0 caches successful responses; `logUrl` hides secrets in errors.
 */
export async function getText(url, { ttlMs = 0, timeoutMs = 30000, retries = 2, logUrl = url } = {}) {
  if (ttlMs > 0) {
    const cached = cacheGet(url);
    if (cached) return cached;
  }
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    await waitForSlot(host);
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new HttpError(`Request failed: ${err?.message ?? err}`, { url: logUrl });
    }
    const body = await res.text();
    if (res.ok) {
      const value = { status: res.status, headers: res.headers, body };
      if (ttlMs > 0) cacheSet(url, value, ttlMs);
      return value;
    }
    const retryable = res.status === 429 || res.status === 503 || res.status === 502;
    if (retryable && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      // Do not sit on a long Retry-After (for example an exhausted daily budget).
      if (Number.isFinite(retryAfter) && retryAfter > 20) {
        throw new HttpError(`HTTP ${res.status}`, { status: res.status, url: logUrl, body });
      }
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * (attempt + 1));
      continue;
    }
    throw new HttpError(`HTTP ${res.status}`, { status: res.status, url: logUrl, body });
  }
}

export async function getJson(url, options) {
  const res = await getText(url, options);
  return { ...res, json: JSON.parse(res.body) };
}
