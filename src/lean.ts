// Lean model-facing texts and schema for the `todo` tool.
//
// The schema is derived from upstream's live TodoParamsSchema at import time:
// field names, types, enums, and constraints always match upstream exactly.
// Only per-property descriptions are trimmed, and "help" is added to the
// action enum. If upstream adds or changes a field, the lean schema follows
// automatically on the next install.

import { TodoParamsSchema } from "@juicesharp/rpiv-todo/tool/types.ts";

export const TOOL_NAME = "todo";
export const HELP_ACTION = "help";

export const LEAN_DESCRIPTION =
	"Task list for multi-step work. Status transitions are validated: pending ↔ in_progress → completed; deleted is a terminal tombstone, hidden from list unless includeDeleted is set.";

export const LEAN_SNIPPET = "Manage a task list to track multi-step progress";

export const LEAN_GUIDELINES = [
	"Use for multi-step work, when the user gives a list of tasks, or when new instructions arrive; skip for trivial or conversational requests.",
	"Mark a task in_progress before starting it and completed as soon as it is done; keep one in_progress task at a time.",
	"Keep a task in_progress while tests fail, work is partial, or errors are unresolved; add a new task for the blocker instead.",
	"update takes the task id plus only the fields to change; an update with no mutable field is rejected.",
	"blockedBy sets dependencies on create; on update use addBlockedBy / removeBlockedBy, which merge additively. Cycles are rejected.",
	"subject is a short imperative line; description holds the long-form detail.",
];

// A description is kept only where the field name alone is unclear or the
// constraint is not expressible in the schema itself.
const KEPT_DESCRIPTIONS: Record<string, string> = {
	activeForm: "present-continuous label, e.g. 'writing tests'",
	status: "also filters list",
	blockedBy: "create only",
	metadata: "null value deletes the key",
};

export function LEAN_SCHEMA(): Record<string, any> {
	const clone = JSON.parse(JSON.stringify(TodoParamsSchema));
	const props = (clone.properties ?? {}) as Record<string, any>;
	const action = props.action;
	if (action && Array.isArray(action.enum) && !action.enum.includes(HELP_ACTION)) {
		action.enum = [...action.enum, HELP_ACTION];
	}
	for (const [name, prop] of Object.entries(props)) {
		if (KEPT_DESCRIPTIONS[name] !== undefined) prop.description = KEPT_DESCRIPTIONS[name];
		else delete prop.description;
	}
	return clone;
}
