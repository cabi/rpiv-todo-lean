// Tests for rpiv-todo-lean.
//
// All lean and upstream modules are loaded through jiti — the same loader Pi
// uses for extensions — so these tests exercise the real production import
// paths (bare specifiers like "@juicesharp/rpiv-todo/index.ts" with .js -> .ts
// resolution), not a vite-specific resolution.

import { describe, expect, it } from "vitest";
import { createJiti } from "jiti";
import { validateToolArguments } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url);

const leanIndex = await jiti.import<any>("../src/index.ts");
const leanToolMod = await jiti.import<any>("../src/lean-tool.ts");
const leanMod = await jiti.import<any>("../src/lean.ts");
const fillIns = await jiti.import<any>("../src/fill-ins.ts");
const proxyMod = await jiti.import<any>("../src/proxy.ts");
const upstreamIndex = await jiti.import<any>("../node_modules/@juicesharp/rpiv-todo/index.ts");
const upstreamTypes = await jiti.import<any>("../node_modules/@juicesharp/rpiv-todo/tool/types.ts");
const upstreamConfig = await jiti.import<any>("../node_modules/@juicesharp/rpiv-todo/config.ts");

const { prepareLeanArguments, matchEnum } = fillIns;
const { guardAmbiguousMistakes } = leanToolMod;

// -- helpers ------------------------------------------------------------

function mockPi() {
	const calls = {
		tools: [] as any[],
		commands: [] as any[][],
		shortcuts: [] as any[][],
		events: new Map<string, any[]>(),
		entries: [] as any[][],
	};
	const pi: any = {
		registerTool: (t: any) => calls.tools.push(t),
		registerCommand: (...a: any[]) => calls.commands.push(a),
		registerShortcut: (...a: any[]) => calls.shortcuts.push(a),
		on: (ev: string, fn: any) => {
			const list = calls.events.get(ev) ?? [];
			list.push(fn);
			calls.events.set(ev, list);
		},
		appendEntry: (...a: any[]) => calls.entries.push(a),
	};
	return { pi, calls };
}

const stubOverlay = async () => {
	throw new Error("overlay must not load in tests");
};

function upstreamToolDef(): any {
	const tools: any[] = [];
	const pi: any = {
		registerTool: (t: any) => tools.push(t),
		registerCommand: () => {},
		registerShortcut: () => {},
		on: () => {},
		appendEntry: () => {},
	};
	upstreamIndex.default(pi, stubOverlay);
	expect(tools).toHaveLength(1);
	return tools[0];
}

/** Full lean init on a mock pi; returns the registered lean tool + calls. */
function leanInit() {
	const { pi, calls } = mockPi();
	leanIndex.default(pi, stubOverlay);
	expect(calls.tools).toHaveLength(1);
	return { leanTool: calls.tools[0], calls, pi };
}

const ctxFor = (sid: string) => ({ sessionManager: { getSessionId: () => sid } });
const run = (tool: any, sid: string, params: any) =>
	tool.execute("tc-1", params, undefined, undefined, ctxFor(sid));

// -- registration --------------------------------------------------------

describe("registration", () => {
	it("registers exactly one tool named todo, with lean model-facing texts", () => {
		const { leanTool, calls } = leanInit();
		expect(calls.tools.map((t: any) => t.name)).toEqual(["todo"]);
		expect(leanTool.description).toBe(leanMod.LEAN_DESCRIPTION);
		expect(leanTool.promptSnippet).toBe(leanMod.LEAN_SNIPPET);
		expect(leanTool.promptGuidelines).toEqual(leanMod.LEAN_GUIDELINES);
	});

	it("keeps every non-model-facing part of the upstream definition", () => {
		const upstream = upstreamToolDef();
		const { leanTool } = leanInit();
		for (const key of Object.keys(upstream)) {
			if (["description", "promptSnippet", "promptGuidelines", "parameters", "execute"].includes(key))
				continue;
			const isFn = typeof upstream[key] === "function";
		expect(isFn ? String(leanTool[key]) : leanTool[key]).toEqual(
			isFn ? String(upstream[key]) : upstream[key],
		);
		}
		expect(typeof leanTool.execute).toBe("function");
		// renderCall/renderResult are per-registration closures; identical source proves pass-through
		expect(String(leanTool.renderCall)).toBe(String(upstream.renderCall));
		expect(String(leanTool.renderResult)).toBe(String(upstream.renderResult));
	});

	it("config guidance overrides win over the lean defaults (upstream precedence)", () => {
		const guidance = upstreamConfig.validateGuidanceFields(
			upstreamConfig.loadConfig().guidance,
		);
		const { leanTool } = leanInit();
		expect(leanTool.promptSnippet).toBe(guidance.promptSnippet ?? leanMod.LEAN_SNIPPET);
		expect(leanTool.promptGuidelines).toEqual(guidance.promptGuidelines ?? leanMod.LEAN_GUIDELINES);
	});

	it("registers all upstream non-tool features (command, shortcut, events)", () => {
		const { calls } = leanInit();
		expect(calls.commands.map((a: any[]) => a[0])).toContain("todos");
		expect(calls.shortcuts.length).toBeGreaterThan(0);
		for (const ev of ["session_start", "session_compact", "session_tree", "session_shutdown"])
			expect(calls.events.get(ev)?.length).toBeGreaterThan(0);
	});
});

