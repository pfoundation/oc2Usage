# AGENTS.md — `@pfoundation/oc2Usage`

OpenCode v2 plugin: provider usage limits in the TUI footer and a `/usage` dialog.

## Commands

```sh
bun install
bun test
bun run typecheck
bun run format
bun run pack:check
```

Run `bun test` and `bun run typecheck` before committing. There is no build step — OpenCode loads `.ts` / `.tsx` directly.

## Layout

| Path                    | Role                                             |
| ----------------------- | ------------------------------------------------ |
| `src/index.ts`          | Server plugin `oc.usage` (`exports` `.`)         |
| `src/tui.tsx`           | CLI plugin `oc.usage.cli` (`exports` `./tui`)    |
| `src/rpc.ts`            | RPC contract `ocUsage` (`exports` `./rpc`)       |
| `src/providers.ts`      | Fetch + parse Claude / Grok / Go / Meta / OpenAI |
| `src/format.ts`         | Pure snapshot / footer / dialog helpers          |
| `src/log.ts`            | JSONL query/HTTP log helpers                     |
| `src/gate.ts`           | Process-wide cache / inflight lock               |
| `src/usage-chip.tsx`    | Footer slot                                      |
| `src/usage-dialog.tsx`  | `/usage` dialog                                  |
| `src/sessions.ts`       | Pure session-list helpers                        |
| `test/format.test.ts`   | `bun:test`                                       |
| `test/meta.test.ts`     | Meta SSE extract / parse / footer                |
| `test/openai.test.ts`   | wham/usage parse / account id / footer           |
| `test/sessions.test.ts` | Session-list helpers                             |
| `test/log.test.ts`      | Query log format / path                          |
| `test/gate.test.ts`     | Process-wide gate coalescing                     |

## IDs

| Kind          | ID                             |
| ------------- | ------------------------------ |
| Server plugin | `oc.usage`                     |
| CLI plugin    | `oc.usage.cli`                 |
| RPC           | `ocUsage`                      |
| Command       | `oc.usage.show`                |
| Command       | `oc.usage.sessions` (`ctrl+w`) |
| Slash         | `/usage` (alias `/limits`)     |

## Endpoints

- Anthropic: `https://api.anthropic.com/api/oauth/usage`
- Grok: `https://cli-chat-proxy.grok.com/v1/billing?format=credits`
- OpenCode Go: `https://opencode.ai/zen/go/v1/usage`
- Meta: `POST https://api.meta.ai/v1/responses` (minimal streaming probe, reads only the `response.subscription_usage` SSE event)
- OpenAI: `https://chatgpt.com/backend-api/wham/usage` (ChatGPT OAuth + `ChatGPT-Account-Id` header; windows classified by `limit_window_seconds`)

Tokens come from OpenCode connections (`xai`, `opencode-go`, `anthropic`, `meta`, `openai`). Anthropic/OpenAI `type: "key"` credentials skip the endpoint and report `payg` (`isApiKeyCredential` in `src/providers.ts`). Bump `USER_AGENT` in `src/providers.ts` with each release.

## Local load

```jsonc
{
  "plugins": ["/home/ubuntu/dev/oc2Usage"],
}
```

Do not also list this package in `cli.json`.
