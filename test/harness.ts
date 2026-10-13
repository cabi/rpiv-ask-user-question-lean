/**
 * Test harness: a minimal pi-like environment plus a local JSON-schema
 * subset validator, so upstream's real registration, preparation, and
 * execute paths run without a live pi instance.
 *
 * Upstream's package exports map blocks deep imports under Node, so the
 * real-tool fixtures load upstream through its public entry and a Proxy —
 * the same capture mechanism src/wrapper.ts uses at runtime.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import upstreamPkg from "@juicesharp/rpiv-ask-user-question";
import { wrapUpstream, type PiLike, type ToolDefinition } from "../src/wrapper";

export { wrapUpstream };
export type { PiLike, ToolDefinition };

/** Capture upstream's registered tool definitions via the real package. */
export async function captureUpstreamTools() {
	const fakePi = {
		registerTool: () => ({ definition: {} }),
		on: () => undefined,
		events: { emit: () => undefined },
	};
	const { proxiedPi, capturedTools } = wrapUpstream(fakePi);
	await (upstreamPkg as unknown as (pi: PiLike) => Promise<unknown>)(proxiedPi);
	return { tools: capturedTools, fakePi };
}

// ---------------------------------------------------------------------------
// pi-like fake
// ---------------------------------------------------------------------------

export interface HandlerCall {
	event: string;
	args: unknown[];
}

export class Harness {
	[key: string]: unknown;
	[key: symbol]: unknown;
	registered: ToolDefinition[] = [];
	registerCalls: number = 0;
	active: unknown[] = [];
	handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
	handlerCalls: HandlerCall[] = [];
	setActiveCalls: unknown[][] = [];
	events: { event: string; payload: unknown }[] = [];
	uiCustomCalls: {
		kind: string;
		props: Record<string, unknown>;
	}[] = [];

	registerTool(tool: ToolDefinition): { definition: ToolDefinition } {
		this.registerCalls++;
		const existing = this.registered.findIndex((t) => t.name === tool.name);
		if (existing >= 0) this.registered[existing] = tool;
		else this.registered.push(tool);
		return { definition: tool };
	}

	setActiveTools(tools: unknown[]): void {
		this.setActiveCalls.push(tools);
		this.active = tools;
	}

	getActiveTools(): unknown[] {
		return this.active;
	}

	on(event: string, handler: (...args: unknown[]) => unknown): void {
		const list = this.handlers.get(event) ?? [];
		list.push(handler);
		this.handlers.set(event, list);
	}

	/** Run handlers for an event sequentially, recording the call. */
	async emit(event: string, ...args: unknown[]): Promise<void> {
		this.handlerCalls.push({ event, args });
		for (const handler of this.handlers.get(event) ?? []) {
			await handler(...args);
		}
	}
}

/**
 * ctx for the RPC path: upstream's execute routes to the sequential
 * dialog walker when ctx.mode === "rpc" and ui has select/input, which is
 * fully deterministic under test. `selectCalls`/`inputCalls` record what
 * upstream asked; the default stub picks the first offered option.
 */
export function makeRpcCtx(
	behavior: {
		select?: (title: string, options: string[]) => Promise<string | undefined>;
		input?: (title: string, placeholder?: string) => Promise<string | undefined>;
	} = {},
): Record<string, unknown> {
	const selectCalls: { title: string; options: string[] }[] = [];
	const inputCalls: { title: string; placeholder?: string }[] = [];
	return {
		hasUI: true,
		mode: "rpc",
		selectCalls,
		inputCalls,
		ui: {
			select: async (title: string, options: string[]) => {
				selectCalls.push({ title, options });
				return behavior.select ? await behavior.select(title, options) : options[0];
			},
			input: async (title: string, placeholder?: string) => {
				inputCalls.push({ title, placeholder });
				return behavior.input ? await behavior.input(title, placeholder) : undefined;
			},
		},
	};
}

/** ctx with no UI at all: upstream's execute backstop returns an error envelope. */
export function makeNoUiCtx(): Record<string, unknown> {
	return { hasUI: false, mode: "cli" };
}

// ---------------------------------------------------------------------------
// Local JSON-schema subset validator (what Pi would enforce before execute)
// ---------------------------------------------------------------------------

export interface ValidationIssue {
	path: string;
	message: string;
}

function typeOf(value: unknown): string {
	if (Array.isArray(value)) return "array";
	if (value === null) return "null";
	return typeof value;
}

