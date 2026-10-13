# Maintenance notes

Everything a maintainer needs to keep this wrapper honest against upstream.

## Matching upstream version

`@juicesharp/rpiv-todo` pinned **exactly** to `2.13.8` in `package.json` (`dependencies`, no range). The wrapper never imports anything not listed here; if upstream renames any of these, tests fail loudly (see "Upgrade checklist").

## What was trimmed, per model-facing piece

Upstream registers one model-facing tool: `todo`. Its four model-read surfaces:

| Piece | Upstream (chars / o200k tokens) | Lean | What was dropped |
|---|---|---|---|
| description | 392 / 84 | 179 / 36 | The action enumeration (the `action` enum already lists them, names self-explanatory) and the "use this for multi-step work" sentence (the prompt snippet covers it). Kept: the two call-affecting facts the schema cannot express — transitions are validated, `deleted` is terminal and hidden from `list` without `includeDeleted`. |
| parameters | 1498 / 346 | 806 / 195 | All per-property descriptions except four: `activeForm` ("present-continuous label, e.g. 'writing tests'"), `status` ("also filters list" — dual use), `blockedBy` ("create only" — upstream ignores it on update), `metadata` ("null value deletes the key"). Field names, types, enums, array item types, and `required` are byte-identical to upstream (derived at load time), plus `"help"` added to the `action` enum. |
| promptSnippet | 47 / 9 | 47 / 9 | Unchanged — already minimal. |
| promptGuidelines | 9 bullets, 1645 / 364 | 6 bullets, 689 / 145 | Dropped: the four-state-machine recap (lives in description + schema enum), the JSON call example (the schema shows the shape), the list-filtering recap (description + `status` field description). Rewritten: no MUST/NEVER, no all-caps, no "3+ steps" threshold. Kept every rule that changes how the model calls the tool: when to use, in_progress-before/completed-immediately/one-at-a-time, keep-in_progress-while-tests-fail, update = id + changed fields only, blockedBy-create vs addBlockedBy/removeBlockedBy-update merge semantics + cycle rejection, subject/activeForm style. |

Total: 3582→1721 chars, 803→385 tokens (52%).

Re-run `npm run measure` after any text change; the README table must be updated to match.

## Upstream internals this wrapper depends on

**Direct imports** (any rename breaks at load — tests fail immediately):
- `@juicesharp/rpiv-todo/index.ts` — default export `(pi, importOverlay?)`: initializes the whole extension. The wrapper calls it once with a proxied `pi`.
- `@juicesharp/rpiv-todo/config.ts` — `loadConfig()` and `validateGuidanceFields()` re-export: used to reproduce upstream's guidance precedence (config > lean defaults). `validateGuidanceFields(undefined)` returns `{}`, so the call is null-safe.
- `@juicesharp/rpiv-todo/tool/types.ts` — `TodoParamsSchema`: source of the lean schema (JSON round-trip clone; optionality comes from `required: ["action"]`, properties are plain JSON `{type, enum?, items?}`, no TypeBox symbols needed at validation time).

**Registration shape** (breaks the capture silently if changed — covered by tests):
- Upstream registers exactly one tool via `pi.registerTool(toolObject)`, `tool.name === "todo"`. The proxy captures that object; it is the source for the `help` op. Unknown tool names from a future upstream are registered **untouched** (safe fallback; no trimming is attempted).
- The tool object's `execute` has signature `(toolCallId, params, signal, onUpdate, ctx)`; `ctx.sessionManager.getSessionId()` is the session key (upstream `state/store.ts sid()`).
- Upstream `execute` itself calls `pi.appendEntry("rpiv-todo-state", details)` for state changes — through the proxy this reaches the real `pi` (passthrough), so replay keeps working.

**Reducer semantics the guards encode** (`state/state-reducer.ts`):
- `update` **silently ignores** `blockedBy`; the wrapper returns an error instead. `create` **silently ignores** `status`; the wrapper returns an error instead. Both are intentional, documented divergences (README "What differs"). If upstream ever starts honoring these fields, delete the corresponding entry from `GUARDS` in `src/lean-tool.ts` (tests will remind you: the "ambiguous-mistake guards" suite asserts the error, and the passthrough-equivalence suite would show upstream honoring the field).

