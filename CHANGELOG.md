# Changelog

## 0.1.0

Initial release.

- Footer chip for the session's current provider (Claude, Grok, OpenCode Go)
- `/usage` (`/limits`) dialog with Window / Used / Resets and fetch time
- Refresh after each session turn, at most once every 3 minutes; no idle polling
- Failed refresh keeps last good values
- Footer pie for time until reset on the most-used window (`●` soon → `○` long wait)