function checkType(value: unknown, type: string, path: string, issues: ValidationIssue[]): boolean {
	const actual = typeOf(value);
	// JSON-schema "integer" accepts number only when integral.
	const ok =
		type === "integer"
			? actual === "number" && Number.isInteger(value)
			: actual === type;
	if (!ok) {
		issues.push({ path, message: `expected ${type}, got ${actual}` });
		return false;
	}
	return true;
}

export function validate(schema: unknown, value: unknown, path = "$"): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	if (!schema || typeof schema !== "object") return issues;
	const s = schema as Record<string, unknown>;

	if (typeof s.type === "string" && !checkType(value, s.type, path, issues)) {
		return issues;
	}
	if (s.type === "string" && typeof value === "string") {
		if (typeof s.maxLength === "number" && value.length > s.maxLength) {
			issues.push({ path, message: `maxLength ${s.maxLength} exceeded (got ${value.length})` });
		}
		if (typeof s.minLength === "number" && value.length < s.minLength) {
			issues.push({ path, message: `minLength ${s.minLength} not met (got ${value.length})` });
		}
	}
	if (s.type === "number" && typeof value === "number") {
		if (typeof s.minimum === "number" && value < s.minimum) {
			issues.push({ path, message: `minimum ${s.minimum} not met` });
		}
	}

	if (Array.isArray(s.enum) && !s.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
		issues.push({ path, message: `not one of enum values` });
	}

	if (s.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;
		for (const key of s.required as string[] ?? []) {
			if (!(key in obj)) issues.push({ path: `${path}.${key}`, message: "required property missing" });
		}
		const props = (s.properties ?? {}) as Record<string, unknown>;
		const additional = s.additionalProperties;
		for (const key of Object.keys(obj)) {
			if (key in props) {
				issues.push(...validate(props[key], obj[key], `${path}.${key}`));
			} else if (additional === false) {
				issues.push({ path: `${path}.${key}`, message: "additional property not allowed" });
			}
		}
	}

	if (s.type === "array" && Array.isArray(value)) {
		if (typeof s.minItems === "number" && value.length < s.minItems) {
			issues.push({ path, message: `minItems ${s.minItems} not met (got ${value.length})` });
		}
		if (typeof s.maxItems === "number" && value.length > s.maxItems) {
			issues.push({ path, message: `maxItems ${s.maxItems} exceeded (got ${value.length})` });
		}
		if (s.items) {
			value.forEach((item, i) => {
				issues.push(...validate(s.items, item, `${path}[${i}]`));
			});
		}
	}

	if (Array.isArray(s.anyOf)) {
		const allIssues: ValidationIssue[] = [];
		for (const sub of s.anyOf) {
			const subIssues = validate(sub, value, path);
			if (subIssues.length === 0) return issues;
			allIssues.push(...subIssues);
		}
		issues.push({ path, message: `matched no anyOf branch (${allIssues.length} sub-issues)` });
	}

	return issues;
}

// ---------------------------------------------------------------------------
// Config isolation for tests that must control the guidance overrides
// ---------------------------------------------------------------------------

export async function withTempHome<T>(fn: (home: string) => Promise<T> | T): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "rpiv-lean-test-"));
	const previousHome = process.env.HOME;
	const previousXdg = process.env.XDG_CONFIG_HOME;
	process.env.HOME = home;
	process.env.XDG_CONFIG_HOME = join(home, ".config");
	try {
		return await fn(home);
	} finally {
		process.env.HOME = previousHome;
		process.env.XDG_CONFIG_HOME = previousXdg;
		rmSync(home, { recursive: true, force: true });
	}
}

export function writeGuidanceConfig(home: string, guidance: unknown): void {
	const dir = join(home, ".config", "rpiv-ask-user-question");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "config.json"), JSON.stringify({ guidance }));
}

/**
 * Drive one tool call the way pi would: prepareArguments → validate →
 * execute(toolCallId, params, signal, onUpdate, ctx). Returns the execute
 * result, or the validation issues.
 */
export async function callTool(
	tool: ToolDefinition,
	rawArgs: unknown,
	ctx: Record<string, unknown> = makeRpcCtx(),
): Promise<{ ok: true; result: unknown } | { ok: false; issues: ValidationIssue[] }> {
	const prepared =
		typeof tool.prepareArguments === "function" ? await tool.prepareArguments(rawArgs, ctx) : rawArgs;
	const issues = validate(tool.parameters, prepared);
	if (issues.length > 0) return { ok: false, issues };
	const result = await tool.execute?.("test-call", prepared, undefined, undefined, ctx);
	return { ok: true, result };
}
