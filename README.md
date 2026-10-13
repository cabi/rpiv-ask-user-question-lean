# rpiv-ask-user-question-lean

A token-lean wrapper around **[@juicesharp/rpiv-ask-user-question](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question)** by **juicesharp** (MIT). This project keeps every upstream feature — validation, the questionnaire UI, RPC fallback, i18n, response envelopes — and only shortens the tool description and parameter schema the model reads on every request.

Upstream is installed as a pinned dependency (`2.13.8`) and wrapped via a Proxy; no upstream code is copied or modified. The original MIT license is kept (see [LICENSE](./LICENSE)).

## How it works

1. On registration, upstream receives a Proxy in place of the `pi` object.
2. The Proxy captures `registerTool` instead of forwarding it.
3. Each captured tool is re-registered with lean texts and a description-stripped schema; `execute` and all schema constraints are upstream's, unchanged.
4. `setActiveTools` is shadowed, never forwarded: upstream's `before_agent_start` reconciler (which strips the tool when no UI is available) can no longer change the tool list mid-session. Upstream's execute has its own `!ctx.hasUI` backstop, so no-UI runs still get a clean error envelope instead of the tool.
5. Common unambiguous argument mistakes are repaired before validation: a lone question object wrapped into the `questions` array, top-level `question`/`header`/`options` restructured, string options converted to `{label, description}`, missing option descriptions filled with `""`, and `"true"`/`"false"` strings for `multiSelect` coerced to booleans. Anything ambiguous (e.g. a missing `header`) is left for validation to report; reserved labels (`Other`, `Type something.`) still reach upstream's validator.

Guidance overrides in `~/.config/rpiv-ask-user-question/config.json` (`guidance.description`, `guidance.promptSnippet`, `guidance.promptGuidelines`) pass through verbatim; unset fields fall back to the lean texts.

## Token cost

Measured with `npm run measure` (js-tiktoken, gpt-4o encoding):

| Field | Upstream chars | Upstream tokens | Lean chars | Lean tokens | Token saving |
|---|---:|---:|---:|---:|---:|
| ask_user_question description | 1641 | 320 | 102 | 18 | 94% |
| ask_user_question promptSnippet | 92 | 20 | 105 | 16 | 20% |
| ask_user_question promptGuidelines | 1214 | 238 | 509 | 109 | 54% |
| ask_user_question parameters (JSON) | 2033 | 441 | 883 | 219 | 50% |
| **Total** | **4980** | **1019** | **1599** | **362** | **64%** |

## Install

```sh
npm install rpiv-ask-user-question-lean
```

Then in your pi extension config, point at this package instead of upstream:

```json
{
	"extensions": ["rpiv-ask-user-question-lean"]
}
```

## Development

```sh
npm install
npm test        # vitest — 24 tests against the real upstream package
npm run typecheck
npm run measure # prints the token table above
```

See [MAINTENANCE.md](./MAINTENANCE.md) for the upstream contract this wrapper depends on and how to upgrade.
