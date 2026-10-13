// Pre-validation argument fill-ins.
//
// Pi runs ToolDefinition.prepareArguments on the raw parsed arguments before
// schema validation (pi-agent-core agent-loop.js prepareToolCallArguments).
// This is the sanctioned seam for fixing call mistakes the model makes often,
// while Pi's validator still produces its normal enum error for anything we
// do not recognize.
//
// Only unambiguous corrections are applied: a string is replaced when exactly
// one enum candidate matches after normalizing case, whitespace, and
// hyphens/underscores. Pi's own validator already coerces numeric and boolean
// strings ("3" -> 3, "true" -> true) recursively, so that is not duplicated.

export const LEAN_ACTIONS = [
	"create",
	"update",
	"list",
	"get",
	"delete",
	"clear",
	"help",
] as const;

export const LEAN_STATUSES = ["pending", "in_progress", "completed", "deleted"] as const;

export function matchEnum<T extends string>(value: unknown, candidates: readonly T[]): T | undefined {
	if (typeof value !== "string") return undefined;
	const key = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
	if (!key) return undefined;
	const hits = candidates.filter((c) => c.replace(/_/g, "") === key);
	return hits.length === 1 ? hits[0] : undefined;
}

export function prepareLeanArguments(args: unknown): unknown {
	if (args === null || typeof args !== "object" || Array.isArray(args)) return args;
	const next: Record<string, unknown> = { ...(args as Record<string, unknown>) };
	const action = matchEnum(next.action, LEAN_ACTIONS);
	if (action !== undefined) {
		next.action = action;
	} else if (
		next.action == null && // absent (or null, which Pi deletes post-prepare)
		next.id == null && // update/get/delete all require id; create never takes one
		typeof next.subject === "string" &&
		next.subject.trim() !== ""
	) {
		// glm-5.3 sometimes omits action on create calls (observed 9 times in 13
		// upstream-schema sessions; 0 times with the lean schema). With a subject
		// and no id the call can only be a create. When an id IS present the call
		// is ambiguous (update also takes id + subject), so it is left for Pi's
		// validator to reject with its missing-action error.
		next.action = "create";
	}
	const status = matchEnum(next.status, LEAN_STATUSES);
	if (status !== undefined) next.status = status;
	return next;
}
