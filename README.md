# rpiv-ask-user-question-lean

A token-lean wrapper around **[@juicesharp/rpiv-ask-user-question](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question)** by **juicesharp** (MIT). This project keeps every upstream feature — validation, the questionnaire UI, RPC fallback, i18n, response envelopes — and only shortens the tool description and parameter schema the model reads on every request.

Upstream is installed as a pinned dependency (`2.13.9`) and wrapped via a Proxy; no upstream code is copied or modified. The original MIT license is kept (see [LICENSE](./LICENSE)).

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

This is a pi package. Install it from GitHub:

```sh
pi install git:github.com/cabi/rpiv-ask-user-question-lean
```

That writes the extension to `~/.pi/agent/settings.json` (add `-l` to install it into the current project's `.pi/settings.json` instead). If you had upstream `@juicesharp/rpiv-ask-user-question` installed, remove it so the questionnaire isn't registered twice:

```sh
pi remove npm:@juicesharp/rpiv-ask-user-question
```

Useful follow-ups:

```sh
pi list                      # verify the package is configured
pi -e git:github.com/cabi/rpiv-ask-user-question-lean   # try it for one invocation
pi update --extensions       # reconcile the checkout after upstream syncs
```

## Keeping up with upstream

Pin the upstream version and upgrade by hand. The process is nearly always the same, so you can hand it to an agent too (this is the sync prompt from [Make your own lean version](https://github.com/kunkun9527/my-lean-pi-setup/blob/main/docs/make-your-own-lean.md), with this package's names filled in):

```text
Sync rpiv-ask-user-question-lean to the latest version of @juicesharp/rpiv-ask-user-question.

1. Read MAINTENANCE.md first to understand the current upstream version and adaptation points.
2. Check the latest upstream version. Compare the code and changelog between the two versions, and list: tool changes (name, registration shape), changes to parameters and defaults, behavior changes, and whether the internals recorded in MAINTENANCE.md still hold.
3. If only the version number changed and the code didn't, just upgrade the dependency.
4. For new or changed parameters, add them to the lean schema using the same trimming rules: keep field names, types, and constraints, drop prose, and only keep a short description where a field name is unclear. If upstream changed behavior, update the lean description and guidelines so they still match what the tool does.
5. Run the tests, re-measure the tokens, and update the README and MAINTENANCE.md.
6. Summarize the changes for me, and only publish after I confirm.
```

Most upstream updates only change internal logic, so upgrading the dependency is all it takes. When the wrapper does need changes, it's usually because upstream changed the tool's schema, its guidance config fields, or the strings and internals listed in MAINTENANCE.md.

## Development

```sh
npm install
npm test        # vitest — 24 tests against the real upstream package
npm run typecheck
npm run measure # prints the token table above
```

See [MAINTENANCE.md](./MAINTENANCE.md) for the upstream contract this wrapper depends on and how to upgrade.
