// rpiv-todo-lean — token-lean wrapper around @juicesharp/rpiv-todo.
//
// Initializes the real upstream extension (overlay, /todos command, replay,
// shortcuts — everything) against a proxied pi object. The one model-facing
// tool it registers (`todo`) is swapped for a lean definition: same name,
// same execute (delegates straight to upstream), same schema fields and
// constraints — only the description, snippet, guidelines, and per-parameter
// descriptions shrink, plus an added `action: "help"` op that returns the
// full upstream reference on demand.

import upstreamExtension from "@juicesharp/rpiv-todo/index.ts";
import { loadConfig, validateGuidanceFields } from "@juicesharp/rpiv-todo/config.ts";
import { makeLeanTool } from "./lean-tool.ts";
import { wrapPiForLean } from "./proxy.ts";
import { TOOL_NAME } from "./lean.ts";
import type { UpstreamToolDef } from "./help.ts";

export default function leanTodoExtension(pi: Record<string, any>, importOverlay?: unknown): void {
	const proxy = wrapPiForLean(pi, (tool) => {
		if (tool && typeof tool === "object" && tool.name === TOOL_NAME) {
			// Config guidance overrides win over the lean defaults, matching
			// upstream's own precedence (upstream default <- rpiv-todo config).
			const guidance = validateGuidanceFields(loadConfig().guidance);
			pi.registerTool(makeLeanTool(tool as UpstreamToolDef, guidance));
		} else {
			// A tool from a future upstream version we do not know about:
			// register it untouched rather than guessing how to trim it.
			pi.registerTool(tool);
		}
	});
	upstreamExtension(proxy as any, importOverlay);
}
