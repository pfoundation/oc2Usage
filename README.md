# `@pfoundation/opencode-providers-usage`

OpenCode plugin that shows **provider usage limits** in the TUI footer and a `/usage` dialog.

Footer examples:

```text
claude ◔ 8/28%
go ◔ 0/0/2%
grok ◔ 6%
```

## Providers

The plugin reads credentials from OpenCode's own connections (`/connect`). There is no plugin config and no extra keys.

| Provider    | Integration                      | Windows                                                                            |
| ----------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Claude      | `anthropic` (subscription OAuth) | 5h, week, per-model weekly (Fable / Sonnet / Opus when present), extra-usage month |
| Grok        | `xai`                            | weekly credits                                                                     |
| OpenCode Go | `opencode-go`                    | 5h, week, month                                                                    |

Unconnected providers are omitted.

## Install

In `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@pfoundation/opencode-providers-usage"],
}
```

Pin a version with `@pfoundation/opencode-providers-usage@0.1.0` if you prefer.

The CLI half loads automatically through the package `./tui` export. **Do not** also add it to `cli.json`. Restart OpenCode after installing.

### Local checkout

```sh
git clone https://github.com/pfoundation/opencode-providers-usage.git
cd opencode-providers-usage
bun install
```

Then:

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-providers-usage"],
}
```

## Usage

The footer chip shows **only the session's current provider**. Percents are joined with `/` in this order: 5h, week, scoped (e.g. Fable), month — e.g. `go 0/0/2%`, `claude 8/28%`.

A single unlabeled pie shows **time until reset** for the most-used window (`●` reset soon → `○` long wait) — e.g. `grok ◔ 6%`, `claude ◔ 8/28%`.

A failed refresh keeps the last good values. After 10 minutes without a successful fetch the chip is muted.

`/usage` (alias `/limits`) force-refreshes and opens a per-provider dialog (Window / Used / Resets) with the exact fetch time. After 3 minutes, `r` refreshes from the dialog. `esc` closes it.

## Refresh policy

Usage refreshes after each session turn, at most once every 3 minutes. Idle OpenCode does not poll. Each provider request times out after 15 seconds.

## Privacy

The plugin sends the matching connection token only to that provider's own API host:

- `https://api.anthropic.com/api/oauth/usage`
- `https://cli-chat-proxy.grok.com/v1/billing?format=credits`
- `https://opencode.ai/zen/go/v1/usage`

Requests send `User-Agent: opencode-providers-usage/0.1.0`.

The Anthropic OAuth usage endpoint and the Grok billing endpoint are undocumented and may change. This plugin is not affiliated with Anthropic, xAI, or OpenCode.

## Compatibility

Built for the OpenCode v2 plugin API. Tested with OpenCode 1.18.21 and `@opencode-ai/plugin` `0.0.0-beta-18743`.

## Development

```sh
bun install
bun test
bun run typecheck
```

There is no build step. Layout:

| Export  | File                                      |
| ------- | ----------------------------------------- |
| `.`     | `src/index.ts` — server plugin `oc.usage` |
| `./tui` | `src/tui.tsx` — CLI plugin `oc.usage.cli` |
| `./rpc` | `src/rpc.ts` — RPC contract `ocUsage`     |

Other plugins and clients can import the contract:

```ts
import { Usage } from "@pfoundation/opencode-providers-usage/rpc";
```

## License

MIT © 2026 P Foundation
