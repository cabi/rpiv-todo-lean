// Build the lean tool definition from the captured upstream definition.
//
// Everything except the model-facing texts, the schema, prepareArguments, and
// the execute wrapper is passed through untouched (label, renderCall,
// renderResult, annotations, …), so runtime UI and behavior stay identical.

import { LEAN_DESCRIPTION, LEAN_GUIDELINES, LEAN_SNIPPET, LEAN_SCHEMA } from "./lean.ts";
import { prepareLeanArguments } from "./fill-ins.ts";
import { helpToolResult, type UpstreamToolDef } from "./help.ts";

export interface GuidanceOverrides {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

// Mistakes whose fix would be ambiguous get a clear error instead. Upstream
// silently ignores both of these; the lean wrapper surfaces them so the model
// does not believe a change happened. Documented divergence in MAINTENANCE.md.
const GUARDS: Array<{ when: (p: Record<string, unknown>) => boolean; message: string }> = [
	{
		when: (p) => p.action === "update" && "blockedBy" in p,
		message:
			"update ignores blockedBy. Dependencies change only through addBlockedBy (adds ids) and removeBlockedBy (removes ids), which merge into the existing list. To set an exact dependency list, remove the unwanted ids with removeBlockedBy.",
	},
	{
		when: (p) => p.action === "create" && "status" in p,
		message:
			"create always creates the task as pending and ignores status. Create the task first, then call update with status.",
	},
];

export function guardAmbiguousMistakes(
	params: Record<string, unknown>,
): { content: Array<{ type: "text"; text: string }>; isError: true } | undefined {
	for (const guard of GUARDS) {
		if (guard.when(params)) {
			return { content: [{ type: "text", text: `Error: ${guard.message}` }], isError: true };
		}
	}
	return undefined;
}

export function makeLeanTool(upstream: UpstreamToolDef, guidance: GuidanceOverrides = {}) {
	return {
		...upstream,
		description: LEAN_DESCRIPTION,
		promptSnippet: guidance.promptSnippet ?? LEAN_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? LEAN_GUIDELINES,
		parameters: LEAN_SCHEMA(),
		prepareArguments: prepareLeanArguments,
		execute(toolCallId: unknown, params: any, signal: unknown, onUpdate: unknown, ctx: unknown) {
			const p = (params ?? {}) as Record<string, unknown>;
			if (p.action === "help") return Promise.resolve(helpToolResult(upstream));
			const guard = guardAmbiguousMistakes(p);
			if (guard) return Promise.resolve(guard);
			return upstream.execute(toolCallId, params, signal, onUpdate, ctx);
		},
	};
}
