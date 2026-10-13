// Proxy around the `pi` extension API object handed to upstream.
//
// - registerTool is intercepted: the upstream definition is captured (it is
//   the source for the help op) and replaced by the lean definition.
// - setActiveTools is blocked: the model-visible tool list must stay fixed
//   for the whole session. Upstream 2.13.8 never calls it; this guard makes
//   the guarantee hold even if a future upstream tries.
// - Everything else (on, registerCommand, registerShortcut, appendEntry, …)
//   passes through to the real pi object, so all upstream features (overlay,
//   /todos, replay, shortcuts) behave identically.

import type { UpstreamToolDef } from "./help.ts";

export function wrapPiForLean(
	pi: Record<string, any>,
	onUpstreamTool: (tool: UpstreamToolDef) => void,
): Record<string, any> {
	return new Proxy(pi, {
		get(target, prop, _receiver) {
			if (prop === "setActiveTools") {
				return () => {
					throw new Error(
						"rpiv-todo-lean blocked setActiveTools: the model-visible tool list must stay fixed for the whole session. Upstream @juicesharp/rpiv-todo does not call this; if you see this error, an upstream version changed its registration strategy — see MAINTENANCE.md.",
					);
				};
			}
			if (prop === "registerTool") {
				return (tool: UpstreamToolDef) => {
					onUpstreamTool(tool);
				};
			}
			const value = Reflect.get(target, prop, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
