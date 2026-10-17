/**
 * Measure the per-request token/char cost of a tool as the model reads it.
 * Loads upstream .ts through jiti (same loader Pi uses for extensions).
 *
 * Usage: node scripts/measure.mjs [moduleWithLean]
 */
import { createJiti } from "jiti";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const jiti = createJiti(pathToFileURL(process.cwd()).href);

const upstreamTodo = await jiti.import(require.resolve("@juicesharp/rpiv-todo/todo.ts"));
const upstreamTypes = await jiti.import(require.resolve("@juicesharp/rpiv-todo/tool/types.ts"));
const UPSTREAM_DESC =
	"Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.";

function fmtRow(label, text) {
	return { label, chars: text.length, tokens: encode(text).length };
}

function print(rows, title) {
	console.log(`\n== ${title} ==`);
	for (const r of rows)
		console.log(`${r.label.padEnd(28)} ${String(r.chars).padStart(7)} chars ${String(r.tokens).padStart(6)} tokens`);
	const chars = rows.reduce((a, r) => a + r.chars, 0);
	const tokens = rows.reduce((a, r) => a + r.tokens, 0);
	console.log(`${"TOTAL".padEnd(28)} ${String(chars).padStart(7)} chars ${String(tokens).padStart(6)} tokens`);
	return { chars, tokens };
}

const upRows = [
	fmtRow("description", UPSTREAM_DESC),
	fmtRow("parameters (schema JSON)", JSON.stringify(upstreamTypes.TodoParamsSchema)),
	fmtRow("promptSnippet", upstreamTodo.DEFAULT_PROMPT_SNIPPET),
	fmtRow("promptGuidelines (joined)", upstreamTodo.DEFAULT_PROMPT_GUIDELINES.join("\n")),
];
const upTotal = print(upRows, "UPSTREAM @juicesharp/rpiv-todo 2.13.9");

const leanPath = resolve(process.argv[2] ?? "src/lean.ts");
const lean = leanPath.endsWith(".ts")
	? await jiti.import(leanPath)
	: await import(pathToFileURL(leanPath).href);
const leanRows = [
	fmtRow("description", lean.LEAN_DESCRIPTION),
	fmtRow("parameters (schema JSON)", JSON.stringify(lean.LEAN_SCHEMA())),
	fmtRow("promptSnippet", lean.LEAN_SNIPPET),
	fmtRow("promptGuidelines (joined)", lean.LEAN_GUIDELINES.join("\n")),
];
const leanTotal = print(leanRows, `LEAN ${leanPath}`);
console.log("\n== delta ==");
console.log(`chars:  ${upTotal.chars - leanTotal.chars} saved (${(((upTotal.chars - leanTotal.chars) / upTotal.chars) * 100).toFixed(1)}%)`);
console.log(`tokens: ${upTotal.tokens - leanTotal.tokens} saved (${(((upTotal.tokens - leanTotal.tokens) / upTotal.tokens) * 100).toFixed(1)}%)`);
