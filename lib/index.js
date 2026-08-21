/**
 * dsh-web-search-ollama - Ollama-backed web search provider for dsh.
 *
 * Registers a search provider on the ctx.web seam that calls Ollama's
 * REST web search API (POST https://ollama.com/api/web_search) and maps
 * the results into dsh's WebSource shape ({url,title,snippet}).
 *
 * Self-contained on purpose: profile bundles cannot import @deepseek-ai/*
 * packages (they live in the harness app, not the profile), so the tiny
 * credential/env helpers are inlined here.
 */

const OLLAMA_PROVIDER_ID = "ollama";
const OLLAMA_WEB_SEARCH_BASE = "https://ollama.com/api/web_search";
const DEFAULT_API_KEY_ENV = "OLLAMA_API_KEY";
const USER_AGENT = "dsh-web-search-ollama/0.1.0";

/** Brand a raw string as a credential ref (mirrors @deepseek-ai/dsh-credentials). */
function credentialRef(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new TypeError("credential ref \"" + value + "\" must match ^[A-Za-z_][A-Za-z0-9_]*$");
  return value;
}

/** Resolve one env value from the launch environment, else process.env. */
function launchEnv(ctx, name) {
  const snapshot = ctx.get("launchEnvironment");
  const value = snapshot !== void 0 && typeof snapshot.get === "function" ? snapshot.get(name) : void 0;
  if (value !== void 0 && typeof value === "object" && value !== null && "value" in value) return value.value;
  return typeof process !== "undefined" ? process.env[name] : void 0;
}

/** Minimal web error with a machine-routable code (mirrors @dsh-web WebError). */
class WebError extends Error {
  code;
  constructor(message, code, options) {
    super(message, options);
    this.name = "WebError";
    this.code = code;
  }
}

var OllamaSearchProvider = class {
  resolveOptions;
  id = OLLAMA_PROVIDER_ID;

  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions;
  }

  available() {
    // Sync-only probe: resolveApiKey is async and the provider has no ctx, so
    // resolveOptions snapshots a synchronous hasKey flag (literal key / env /
    // credentials service present). A bad apiKeyEnv must degrade to
    // unavailable, never throw from available().
    try {
      const options = this.resolveOptions();
      return options.hasKey === true && isParsableUrl(options.baseURL);
    } catch {
      return false;
    }
  }

  async search(request, signal) {
    const options = this.resolveOptions();
    const apiKey = await this.apiKey(options, signal);
    throwIfAborted(signal);

    const body = {
      query: request.query,
      max_results: options.maxResults ?? 5
    };

    // Timeout guard: AbortSignal.timeout (Node 17.3+) + AbortSignal.any
    // (Node 20.3+) so a hung endpoint cannot stall a search forever. The
    // caller's signal (if any) still wins for cancellation semantics.
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const combined = signal !== void 0 && typeof AbortSignal.any === "function"
      ? AbortSignal.any([signal, timeoutSignal])
      : signal !== void 0 ? signal : timeoutSignal;

    let response;
    try {
      response = await fetch(options.baseURL, {
        method: "POST",
        headers: {
          "authorization": "Bearer " + apiKey,
          "content-type": "application/json",
          "accept": "application/json",
          "user-agent": USER_AGENT
        },
        body: JSON.stringify(body),
        signal: combined
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw signalAborted(signal, error);
      if (isTimeoutError(error)) throw new WebError("Ollama web search timed out after " + options.timeoutMs + "ms", "WEB_PROVIDER_ERROR", { cause: error });
      throw new WebError("Ollama web search request failed: " + String(error), "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (!response.ok) {
      let message = "Ollama web search API error (HTTP " + response.status + ")";
      try {
        const parsed = await response.json();
        const detail = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
        if (detail !== void 0 && detail.length > 0) message = detail;
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw new WebError("web search aborted", "WEB_ABORTED");
      }
      throw new WebError(message, "WEB_PROVIDER_ERROR");
    }

    try {
      return mapOllamaResponse(await response.json());
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw new WebError("web search aborted", "WEB_ABORTED");
      if (error instanceof WebError) throw error;
      throw new WebError("Ollama returned an unprocessable response body: " + String(error), "WEB_PROVIDER_ERROR", { cause: error });
    }
  }

  async apiKey(options, signal) {
    throwIfAborted(signal);
    if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
    let resolved;
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(void 0), signal);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw new WebError("web search aborted", "WEB_ABORTED");
      throw new WebError("Ollama web search credential resolution failed: " + String(error), "WEB_PROVIDER_ERROR", { cause: error });
    }
    if (resolved !== void 0 && resolved.length > 0) return resolved;
    throw new WebError("Ollama web search has no API key for " + (options.apiKeyEnv ?? DEFAULT_API_KEY_ENV) + "; store it through the credentials service or export it in the launching environment", "WEB_PROVIDER_CREDENTIAL_MISSING");
  }
};