// -- schema --------------------------------------------------------------

describe("lean schema", () => {
	it("keeps every upstream field with identical types, enums, and constraints", () => {
		const lean = leanMod.LEAN_SCHEMA();
		const upstream = JSON.parse(JSON.stringify(upstreamTypes.TodoParamsSchema));
		expect(Object.keys(lean.properties)).toEqual(Object.keys(upstream.properties));
		expect(lean.required).toEqual(upstream.required); // ["action"]
		for (const [name, prop] of Object.entries<any>(upstream.properties)) {
			const leanProp = lean.properties[name];
			expect(leanProp.type).toBe(prop.type);
			if (prop.enum) {
				const expected =
					name === "action" ? [...prop.enum, "help"] : prop.enum;
				expect(leanProp.enum).toEqual(expected);
			}
			if (prop.items) expect(leanProp.items).toEqual(prop.items);
		}
	});

	it("keeps descriptions only for the four unclear fields", () => {
		const lean = leanMod.LEAN_SCHEMA();
		const withDesc = Object.entries<any>(lean.properties)
			.filter(([, p]) => p.description !== undefined)
			.map(([n]) => n)
			.sort();
		expect(withDesc).toEqual(["activeForm", "blockedBy", "metadata", "status"]);
	});
});

// -- passthrough: every action reaches upstream ---------------------------

describe("every action reaches upstream", () => {
	const OPS: Array<Record<string, unknown>> = [
		{ action: "create", subject: "Research topic", description: "Find sources" },
		{ action: "create", subject: "Write summary", blockedBy: [1] },
		{ action: "update", id: 1, status: "in_progress", activeForm: "researching" },
		{ action: "list" },
		{ action: "list", status: "pending" },
		{ action: "get", id: 2 },
		{ action: "update", id: 2, addBlockedBy: [99] }, // upstream in-band error: missing task
		{ action: "update", id: 1, status: "completed" },
		{ action: "update", id: 1, status: "pending" }, // upstream in-band error: completed -> pending
		{ action: "delete", id: 1 },
		{ action: "clear" },
	];

	it("produces byte-identical results to calling upstream execute directly", async () => {
		const upstream = upstreamToolDef();
		const { leanTool } = leanInit();
		for (let i = 0; i < OPS.length; i++) {
			const leanRes = await run(leanTool, "lean-eq", { ...OPS[i] });
			const upRes = await run(upstream, "up-eq", { ...OPS[i] });
			expect(leanRes.content).toEqual(upRes.content);
			expect(leanRes.details).toEqual(upRes.details);
		}
	});

	it("persists state entries exactly like upstream (replay parity)", async () => {
		const upstreamPi = mockPi();
		const upstream = (() => {
			const tools: any[] = [];
			upstreamPi.pi.registerTool = (t: any) => tools.push(t);
			upstreamIndex.default(upstreamPi.pi, stubOverlay);
			return tools[0];
		})();
		const { leanTool, calls } = leanInit();
		for (const op of OPS) {
			await run(leanTool, "lean-entry", { ...op });
			await run(upstream, "up-entry", { ...op });
		}
		expect(calls.entries).toEqual(upstreamPi.calls.entries);
	});
});

// -- help ----------------------------------------------------------------

