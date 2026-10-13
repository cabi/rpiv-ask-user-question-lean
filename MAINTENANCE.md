# Maintenance notes

This package is a thin wrapper. Everything that could break on an upstream
release is listed here, with the checks that catch it.

## Matching upstream version

- `@juicesharp/rpiv-ask-user-question`: **2.13.8** (pinned, exact)
- `@juicesharp/rpiv-config`: **2.13.8** (pinned, exact; used only to re-read
  the user's `guidance` overrides the same way upstream does)
- Re-measure and re-review after any upstream bump; the trim tables below
  describe 2.13.8 texts.

## What was trimmed, per tool

Upstream registers exactly one tool, so nothing was merged and no `op`
parameter or `help` op was added (that would add tokens, not remove them).

### `ask_user_question`

| Upstream surface | Chars | What happened |
|---|---:|---|
| `description` (1641 chars) | 1641 → 102 | Replaced with one sentence: what the tool does. Dropped: UI walkthrough (tabs, collapse key `ctrl+]`, overlay vs inline), the "Type something." mechanics (kept as one guideline), counting rules the schema expresses, usage advice ("save it for when it truly matters"), formatting prescriptions, workflow philosophy. |
| `promptSnippet` (92 chars) | 92 → 105 | Replaced; slightly longer in chars, fewer tokens. |
| `promptGuidelines` (4 bullets, 1214 chars) | 1214 → 509 | Kept every call-affecting rule, once each: one invocation per turn; label + description with trade-offs; recommended option first with `(Recommended)`; automatic `"Type something."` row and reserved labels; preview usage and when to skip. Dropped: restated limits (4 questions, 2–4 options, 16-char header, 60-char label), JSON-shape duplication, UI notes. |
| `parameters` (2033 chars JSON) | 2033 → 883 | All `description` keys stripped recursively; types, `required`, `minItems`/`maxItems`, `maxLength`, and `default: false` kept verbatim. Two short descriptions re-injected where the field name is unclear: `header`, `preview`. |

The lean texts are derived, not hardcoded, where possible: the schema is
computed from upstream's registered schema at runtime, so upstream schema
changes flow through (only the two re-injected descriptions and the text
constants are ours).

## Upstream internals this wrapper depends on

1. **Tool name `ask_user_question`** — asserted in tests. If upstream renames
   the tool, the reconciler-freeze test and README need updating.
2. **Registration shape** — upstream's default export is the register
   function (`export default function (pi) {...}`); it calls
   `pi.registerTool(tool)` once and `pi.on("before_agent_start", ...)`.
   The wrapper only assumes registerTool; `on` passes through untouched.
3. **Exports map** — the package exports only `.` and `./events`. The
   runtime wrapper must go through the public entry (Proxy capture), never a
   deep import; tests load upstream the same way. A dist/ build with the
   same exports map changes nothing.
4. **`prepareArguments` chaining order** — upstream decodes double-encoded
   JSON (`questions`/`options` sent as strings); our fill-ins run after
   that, before Pi's schema validation. If upstream drops or renames
   `prepareArguments`, the chain degrades gracefully (fill-ins still run).
5. **Reserved labels checked before duplicate labels** —
   `RESERVED_LABELS = ["Other", "Type something."]` are rejected by
   upstream's `validateQuestionnaire`. We deliberately do not fix these.
6. **`!ctx.hasUI` backstop inside execute** — returns an error envelope
   ("UI not available (running in non-interactive mode)") instead of
   throwing. This is what makes shadowing `setActiveTools` (blocking the
   reconciler) safe.
7. **Reconciler** — `reconcile.ts` subscribes `before_agent_start` and
   calls `pi.setActiveTools` with tool-name strings; it reads
   `pi.getActiveTools()`. The proxy shadows both so the call lands in a
   recorded shadow list; the real pi never sees it.
8. **Guidance config** — `guidance.{description,promptSnippet,promptGuidelines}`
   in `rpiv-ask-user-question/config.json`, validated per-field by
   `@juicesharp/rpiv-config`'s `loadJsonConfigWithLegacyFallback` +
   `validateGuidanceFields`. User-set fields pass through verbatim.
9. **Response envelope strings** — tests assert on
   `"User has answered your questions:"` and `"User declined to answer
   questions"` and `details.error === "reserved_label"`; these are pinned by
   upstream's own tests and safe to rely on, but update the assertions if
   upstream rewords them.
10. **Execute signature** — `(toolCallId, params, signal, onUpdate, ctx)`,
    standard pi ToolDefinition; forwarded untouched.
11. **Peer deps** — `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`,
    `typebox` (required), `@juicesharp/rpiv-i18n` (optional, soft). We mirror
    them as our own peers.

## How to upgrade

1. `npm install @juicesharp/rpiv-ask-user-question@NEW @juicesharp/rpiv-config@NEW`
   (keep both at the same version; keep them exact-pinned).
2. `npm test` — the suite runs the real upstream package. Failures here name
   exactly which assumption above changed:
   - new/renamed tools → capture test fails; extend the lean texts (merge
     rare tools behind an `op` parameter with `op: help` if upstream grows
     several tools),
   - schema changes → constraint-preservation tests fail,
   - reconciler changes → the frozen-tool-list tests fail,
   - envelope rewording → the calls-reach-upstream tests fail.
3. `npm run typecheck`, `npm run measure`, and refresh the token table in
   README.md from the output.
4. Re-read the new upstream description/guidelines and check the trim table
   above against them: any newly added call-affecting rule must be carried
   into the lean texts; anything we trimmed that upstream restored should be
   re-trimmed consciously.
5. Skim `node_modules/@juicesharp/rpiv-ask-user-question/` for new
   registration-time behavior (loaders, more `pi.on` subscriptions, active
   tool mutation). The proxy passes everything except `registerTool`,
   `setActiveTools`, and (post-shadow) `getActiveTools` through unchanged —
   new mutation channels need new shadow rules.

## Test map

`test/lean.test.ts` (24 tests, all against the real upstream package):

- capture goes through the proxy, never the real pi
- lean definition reuses upstream execute; texts and schema replaced
- every constraint survives the schema transform; no descriptions except the
  two re-injected ones
- lean texts avoid MUST/NEVER/all-caps phrasing
- calls reach upstream (RPC dialog path, double-encoded args + fill-ins,
  no-UI backstop, reserved-label validation)
- fill-ins: each repair fires on its exact mistaken shape, never on
  well-formed args (same reference), never invents a missing header
- frozen tool list: proxied setActiveTools recorded but not applied;
  upstream's real reconciler cannot strip the tool mid-session
- guidance overrides pass through; unset fields lean
- lean schema accepts/rejects exactly what upstream's does
