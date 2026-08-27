/**
 * HTTP client for the Cin7 Omni API.
 *
 * - Basic auth from CIN7_API_USERNAME / CIN7_API_KEY
 * - Client-side rate limiting (3/sec, 60/min) via RateLimiter
 * - Automatic retry with exponential backoff on 429 and 5xx
 * - Actionable, normalized error messages
 */

import { RateLimiter } from "./rateLimiter.js";

const DEFAULT_BASE_URL = "https://api.cin7.com/api";
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 60_000;

export class Cin7ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "Cin7ApiError";
  }
}

export interface Cin7Config {
  username: string;
  apiKey: string;
  baseUrl: string;
}

export function loadConfig(): Cin7Config {
  const username = process.env.CIN7_API_USERNAME;
  const apiKey = process.env.CIN7_API_KEY;
  if (!username || !apiKey) {
    throw new Error(
      "Missing Cin7 credentials. Set the CIN7_API_USERNAME and CIN7_API_KEY " +
        "environment variables (created in Cin7 Omni under Settings/Setup → Integrations → API v1).",
    );
  }
  return {
    username,
    apiKey,
    baseUrl: (process.env.CIN7_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

const limiter = new RateLimiter();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMessage(status: number, body: string): string {
  const detail = body ? ` Cin7 response: ${body}` : "";
  switch (status) {
    case 400:
      return `Cin7 rejected the request as invalid (400).${detail}`;
    case 401:
      return (
        "Authentication failed (401). Check CIN7_API_USERNAME and CIN7_API_KEY — " +
        "these are the API connection username/key from Cin7 Omni (Settings → Integrations → API v1), " +
        "not your Cin7 login."
      );
    case 403:
      return (
        "Permission denied (403). The API connection does not have permission for this module — " +
        "enable it in Cin7 Omni under Settings → Integrations → API v1 → your connection → permissions." +
        detail
      );
    case 404:
      return `Not found (404). Check the id/endpoint is correct.${detail}`;
    case 429:
      return "Cin7 rate limit exceeded (429) and retries were exhausted. Wait a minute and try again (limits: 3/sec, 60/min, 5000/day).";
    case 503:
      return "Cin7 API temporarily unavailable (503). Try again shortly.";
    default:
      return `Cin7 API request failed with status ${status}.${detail}`;
  }
}

export async function cin7Request(
  config: Cin7Config,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  body?: unknown,
): Promise<unknown> {
  const url = new URL(`${config.baseUrl}/${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const auth = Buffer.from(`${config.username}:${config.apiKey}`).toString("base64");

  let lastError: Cin7ApiError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await limiter.acquire();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = new Cin7ApiError(
        `Network error calling Cin7 API (${method} ${url.pathname}): ${msg}`,
      );
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    const bodyText = (await response.text().catch(() => "")).slice(0, 2000);
    const retryable = response.status === 429 || response.status >= 500;
    lastError = new Cin7ApiError(errorMessage(response.status, bodyText), response.status);
    if (retryable && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delayMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await sleep(Math.min(delayMs, 30_000));
      continue;
    }
    throw lastError;
  }
  /* istanbul ignore next -- loop always returns or throws */
  throw lastError ?? new Cin7ApiError("Unexpected request failure");
}

/**
 * POST /v1/ProductImages — the one endpoint that is not JSON: it takes a
 * multipart/form-data file upload plus productId / imagePriority query params.
 */
export async function cin7UploadProductImage(
  config: Cin7Config,
  productId: number,
  fileName: string,
  fileBytes: Buffer,
  imagePriority?: number,
): Promise<unknown> {
  const url = new URL(`${config.baseUrl}/v1/ProductImages`);
  url.searchParams.set("productId", String(productId));
  if (imagePriority !== undefined) url.searchParams.set("imagePriority", String(imagePriority));

  const auth = Buffer.from(`${config.username}:${config.apiKey}`).toString("base64");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fileBytes)]), fileName);

  await limiter.acquire();
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}` },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const bodyText = (await response.text().catch(() => "")).slice(0, 2000);
    throw new Cin7ApiError(errorMessage(response.status, bodyText), response.status);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