describe("help op", () => {
	it("returns the full upstream description, guidelines, and every parameter", async () => {
		const upstream = upstreamToolDef();
		const { leanTool } = leanInit();
		const res = await run(leanTool, "lean-help", { action: "help" });
		const text = res.content[0].text;
		expect(text).toContain(upstream.description);
		for (const g of upstream.promptGuidelines) expect(text).toContain(g);
		for (const name of Object.keys(upstream.parameters.properties)) {
			expect(text).toContain(`- ${name} (`);
		}
		expect(text).toContain("pending | in_progress | completed | deleted");
		expect(text).toContain("create | update | list | get | delete | clear");
		expect(text).toContain("- action (");
		expect(text).toContain("required");
		// per-parameter descriptions from upstream, not the lean ones
		expect(text).toContain(String(upstream.parameters.properties.status.description));
	});

	it("changes no state and persists no entries", async () => {
		const { leanTool, calls } = leanInit();
		await run(leanTool, "lean-help2", { action: "create", subject: "A" });
		const entriesBefore = calls.entries.length;
		const listBefore = await run(leanTool, "lean-help2", { action: "list" });
		await run(leanTool, "lean-help2", { action: "help" });
		const listAfter = await run(leanTool, "lean-help2", { action: "list" });
		expect(listAfter).toEqual(listBefore);
		expect(calls.entries.length).toBe(entriesBefore);
	});
});

// -- fill-ins ------------------------------------------------------------

describe("prepareArguments fill-ins", () => {
	it("normalizes case, whitespace, hyphens, and underscores to the enum value", () => {
		expect(matchEnum("Create ", ["create", "update"])).toBe("create");
		expect(matchEnum("IN_PROGRESS", ["in_progress", "completed"])).toBe("in_progress");
		expect(matchEnum("in progress", ["in_progress", "completed"])).toBe("in_progress");
		expect(matchEnum("In-Progress", ["in_progress", "completed"])).toBe("in_progress");
	});

	it("leaves unknown, ambiguous, and non-string values untouched", () => {
		expect(matchEnum("Done", ["pending", "in_progress", "completed", "deleted"])).toBeUndefined();
		expect(matchEnum("", ["create"])).toBeUndefined();
		expect(matchEnum(42, ["create"])).toBeUndefined();
		expect(matchEnum("create", [])).toBeUndefined();
	});

	it("fixes action and status in place, preserving everything else", () => {
		const args = { action: "Create ", id: 3, status: "in progress", subject: "x" };
		expect(prepareLeanArguments(args)).toEqual({
			action: "create",
			id: 3,
			status: "in_progress",
			subject: "x",
		});
	});

	it("does not misfire on valid args (value-equal, no invented keys)", () => {
		const valid = {
			action: "update",
			id: 2,
			status: "completed",
			addBlockedBy: [1],
			metadata: { a: 1 },
			includeDeleted: true,
		};
		expect(prepareLeanArguments(valid)).toEqual(valid);
		const untouched = prepareLeanArguments(valid);
		expect(Object.keys(untouched).sort()).toEqual(Object.keys(valid).sort());
	});

	it("passes non-objects through unchanged", () => {
		for (const v of [null, undefined, 42, "create", [], true]) {
			expect(prepareLeanArguments(v)).toBe(v);
		}
	});

	it("composes with Pi's real validator: fixed args pass, unknown enums fail clearly", () => {
		const { leanTool } = leanInit();
		const tool = { name: leanTool.name, parameters: leanTool.parameters };
		const fixed = prepareLeanArguments({ action: "update", id: "1", status: "in progress" });
		const validated = validateToolArguments(tool, { name: "todo", arguments: fixed });
		expect(validated).toEqual({ action: "update", id: 1, status: "in_progress" }); // Pi coerces "1" -> 1
		expect(() =>
			validateToolArguments(tool, { name: "todo", arguments: prepareLeanArguments({ action: "add" }) }),
		).toThrow(/Validation failed for tool "todo"/);
	});

	it("fills action=create when a create call omits action (glm-5.3 observed shape)", () => {
		// Shape seen 4x under the upstream schema: subject/description/activeForm, no id, no action.
		const filled = prepareLeanArguments({
			subject: "Map CI pipeline config",
			description: "Read the workflow files",
			activeForm: "Mapping CI pipeline config",
		});
		expect(filled).toEqual({
			action: "create",
			subject: "Map CI pipeline config",
			description: "Read the workflow files",
			activeForm: "Mapping CI pipeline config",
		});
	});

	it("treats null action/id as absent; Pi deletes null optionals after prepareArguments", () => {
		expect(prepareLeanArguments({ action: null, subject: "A", id: null })).toEqual({
			action: "create",
			subject: "A",
			id: null, // deleted by Pi's normalizeOptionalNulls before execute
		});
	});

	it("does not guess when ambiguous: id + subject without action stays for Pi's validator", () => {
		// Shape seen 5x under the upstream schema, but update also takes id + subject;
		// guessing create could silently duplicate a task, so it must error instead.
		const out = prepareLeanArguments({ subject: "Rename task", id: 2, description: "d" });
		expect((out as Record<string, unknown>).action).toBeUndefined();
	});

	it("does not fill without a usable subject or with a garbage action string", () => {
		expect(prepareLeanArguments({ description: "d" })).toEqual({ description: "d" });
		expect(prepareLeanArguments({ subject: "   " })).toEqual({ subject: "   " });
		expect(prepareLeanArguments({ action: "add", subject: "A" })).toEqual({ action: "add", subject: "A" });
	});

	it("composes with Pi's real validator: subject-only create passes, ambiguous id+subject fails clearly", () => {
		const { leanTool } = leanInit();
		const tool = { name: leanTool.name, parameters: leanTool.parameters };
		const validated = validateToolArguments(tool, {
			name: "todo",
			arguments: prepareLeanArguments({ subject: "Ship it", description: "d" }),
		});
		expect(validated).toEqual({ action: "create", subject: "Ship it", description: "d" });
		expect(() =>
			validateToolArguments(tool, {
				name: "todo",
				arguments: prepareLeanArguments({ subject: "Rename task", id: 2 }),
			}),
		).toThrow(/Validation failed for tool "todo"/);
	});
});

