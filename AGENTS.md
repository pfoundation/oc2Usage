# AGENTS.md — `@pfoundation/opencode-providers-usage`

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

| Path                   | Role                                          |
| ---------------------- | --------------------------------------------- |
| `src/index.ts`         | Server plugin `oc.usage` (`exports` `.`)      |
| `src/tui.tsx`          | CLI plugin `oc.usage.cli` (`exports` `./tui`) |
| `src/rpc.ts`           | RPC contract `ocUsage` (`exports` `./rpc`)    |
| `src/providers.ts`     | Fetch + parse Claude / Grok / Go              |
| `src/format.ts`        | Pure snapshot / footer / dialog helpers       |
| `src/usage-chip.tsx`   | Footer slot                                   |
| `src/usage-dialog.tsx` | `/usage` dialog                               |
| `test/format.test.ts`  | `bun:test`                                    |

## IDs

| Kind          | ID                         |
| ------------- | -------------------------- |
| Server plugin | `oc.usage`                 |
| CLI plugin    | `oc.usage.cli`             |
| RPC           | `ocUsage`                  |
| Command       | `oc.usage.show`            |
| Slash         | `/usage` (alias `/limits`) |

## Endpoints

- Anthropic: `https://api.anthropic.com/api/oauth/usage`
- Grok: `https://cli-chat-proxy.grok.com/v1/billing?format=credits`
- OpenCode Go: `https://opencode.ai/zen/go/v1/usage`

Tokens come from OpenCode connections (`xai`, `opencode-go`, `anthropic`). Bump `USER_AGENT` in `src/providers.ts` with each release.

## Local load

```jsonc
{
  "plugins": ["/home/ubuntu/dev/ocPluginUsage"],
}
```

Do not also list this package in `cli.json`.
