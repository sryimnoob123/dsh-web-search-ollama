# dsh-web-search-ollama

Ollama-backed web search provider for DeepSeek Harness. Registers a search provider on the
`ctx.web` seam that calls Ollama REST web search API (`POST https://ollama.com/api/web_search`)
and maps the results into dsh `web_search` tool shape (`{url, title, snippet}`).

## Why

The shipped `@deepseek-ai/dsh-web-search-deepseek` provider speaks only the Anthropic
`web_search_20250305` server tool over DeepSeek official Messages endpoint, and needs a
**DeepSeek** API key. If your models run on Ollama (cloud or local), this plugin lets the
same `web_search` tool use Ollama web search API instead, authenticated with the
same `OLLAMA_API_KEY` your chat provider already uses.

## Install

```
dsh plugin --profile <active-profile> add link:<this-repo-path>
```

Then make the web seam select this provider (the base row defaults to `deepseek-official`):

```yaml
# profile cordis.patch.yml
- id: web
  config:
    searchProvider: ollama
```

## Config

Optional settings section `web-search-ollama:` in `$DSH_HOME/settings.yaml`:

```yaml
web-search-ollama:
  apiKeyEnv: OLLAMA_API_KEY
  maxResults: 5
  # baseURL: https://ollama.com/api/web_search
```

Defaults: `apiKeyEnv: OLLAMA_API_KEY`, `maxResults: 5`, endpoint
`https://ollama.com/api/web_search` (env override `OLLAMA_WEB_SEARCH_BASE_URL`).