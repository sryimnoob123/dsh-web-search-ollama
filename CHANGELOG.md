# 更新日志

## [0.1.1] - 2026-08-25

### 修复

- `maxResults` 传入非法值时不再产出 NaN：现在回落到默认 5，不会把坏值发给 Ollama。
- 超时注释和实际行为对齐：非正数 `timeoutMs` 统一按默认 30 秒处理。

### 其它

- 补 LICENSE 与 `repository`/`engines`/`keywords` 字段，满足 npm 发布与社区收录要求。

## [0.1.0] - 2026-08-21

- 首个版本：DSH 的 `web_search` 工具改走 Ollama Web Search API，用 `OLLAMA_API_KEY` 认证，不碰 DeepSeek 官方 Key。
- 支持自定义 `baseURL`、`maxResults`（1-10）、超时（默认 30s）。
- 一键安装脚本：写入 `searchProvider: ollama` 配置，并设置 `DSH_WEB_SEARCH_PROVIDER` 环境变量做双保险。
- 空搜索结果返回空列表而不是报错；缺 `url` 的结果自动丢弃，不把坏形状传给 seam。
