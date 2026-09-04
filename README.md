# `@pfoundation/oc2Usage`

OpenCode plugin that shows **provider usage limits** in the TUI footer and a `/usage` dialog.

Footer examples:

```text
claude 8/28%
claude ▄/6d▅ 80/60%
grok 6d▁ 60%
meta 2/0%
meta payg
```

## Providers

The plugin reads credentials from OpenCode's own connections (`/connect`). There is no plugin config and no extra keys.

| Provider    | Integration                      | Windows                                                                              |
| ----------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| Claude      | `anthropic` (subscription OAuth) | 5h, week (Fable weekly replaces all-models week when using Fable), extra-usage month |
| Grok        | `xai`                            | weekly credits                                                                       |
| OpenCode Go | `opencode-go`                    | 5h, week, month                                                                      |
| Meta        | `meta` (Model API key)           | 5h subscription prompts, week (subscription only; pay-as-you-go shows `meta payg`)   |

Unconnected providers are omitted.

## Install

In `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@pfoundation/oc2Usage"],
}
```

Pin a version with `@pfoundation/oc2Usage@0.1.0` if you prefer.

The CLI half loads automatically through the package `./tui` export. **Do not** also add it to `cli.json`. Restart OpenCode after installing.

### Local checkout

```sh
git clone https://github.com/pfoundation/oc2Usage.git
cd oc2Usage
bun install
```

Then:

```jsonc
{
  "plugins": ["/absolute/path/to/oc2Usage"],
}
```

## Usage

The footer chip shows **only the session's current provider**. Percents are joined with `/` in this order: 5h, week, month — e.g. `go 0/0/2%`, `claude 8/28%`. When the session is on Fable (or Fable weekly is present and the model is unknown), the Fable weekly cap is shown instead of the all-models week — e.g. `claude 8/54%`.

Unlabeled vertical blocks show **time remaining** until reset (`█` long wait → `▁` reset soon). The 5h block appears at **≥ 75%** used; the weekly block at **≥ 50%**. If both qualify they are joined with `/` — e.g. `claude ▄/6d▅ 80/60%`. The 5h block scales to its window (about 37.5 minutes per step); multi-day blocks show whole days plus an hourly block (`6d▅` = 6 days + ~12h, bare `▅` when under a day).

A failed refresh keeps the last good values. After 10 minutes without a successful fetch the chip is muted.

`/usage` (alias `/limits`) force-refreshes and opens a per-provider dialog (Window / Used / Resets) with the exact fetch time. After 3 minutes, `r` refreshes from the dialog. `esc` closes it.

`ctrl+w` opens a session picker (most recent first) and switches to the selected session. Remap or disable in `cli.json` — it overrides the default `input.delete.word.backward` binding:

```jsonc
{
  "keybinds": {
    "oc.usage.sessions": "ctrl+w",
    // "oc.usage.sessions": false,
  },
}
```

## Refresh policy

Usage refreshes after each session turn, at most once every 3 minutes. Idle OpenCode does not poll. Each provider request times out after 15 seconds. OpenCode loads the plugin once per project; those instances share one in-flight fetch and cache so a turn is one HTTP round per process, not per project.

## Privacy

The plugin sends the matching connection token only to that provider's own API host:

- `https://api.anthropic.com/api/oauth/usage`
- `https://cli-chat-proxy.grok.com/v1/billing?format=credits`
- `https://opencode.ai/zen/go/v1/usage`
- `https://api.meta.ai/v1/responses`

Meta has no quota endpoint: the plugin sends a minimal streaming probe (`muse-spark-1.3`, ~25 tokens) and reads only the `response.subscription_usage` SSE event — the same event Muse Code's `/usage` reads. The completion text is discarded and the response body is never logged. On pay-as-you-go keys there is no subscription event, so the footer shows `meta payg`.

Requests send `User-Agent: usageTrackerWidget/0.2.0`.

The Anthropic OAuth usage endpoint and the Grok billing endpoint are undocumented and may change. This plugin is not affiliated with Anthropic, xAI, or OpenCode.

## Compatibility

Built for the OpenCode v2 plugin API. Tested with OpenCode 1.18.21 and `@opencode-ai/plugin` `0.0.0-beta-18743`.

## Development

```sh
bun install
bun test
bun run typecheck
```

Query log (JSONL), one line per snapshot get and per provider HTTP call:

`~/.local/share/opencode/log/oc-usage.jsonl`

```sh
grep '"kind":"http"' ~/.local/share/opencode/log/oc-usage.jsonl | wc -l
grep '"provider":"anthropic"' ~/.local/share/opencode/log/oc-usage.jsonl
```

Does not include tokens or successful response bodies. Delete the file anytime.

There is no build step. Layout:

| Export  | File                                      |
| ------- | ----------------------------------------- |
| `.`     | `src/index.ts` — server plugin `oc.usage` |
| `./tui` | `src/tui.tsx` — CLI plugin `oc.usage.cli` |
| `./rpc` | `src/rpc.ts` — RPC contract `ocUsage`     |

Other plugins and clients can import the contract:

```ts
import { Usage } from "@pfoundation/oc2Usage/rpc";
```

## License

MIT © 2026 P Foundation