// -- ambiguous-mistake guards ---------------------------------------------

describe("ambiguous-mistake guards", () => {
	it("update with blockedBy: clear error, upstream not called, state unchanged", async () => {
		const { leanTool, calls } = leanInit();
		await run(leanTool, "g1", { action: "create", subject: "A" });
		const entriesBefore = calls.entries.length;
		const listBefore = await run(leanTool, "g1", { action: "list" });
		const res = await run(leanTool, "g1", { action: "update", id: 1, blockedBy: [2] });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("addBlockedBy");
		const listAfter = await run(leanTool, "g1", { action: "list" });
		expect(listAfter).toEqual(listBefore);
		expect(calls.entries.length).toBe(entriesBefore); // upstream execute never ran
	});

	it("create with status: clear error, no task created", async () => {
		const { leanTool } = leanInit();
		const res = await run(leanTool, "g2", { action: "create", subject: "A", status: "completed" });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("pending");
		const list = await run(leanTool, "g2", { action: "list" });
		expect(list.content[0].text).toBe("No tasks");
	});

	it("fires on presence only after Pi deleted null optionals (unit level)", () => {
		expect(guardAmbiguousMistakes({ action: "update", id: 1, blockedBy: [2] })).toBeDefined();
		expect(guardAmbiguousMistakes({ action: "update", id: 1 })).toBeUndefined();
		expect(guardAmbiguousMistakes({ action: "create", subject: "x", status: "pending" })).toBeDefined();
		expect(guardAmbiguousMistakes({ action: "create", subject: "x" })).toBeUndefined();
		expect(guardAmbiguousMistakes({ action: "list" })).toBeUndefined();
	});
});

// -- static tool list ------------------------------------------------------

describe("tool list cannot change mid-session", () => {
	it("blocks setActiveTools on the proxy", () => {
		const { pi } = mockPi();
		const proxy = proxyMod.wrapPiForLean(pi, () => {});
		expect(() => proxy.setActiveTools(["todo"])).toThrow(/setActiveTools/);
		expect(() => proxy.setActiveTools([])).toThrow(/rpiv-todo-lean/);
	});

	it("upstream 2.13.8 registers nothing but the todo tool, before or after calls", async () => {
		const { leanTool, calls } = leanInit();
		expect(calls.tools.map((t: any) => t.name)).toEqual(["todo"]);
		await run(leanTool, "s1", { action: "create", subject: "A" });
		await run(leanTool, "s1", { action: "list" });
		await run(leanTool, "s1", { action: "help" });
		expect(calls.tools.map((t: any) => t.name)).toEqual(["todo"]);
	});

	it("proxy passes registerTool through the capture callback", () => {
		const { pi, calls } = mockPi();
		const captured: any[] = [];
		const proxy = proxyMod.wrapPiForLean(pi, (t: any) => captured.push(t));
		const fake = { name: "todo", execute: () => {} };
		proxy.registerTool(fake);
		expect(captured).toEqual([fake]);
		expect(calls.tools).toEqual([]); // lean registration is the callback's job
	});

	it("proxy forwards other API calls to the real pi", () => {
		const { pi, calls } = mockPi();
		const proxy: any = proxyMod.wrapPiForLean(pi, () => {});
		const fn = () => {};
		proxy.on("session_start", fn);
		proxy.appendEntry("rpiv-todo-state", { any: 1 });
		expect(calls.events.get("session_start")).toEqual([fn]);
		expect(calls.entries).toEqual([["rpiv-todo-state", { any: 1 }]]);
	});
});


