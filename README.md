# rpiv-todo-lean

**Based on [@juicesharp/rpiv-todo](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo) by juicesharp (original author, MIT License).** This package is a thin wrapper: it installs and runs upstream unmodified, and only slims down what the model reads on every request. All credit for the extension itself — the overlay, `/todos`, replay, dependencies, everything — belongs to the original author.

## Why

Upstream's `todo` tool ships rich descriptions, per-parameter documentation, and nine prompt guidelines. That context is sent on **every request**, whether or not the model touches its todo list. This wrapper keeps every feature but trims the model-facing text, and adds `action: "help"` so the model can pull the full upstream reference only when it actually needs it.

## Token cost per request

Measured with the o200k_base tokenizer (`npm run measure`), upstream `@juicesharp/rpiv-todo` 2.13.8 vs this wrapper:

| Piece | Upstream chars | Upstream tokens | Lean chars | Lean tokens |
|---|---:|---:|---:|---:|
| description | 392 | 84 | 179 | 36 |
| parameters (schema JSON) | 1498 | 346 | 806 | 195 |
| promptSnippet | 47 | 9 | 47 | 9 |
| promptGuidelines | 1645 | 364 | 689 | 145 |
| **total** | **3582** | **803** | **1721** | **385** |

**418 tokens (52.1%) and 1861 chars (52.0%) saved per request.**

## Install

```sh
pi install git:github.com/cabi/rpiv-todo-lean
```

`pi install` clones the repo, installs it, and registers it in your Pi settings. Equivalents: `pi install https://github.com/cabi/rpiv-todo-lean`, or from a local checkout `pi install ./rpiv-todo-lean`.

Do **not** load both this and upstream — you would get two `todo` tools. Everything upstream configures via the `rpiv-todo` config key (widget lines, collapse key, guidance overrides) keeps working unchanged.

## What stays identical

- Tool name (`todo`), fields, enums, and constraints — the lean schema is derived from upstream's live schema at load time, so it can never drift; only parameter descriptions are trimmed.
- Runtime behavior: `execute` delegates straight to upstream. Create/update/list/get/delete/clear, status transitions, dependencies (`blockedBy`/`addBlockedBy`/`removeBlockedBy`), cycles, metadata, owners — all upstream logic.
- Human UI: the live overlay, `/todos` command, `ctrl+shift+t` collapse, session replay across `/reload` and compaction.
- Config precedence: a `promptSnippet`/`promptGuidelines` set in the `rpiv-todo` config key overrides this wrapper's lean defaults, same as it overrides upstream's defaults.

## What differs

- **Trimmed texts**: description, guidelines, and parameter descriptions are rewritten lean; see MAINTENANCE.md for exactly what was dropped.
- **`action: "help"`** (added op): returns upstream's full description, guidelines, and every parameter with its original documentation, read live from the registered upstream definition. Touches no state.
- **Spelling fill-ins** (before validation, unambiguous only): `"Create "`, `"IN_PROGRESS"`, `"in progress"`, `"In-Progress"` etc. are normalized to the enum value when exactly one candidate matches. Unknown values (`"Done"`, `"add"`) still get Pi's normal validation error. Pi already coerces `"3"` → `3` and `"true"` → `true`; that is not duplicated.
- **Missing-action fill-in**: a call with a `subject` and no `id`/`action` is always a create and gets `action: "create"` filled in (glm-5.3 made this mistake 9 times under the upstream schema, 0 under the lean schema). With an `id` present it stays ambiguous and errors clearly instead.
- **Two ambiguous mistakes become clear errors** instead of being silently ignored by upstream:
  - `update` with `blockedBy` → error explaining `addBlockedBy`/`removeBlockedBy` (upstream ignores `blockedBy` on update).
  - `create` with `status` → error explaining tasks always start `pending` (upstream ignores `status` on create).
- **The tool list can never change mid-session**: the wrapper blocks `setActiveTools` defensively (upstream 2.13.8 never calls it).

## Keeping up with upstream

Pin the upstream version and upgrade by hand. The process is nearly always the same, so you can hand it to an agent too (this is the sync prompt from [Make your own lean version](https://github.com/kunkun9527/my-lean-pi-setup/blob/main/docs/make-your-own-lean.md), with this package's names filled in):

```text
Sync rpiv-todo-lean to the latest version of @juicesharp/rpiv-todo.

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
npm test      # 28 tests: passthrough equivalence, help, fill-ins, guards, static tool list
npm run measure
```

## License

MIT — see [LICENSE](LICENSE). The upstream license and copyright notice are preserved there, as required by upstream's MIT license.
