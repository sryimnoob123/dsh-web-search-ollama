# 更新日志

本项目所有值得记录的变更都会写在这里。

## [0.1.1] - 2026-08-25

### 修复
- `maxResults` 防御 NaN 输入：非法值回落到默认 5，不再把 NaN 传给 Ollama API。
- 修正注释与实际行为不一致：`timeoutMs` 非正数时统一落到默认 30 秒。

## [0.1.0] - 2026-08-21

- 首个版本：在 `ctx.web` seam 注册 `ollama` 搜索 provider，把 DSH 的 `web_search` 工具接到 Ollama Web Search API。
- 支持 `OLLAMA_API_KEY` 环境变量 / 凭证服务解析、自定义 `baseURL`、`maxResults`（1-10）、超时（默认 30s）。
- 一键安装脚本：自动写入 `searchProvider: ollama` 配置 + 设置 `DSH_WEB_SEARCH_PROVIDER` 环境变量双保险。
