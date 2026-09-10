# Changelog

## 26.9.1

- fix: sync package version from tag before npm publish (4b66297)
- chore: update plugin SDK to @opencode/plugin (ffac87b)

## 26.9.0

- chore: trim keywords, automate releases via workflow_dispatch (#1) (86a6615)
- docs: add Meta footer chip screenshot to README (40532eb)
- docs: add /usage dialog screenshot to README (3dca2aa)
- chore: normalize package name to @pfoundation/oc2usage for the 0.3.1 release (825b764)
- feat: /usage dialog shows all Anthropic windows under Anthropic · Claude (a715da7)
- feat: OpenAI subscription usage with 5h/week Codex windows and openai payg (992113d)

## 0.3.1

- Normalize the npm package name to `@pfoundation/oc2usage` (lowercase)
- `/usage` dialog shows `Anthropic · Claude` with all reported Anthropic windows (5h, week, per-model Fable/Sonnet/Opus, extra) instead of model-filtered substitution
- Footer chip keeps the model-aware weekly selection (`claude 8/54%` on Fable, `claude 8/28%` otherwise)

## 0.3.0

- OpenAI (ChatGPT subscription) usage: 5h + week Codex windows from `GET https://chatgpt.com/backend-api/wham/usage`, classified by `limit_window_seconds` so weekly-only plans are not mislabeled; API keys show `openai payg`
- Pasted ChatGPT JWT access tokens are treated as OAuth, not API keys

## 0.2.0

- Anthropic API keys show `claude payg` (footer) / "pay-as-you-go" (`/usage`) instead of `unauthorized`; the OAuth usage endpoint is no longer called for key credentials
- Meta (Muse Spark) subscription usage: 5h + week from the `response.subscription_usage` SSE event; `meta payg` on pay-as-you-go keys
- JSONL query log at `~/.local/share/opencode/log/oc-usage.jsonl` (`query` + `http` lines)
- Process-wide usage cache / inflight lock (one HTTP round per process, not per project)
- Claude Fable weekly replaces the all-models week (footer + `/usage`) instead of showing both

## 0.1.0

Initial release.

- Footer chip for the session's current provider (Claude, Grok, OpenCode Go)
- `/usage` (`/limits`) dialog with Window / Used / Resets and fetch time
- Refresh after each session turn, at most once every 3 minutes; no idle polling
- Failed refresh keeps last good values
- Footer vertical blocks for time remaining (`█` long wait → `▁` soon): 5h at ≥75% used, week at ≥50%; both joined with `/`