function mapOllamaResponse(body) {
  // A REST search with zero hits is a normal outcome, not an error: the seam
  // expects { sources: [] } so the model sees "nothing found" instead of a
  // provider failure. Non-array bodies (protocol drift) still fail loudly.
  if (!Array.isArray(body?.results)) throw new WebError("Ollama web search returned an unprocessable response body", "WEB_PROVIDER_ERROR");
  return {
    // url is the only required WebSource field: drop items without one instead
    // of emitting { url: undefined } and breaking the seam's contract.
    sources: body.results
      .filter((item) => item !== null && typeof item === "object" && typeof item.url === "string" && item.url.length > 0)
      .map((item) => ({
        url: item.url,
        ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
        ...item.content != null && item.content.length > 0 ? { snippet: item.content } : {}
      })),
    truncated: false
  };
}

/** URL.canParse is Node 18.17+; older hosts need a try/catch fallback. */
function isParsableUrl(value) {
  if (typeof URL.canParse === "function") return URL.canParse(value);
  try { new URL(value); return true; } catch { return false; }
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError";
}

function signalAborted(signal, cause) {
  return new WebError("web search aborted", "WEB_ABORTED", { cause });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signalAborted(signal);
}

async function abortable(operation, signal) {
  if (signal === void 0) return operation;
  if (signal.aborted) return Promise.reject(signalAborted(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(signalAborted(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then((value) => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

function resolveOptions(ctx, config) {
  const cfg = config ?? {};
  const apiKeyEnv = credentialRef(cfg.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
  const literalApiKey = cfg.apiKey !== void 0 && cfg.apiKey.length > 0 ? cfg.apiKey : void 0;
  const ambientKey = launchEnv(ctx, apiKeyEnv);
  // Synchronous availability probe for available(): a literal key, an env
  // value, or a credentials service that can resolve the ref all count.
  const hasKey = literalApiKey !== void 0 || (ambientKey !== void 0 && ambientKey.length > 0) || ctx.get("credentials") !== void 0;
  return {
    ...literalApiKey === void 0 ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get("credentials");
      if (credentials !== void 0 && typeof credentials.resolve === "function") {
        const found = await credentials.resolve(apiKeyEnv);
        if (found !== void 0 && found?.value?.length > 0) return found.value;
      }
      const ambient = launchEnv(ctx, apiKeyEnv);
      return ambient !== void 0 && ambient.length > 0 ? ambient : void 0;
    },
    apiKeyEnv,
    hasKey,
    baseURL: cfg.baseURL ?? launchEnv(ctx, "OLLAMA_WEB_SEARCH_BASE_URL") ?? OLLAMA_WEB_SEARCH_BASE,
    // Ollama caps max_results at 10; clamp so the README's 1-10 contract holds.
    maxResults: Math.min(10, Math.max(1, Math.trunc(cfg.maxResults ?? 5))),
    // Positive finite timeout for the REST call (default 30s), 0 disables.
    timeoutMs: cfg.timeoutMs !== void 0 && Number.isFinite(cfg.timeoutMs) && cfg.timeoutMs > 0 ? cfg.timeoutMs : 30000
  };
}

const name = "web-search-ollama";
const inject = ["web"];

function apply(ctx, config) {
  ctx.web.registerSearchProvider(new OllamaSearchProvider(() => resolveOptions(ctx, config)));
}

export { OllamaSearchProvider, DEFAULT_API_KEY_ENV, OLLAMA_PROVIDER_ID, apply, inject, name };