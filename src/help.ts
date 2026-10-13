// help op: returns the full upstream reference for the `todo` tool.
//
// The text is built from the captured upstream tool definition (description,
// promptSnippet, promptGuidelines, parameters as registered), never from a
// copy, so it stays accurate across upstream upgrades.

export interface UpstreamToolDef {
	name: string;
	description: string;
	promptSnippet?: unknown;
	promptGuidelines?: unknown;
	parameters?: unknown;
	execute: (toolCallId: unknown, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => unknown;
	[key: string]: unknown;
}

export function buildHelpText(upstream: UpstreamToolDef): string {
	const lines: string[] = [];
	lines.push(`# ${upstream.name} — full reference (from @juicesharp/rpiv-todo)`);
	lines.push("");
	lines.push(String(upstream.description ?? ""));

	const snippet = upstream.promptSnippet;
	if (typeof snippet === "string" && snippet.length > 0) {
		lines.push("", `System-prompt snippet: ${snippet}`);
	}

	const guidelines = Array.isArray(upstream.promptGuidelines)
		? (upstream.promptGuidelines as unknown[])
		: typeof upstream.promptGuidelines === "string"
			? [upstream.promptGuidelines]
			: [];
	if (guidelines.length > 0) {
		lines.push("", "Guidelines:");
		for (const g of guidelines) lines.push(`- ${String(g)}`);
	}

	lines.push("", "Parameters:");
	const schema = upstream.parameters as
		| { properties?: Record<string, any>; required?: string[] }
		| undefined;
	const props = schema?.properties ?? {};
	const required = new Set(schema?.required ?? []);
	for (const [name, prop] of Object.entries(props)) {
		const bits: string[] = [];
		if (Array.isArray(prop?.enum)) bits.push(prop.enum.join(" | "));
		else if (prop?.type === "array") bits.push(`array of ${prop?.items?.type ?? "any"}`);
		else if (prop?.type) bits.push(String(prop.type));
		bits.push(required.has(name) ? "required" : "optional");
		const head = `- ${name} (${bits.join(", ")})`;
		lines.push(typeof prop?.description === "string" ? `${head}: ${prop.description}` : head);
	}

	lines.push(
		"",
		'"help" is added by rpiv-todo-lean; every other action behaves exactly as documented above.',
	);
	return lines.join("\n");
}

export function helpToolResult(upstream: UpstreamToolDef): { content: Array<{ type: "text"; text: string }> } {
	return { content: [{ type: "text", text: buildHelpText(upstream) }] };
}