**Pi runtime seams** (not upstream, but the contract the wrapper relies on):
- `ToolDefinition.prepareArguments(args)` runs **before** schema validation (pi-agent-core `prepareToolCallArguments`). That is where the fill-ins live (`src/fill-ins.ts`):
  - enum spelling: replace only when exactly one enum candidate matches after normalizing case/whitespace/`[\s_-]`;
  - missing `action`: when `action` is absent/null, `id` is absent/null, and a non-empty `subject` is present, fill `action: "create"` (update/get/delete all require `id`, so this can only be a create; glm-5.3 omitted `action` on creates 9× in 13 upstream-schema sessions, 0× with the lean schema). With `id` + `subject` and no `action` the call is ambiguous (`update` also takes `id` + `subject`; guessing create could silently duplicate a task), so it is deliberately left for Pi's `must have required properties action` error.
- `validateToolArguments` (pi-ai) clones args, deletes `null` optionals (`normalizeOptionalNulls`), coerces primitive strings (`"3"`→3, `"true"`→true) via `Value.Convert`, then `Compile(schema).Check()`. Consequences: the guards can never misfire on `blockedBy: null` (deleted first), numeric coercion must not be duplicated in fill-ins, and unknown enum values still produce Pi's standard `Validation failed for tool "todo"` error.
- Enum spellings are **not** normalized by Pi — that is why fill-ins exist at all.
- `setActiveTools` is blocked on the proxy so the model-visible tool list is fixed for the whole session. Upstream 2.13.8 never calls it; upstream has no loader tool.

**Result-envelope assumptions**:
- Upstream results are `{ content: [{type:"text", text}], details }`. The wrapper's `help` and guard results use the same content shape but omit `details`: upstream's `renderTodoResult` falls back to a plain `✓` glyph when `details` is absent, and `renderCall` renders unknown actions (`help`) as the action word — both verified safe.
- Guard results set `isError: true` (supported by Pi's `AgentToolResult`); upstream's own in-band errors do not set it. Fine: guards are this wrapper's pre-execution layer.

## Upgrade checklist

1. `npm install @juicesharp/rpiv-todo@<new> --save-exact` (keep the exact pin).
2. Read upstream's changelog/diff for: new tools (the proxy passes unknown tools through untouched — decide whether to trim them), `setActiveTools` or loader-tool usage (the proxy blocks `setActiveTools`; a loader tool would need a decision), `execute` signature changes, schema changes.
3. `npm test`. The suite covers: lean-schema field/enum/constraint equivalence against the live upstream schema, byte-identical results and replay entries vs direct upstream `execute` for every action (including in-band error paths), help returning upstream's full texts, fill-in behavior composed with Pi's real validator, guard behavior, and the static tool list. Schema or registration drift fails here, not in production.
4. `npm run measure` and update the README table (and the totals in this file).
5. Re-read the trimmed pieces: new upstream guideline bullets or parameter descriptions must be re-triaged — add back anything that changes how the model calls the tool, keep restating nothing the schema already expresses.
6. Bump the "Matching upstream version" section above.

## Test map

`tests/lean.test.ts` — all modules loaded through jiti, the same loader Pi uses, so the bare `.ts` subpath imports (`@juicesharp/rpiv-todo/index.ts` with internal `.js`→`.ts` resolution) are exercised for real:

- `registration` — lean texts swapped, everything else identical (per-key comparison incl. render functions), config precedence, all human-UI features registered.
- `lean schema` — every field/type/enum/items/required identical to live upstream (+`help`), descriptions kept only for the four unclear fields.
- `every action reaches upstream` — byte-identical `content`/`details` and identical `appendEntry` replay stream vs calling upstream `execute` directly, across happy paths and in-band errors.
- `help op` — full upstream description/guidelines/parameters present, no state change, no entries.
- `prepareArguments fill-ins` — normalization cases, non-misfire on valid args, non-object passthrough, composition with the real `validateToolArguments` (fixes pass, `"add"` still fails with Pi's enum error).
- `ambiguous-mistake guards` — both mistakes error clearly with state untouched; unit-level presence checks.
- `tool list cannot change mid-session` — `setActiveTools` throws on the proxy, upstream registers only `todo` before/after calls, passthrough of other API calls.
