/**
 * rpiv-ask-user-question-lean — token-lean wrapper around
 * @juicesharp/rpiv-ask-user-question.
 *
 * Upstream registers exactly one tool (`ask_user_question`), so there is
 * nothing to merge and no `op` parameter is added — that would only add
 * tokens. What this wrapper changes:
 *
 * 1. The texts the model reads every request (description, promptSnippet,
 *    promptGuidelines, parameter descriptions) are replaced with lean
 *    versions from ./lean-text.ts. Fields the user has overridden in their
 *    rpiv-ask-user-question config.json pass through verbatim.
 * 2. The tool list is frozen for the session. Upstream's reconciler calls
 *    setActiveTools on before_agent_start to strip the tool when no UI is
 *    available; upstream's execute has its own !ctx.hasUI backstop, so
 *    blocking the reconciler is safe and the tool never disappears
 *    mid-session. Calls are recorded into a shadow list so tests can assert
 *    they happened; getActiveTools reports the shadow once set.
 * 3. Common unambiguous argument mistakes are filled in before validation
 *    (chained after upstream's prepareArguments, which decodes
 *    double-encoded JSON strings).
 *
 * Everything else — schema constraints, validation, the questionnaire UI,
 * the response envelope — runs upstream code, unmodified.
 */

import {
	loadJsonConfigWithLegacyFallback,
	validateGuidanceFields,
	type GuidanceFields,
} from "@juicesharp/rpiv-config";
import { fillInCommonMistakes, leanSchema, LEAN_DESCRIPTION, LEAN_GUIDELINES, LEAN_SNIPPET } from "./lean-text";


export interface ToolDefinition {
	name?: string;
	label?: string;
	description?: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters?: object;
	execute?: (toolCallId: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => unknown;
	prepareArguments?: (raw: unknown, ctx: unknown) => unknown;
	[key: string | symbol]: unknown;
}

export interface RegisteredTool {
	definition: ToolDefinition;
}

export interface PiLike {
	registerTool: (tool: ToolDefinition) => RegisteredTool | unknown;
	setActiveTools?: (tools: unknown[]) => unknown;
	getActiveTools?: () => unknown[];
	on?: (event: string, handler: (...args: unknown[]) => unknown) => unknown;
	[key: string | symbol]: unknown;
}

export interface WrapResult {
	/** The pi-like object upstream sees (Proxy around the real one). */
	proxiedPi: PiLike;
	/** Tools upstream registered, with upstream's original definitions. */
	capturedTools: ToolDefinition[];
	/**
	 * Every setActiveTools call made through the proxy, in order. The real
	 * pi instance never receives them; getActiveTools on the proxy reports
	 * the last shadow list once one has been set.
	 */
	setActiveToolsCalls: unknown[][];
}

/**
 * Wrap a pi instance so upstream's tool registration is captured instead of
 * forwarded, and its setActiveTools calls are shadowed instead of applied.
 * All other property access and calls pass through untouched.
 */
export function wrapUpstream(pi: PiLike): WrapResult {
	const capturedTools: ToolDefinition[] = [];
	const setActiveToolsCalls: unknown[][] = [];
	let shadowActiveTools: unknown[] | undefined;

	const proxiedPi: PiLike = new Proxy(pi, {
		get(target, prop, receiver) {
			if (prop === "registerTool") {
				return (tool: ToolDefinition): RegisteredTool | unknown => {
					capturedTools.push(tool);
					// A stand-in handle upstream may hold onto; upstream does not
					// rely on the return value beyond optional chaining.
					return { definition: tool };
				};
			}
			if (prop === "setActiveTools") {
				return (tools: unknown[]): unknown => {
					setActiveToolsCalls.push(tools);
					shadowActiveTools = tools;
					return undefined;
				};
			}
			if (prop === "getActiveTools" && shadowActiveTools !== undefined) {
				return () => shadowActiveTools;
			}
			const value = Reflect.get(target, prop, target);
			if (typeof value === "function") return value.bind(target);
			return value;
		},
	});

	return { proxiedPi, capturedTools, setActiveToolsCalls };
}

/**
 * Load the user's guidance overrides the same way upstream does at
 * registration time: config dir first, legacy ~/.config fallback second,
 * per-field validation. Returns {} when unset or invalid.
 */
export function loadGuidanceOverrides(): GuidanceFields {
	const raw = loadJsonConfigWithLegacyFallback(
		"rpiv-ask-user-question",
		"config.json",
	) as Record<string, unknown>;
	return validateGuidanceFields(raw?.guidance);
}

/**
 * Lean definition for one captured upstream tool: upstream's execute and
 * schema constraints verbatim, lean texts where the user has not
 * configured an override, and prepareArguments chained as
 * upstream-prepare → mistake fill-in.
 */
function leanDefinitionWithOverrides(
	captured: ToolDefinition,
	overrides: GuidanceFields,
): ToolDefinition {
	const definition: ToolDefinition = {
		...captured,
		description: overrides.description || LEAN_DESCRIPTION,
		promptSnippet: overrides.promptSnippet || LEAN_SNIPPET,
		promptGuidelines: overrides.promptGuidelines?.length ? overrides.promptGuidelines : LEAN_GUIDELINES,
	};
	if (captured.parameters) {
		definition.parameters = leanSchema(captured.parameters) as object;
	}
	const upstreamPrepare = captured.prepareArguments?.bind(captured);
	if (upstreamPrepare) {
		definition.prepareArguments = (raw: unknown, ctx: unknown) =>
			fillInCommonMistakes(upstreamPrepare(raw, ctx));
	} else {
		definition.prepareArguments = (raw: unknown) => fillInCommonMistakes(raw);
	}
	return definition;
}

/**
 * Lean definition using the guidance overrides from the user's
 * rpiv-ask-user-question config.json (falls back to the lean defaults for
 * every field the user has not set).
 */
export function leanToolDefinition(captured: ToolDefinition): ToolDefinition {
	return leanDefinitionWithOverrides(captured, loadGuidanceOverrides());
}

/** Lean definition with explicit guidance overrides (tests, callers that
 * already loaded guidance themselves). */
export function leanToolDefinitionWithOverrides(
	captured: ToolDefinition,
	overrides: GuidanceFields,
): ToolDefinition {
	return leanDefinitionWithOverrides(captured, overrides);
}

