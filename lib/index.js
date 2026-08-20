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
  return process.env[name];
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
    const options = this.resolveOptions();
    return (
      (options.apiKey?.length ?? 0) > 0 ||
      options.resolveApiKey !== void 0
    ) && URL.canParse(options.baseURL);
  }

  async search(request, signal) {
    const options = this.resolveOptions();
    const apiKey = await this.apiKey(options, signal);
    throwIfAborted(signal);

    const body = {
      query: request.query,
      max_results: options.maxResults ?? 5
    };
    options.recordRequest?.({ endpoint: options.baseURL, body });

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
        ...signal !== void 0 ? { signal } : {}
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw signalAborted(signal, error);
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
  const results = Array.isArray(body?.results) ? body.results : [];
  if (results.length === 0) throw new WebError("Ollama web search returned no results", "WEB_PROVIDER_ERROR");
  return {
    sources: results.map((item) => ({
      url: item.url,
      ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
      ...item.content != null && item.content.length > 0 ? { snippet: item.content } : {}
    })),
    truncated: false
  };
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
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
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
  const literalApiKey = config.apiKey !== void 0 && config.apiKey.length > 0 ? config.apiKey : void 0;
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
    baseURL: config.baseURL ?? launchEnv(ctx, "OLLAMA_WEB_SEARCH_BASE_URL") ?? OLLAMA_WEB_SEARCH_BASE,
    maxResults: config.maxResults ?? 5,
    recordRequest: (request) => {
      ctx.get("agents")?.currentInitiator()?.session.append("web/ollama-search-request", request);
    }
  };
}

const name = "web-search-ollama";
const inject = ["web"];

function apply(ctx, config) {
  let current = () => config;
  ctx.web.registerSearchProvider(new OllamaSearchProvider(() => resolveOptions(ctx, current())));
}

export { OllamaSearchProvider, DEFAULT_API_KEY_ENV, OLLAMA_PROVIDER_ID, apply, inject, name };