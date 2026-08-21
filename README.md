# dsh-web-search-ollama

> 让 DeepSeek Harness 的 `web_search` 工具走 Ollama 的联网搜索 API，无需 DeepSeek 官方 Key，复用你已有的 `OLLAMA_API_KEY`。

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)

---

## 这是什么

DeepSeek Harness 自带的 `@deepseek-ai/dsh-web-search-deepseek` 只支持 DeepSeek 官方 Anthropic 兼容端点（`web_search_20250305` 服务端工具），并要求一个 **DeepSeek 官方 API key**。如果你用 Ollama 跑模型（云端或本地），这个插件让 DSH 的 `web_search` 工具改走 [Ollama Web Search API](https://docs.ollama.com/capabilities/web-search)，认证使用与聊天模型相同的 `OLLAMA_API_KEY`。

| | 内置 DeepSeek 插件 | 本插件 |
| --- | --- | --- |
| 依赖 Key | `DEEPSEEK_API_KEY`（DeepSeek 官方） | `OLLAMA_API_KEY`（Ollama） |
| 协议 | Anthropic Messages + `web_search_20250305` | Ollama REST `/api/web_search` |
| 适用场景 | 使用 DeepSeek 官方 API | 使用 Ollama（云/本地） |

## 工作原理

插件在 DSH 的 `ctx.web` seam 上注册一个 id 为 `ollama` 的搜索 provider：

1. 收到 `web_search` 工具的 `query`
2. 以 `Authorization: Bearer $OLLAMA_API_KEY` 调用 `POST https://ollama.com/api/web_search`
3. 将 Ollama 返回的 `{title, url, content}` 映射为 DSH 标准的 `{url, title, snippet}` 结果

没有命中时返回空 sources 列表（不是报错），模型会看到"没搜到"而不是"搜索失败"。结果里缺 `url` 的条目会被丢弃，不会把坏形状传给 seam。

## 安装

### 1. 添加插件

```bash
cd $DSH_HOME/profiles/<你的profile>
pnpm add dsh-web-search-ollama@github:sryimnoob123/dsh-web-search-ollama
# 或本地开发时使用 link：
# pnpm add link:/绝对路径/dsh-web-search-ollama
```

然后将插件加入 profile 的 `package.json` bundles 列表：

```json
"dsh": {
  "profile": {
    "bundles": [
      "...原有 bundle...",
      "dsh-web-search-ollama"
    ]
  }
}
```

### 2. 安装依赖

```bash
cd $DSH_HOME/profiles/<你的profile>
pnpm install
```

### 3. 让 web seam 使用本 provider

在 profile 的 `cordis.patch.yml` 末尾追加（覆盖内置的 `deepseek-official` 选择）：

```yaml
# 联网搜索：web seam 选择 ollama provider（覆盖 base 的 deepseek-official）
- id: web
  config:
    searchProvider: ollama

# 可选：禁用 DeepSeek 官方搜索插件，避免两个 provider 并存
- id: web-search-deepseek
  disabled: true
```

### 4. 配置 API Key

确保 `$DSH_HOME/.credentials.yaml` 中有：

```yaml
OLLAMA_API_KEY: <你的Ollama API Key>
```

### 5. 重启

重启 DSH 后即可使用。

## 验证

```bash
curl https://ollama.com/api/web_search \
  -H "Authorization: Bearer $OLLAMA_API_KEY" \
  -d '{"query":"what is ollama?"}'
```

在 DSH 中让模型执行一次联网搜索，应看到结构化来源列表而非报错。

## 配置项

可在 `$DSH_HOME/settings.yaml` 的 `web-search-ollama:` 段覆盖默认值：

```yaml
web-search-ollama:
  apiKeyEnv: OLLAMA_API_KEY   # 凭据引用（默认 OLLAMA_API_KEY）
  maxResults: 5               # 每查询最大结果数（默认 5，1-10，超界自动收敛）
  # baseURL: https://ollama.com/api/web_search
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKeyEnv` | `OLLAMA_API_KEY` | 凭据引用名 |
| `maxResults` | `5` | 每查询最大结果数，范围 1-10（自动 clamp） |
| `baseURL` | `https://ollama.com/api/web_search` | 端点地址；也可用环境变量 `OLLAMA_WEB_SEARCH_BASE_URL` 覆盖 |

## 常见问题

### 搜索报 `no web_search_tool_result blocks`

这是把内置 `web-search-deepseek` 的 `baseURL` 指向 Ollama 时的典型错误：Ollama 的 Anthropic 兼容端点不会返回 DSH 期望的 `web_search_tool_result` 块。请按上文安装步骤使用本插件，并清除 `settings.yaml` 中 `web-search-deepseek.baseURL` 的覆盖。

### 报 `WEB_PROVIDER_UNAVAILABLE` / 搜索不可用

确认 `.credentials.yaml` 中存在 `OLLAMA_API_KEY`，且 `web` 行的 `searchProvider` 已设为 `ollama`。

## License

MIT