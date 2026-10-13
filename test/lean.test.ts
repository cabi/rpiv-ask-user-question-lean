/**
 * Tests for rpiv-ask-user-question-lean.
 *
 * Real upstream code runs throughout: tools are captured from the actual
 * @juicesharp/rpiv-ask-user-question package via the same Proxy mechanism
 * the extension uses at runtime.
 */

import { describe, expect, it } from "vitest";
import {
	LEAN_DESCRIPTION,
	LEAN_GUIDELINES,
	LEAN_SNIPPET,
	fillInCommonMistakes,
	leanSchema,
} from "../src/lean-text";
import {
	leanToolDefinition,
	leanToolDefinitionWithOverrides,
	wrapUpstream,
} from "../src/wrapper";
import {
	callTool,
	captureUpstreamTools,
	Harness,
	makeNoUiCtx,
	makeRpcCtx,
	validate,
	withTempHome,
	writeGuidanceConfig,
} from "./harness";

/** A well-formed single question used across tests. */
function sampleArgs() {
	return {
		questions: [
			{
				question: "Which database?",
				header: "Database",
				options: [
					{ label: "Postgres", description: "Relational, mature" },
					{ label: "SQLite", description: "Embedded, zero-config" },
				],
			},
		],
	};
}

async function getUpstreamTool() {
	const { tools } = await captureUpstreamTools();
	expect(tools.length).toBe(1);
	return tools[0];
}

describe("upstream capture", () => {
	it("registers exactly one tool named ask_user_question", async () => {
		const tool = await getUpstreamTool();
		expect(tool.name).toBe("ask_user_question");
		expect(typeof tool.execute).toBe("function");
	});

	it("capture goes through the proxy, not the real pi", () => {
		const h = new Harness();
		const { proxiedPi, capturedTools } = wrapUpstream(h);
		// Simulate an upstream-like registration.
		proxiedPi.registerTool({ name: "fake", execute: () => undefined });
		expect(capturedTools.map((t) => t.name)).toEqual(["fake"]);
		expect(h.registered).toEqual([]); // real pi untouched
	});
});

describe("lean definition", () => {
	it("reuses upstream execute and label, replaces texts and schema", async () => {
		const upstream = await getUpstreamTool();
		const lean = leanToolDefinitionWithOverrides(upstream, {});
		expect(lean.name).toBe("ask_user_question");
		expect(lean.label).toBe(upstream.label);
		expect(lean.execute).toBe(upstream.execute); // execute calls upstream directly
		expect(lean.description).toBe(LEAN_DESCRIPTION);
		expect(lean.promptSnippet).toBe(LEAN_SNIPPET);
		expect(lean.promptGuidelines).toBe(LEAN_GUIDELINES);
		expect(lean.parameters).not.toEqual(upstream.parameters);
	});

	it("lean schema keeps every constraint but drops descriptions", async () => {
		const upstream = await getUpstreamTool();
		const lean = leanToolDefinitionWithOverrides(upstream, {});
		const leanParams = lean.parameters as Record<string, unknown>;
		const questions = (leanParams.properties as Record<string, unknown>).questions as Record<string, unknown>;
		const q0 = (questions.items as Record<string, unknown>).properties as Record<string, unknown>;

		// Constraints preserved verbatim.
		expect(questions.minItems).toBe(1);
		expect(questions.maxItems).toBe(4);
		expect(questions.items).toBeTruthy();
		const header = q0.header as Record<string, unknown>;
		expect(header.maxLength).toBe(16);
		const options = q0.options as Record<string, unknown>;
		expect(options.minItems).toBe(2);
		expect(options.maxItems).toBe(4);
		const option = (options.items as Record<string, unknown>).properties as Record<string, unknown>;
		expect((option.label as Record<string, unknown>).maxLength).toBe(60);
		const multiSelect = q0.multiSelect as Record<string, unknown>;
		expect(multiSelect.default).toBe(false);

		// No descriptions survive except the two re-injected ones.
		const json = JSON.stringify(leanParams);
		const described = JSON.parse(json, (key, value) =>
			key === "description" && typeof value === "string" ? value : value,
		);
		const kept = JSON.stringify(described).match(/"(short label shown|markdown shown)/g) ?? [];
		// Every description in the schema is one of the two short ones.
		const allDescriptions = json.match(/"description":"/g) ?? [];
		expect(allDescriptions.length).toBeLessThanOrEqual(2);
		expect(kept.length).toBe(allDescriptions.length);
	});

	it("lean texts avoid forbidden phrasing", async () => {
		const texts = [LEAN_DESCRIPTION, LEAN_SNIPPET, ...LEAN_GUIDELINES].join("\n");
		expect(texts).not.toMatch(/\bMUST\b|\bNEVER\b|\bALWAYS\b/);
		// All-caps words beyond the reserved labels and acronyms.
		const caps = texts.match(/\b[A-Z]{3,}\b/g) ?? [];
		expect(caps).toEqual([]);
	});
});

describe("calls reach upstream", () => {
	it("execute runs upstream and returns its envelope (RPC path)", async () => {
		const upstream = await getUpstreamTool();
		const lean = leanToolDefinitionWithOverrides(upstream, {});
		const ctx = makeRpcCtx();
		const outcome = await callTool(lean, sampleArgs(), ctx);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		const result = outcome.result as { content: { text: string }[]; details: unknown };
		expect(result.content[0].text).toContain("User has answered your questions:");
		expect(result.content[0].text).toContain("Postgres");
		// The dialog walker actually ran: one select per question.
		expect((ctx.selectCalls as unknown[]).length).toBe(1);
	});

	it("prepareArguments chains upstream decode then fill-ins", async () => {
		const upstream = await getUpstreamTool();
		const lean = leanToolDefinitionWithOverrides(upstream, {});
		// Double-encoded JSON string (upstream decodes), with string options
		// and multiSelect as string (our fill-ins fix).
		const ctx = makeRpcCtx({ input: async () => "1" });
		const raw = {
			questions: JSON.stringify([
				{
					question: "Deploy where?",
					header: "Deploy",
					multiSelect: "true",
					options: JSON.stringify(["Vercel", "Self-host"]),
				},
			]),
		};
		const outcome = await callTool(lean, raw, ctx);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		const result = outcome.result as { content: { text: string }[] };
		expect(result.content[0].text).toContain("User has answered your questions:");
	});

	it("no-UI ctx yields upstream's backstop error, not a crash", async () => {
		const upstream = await getUpstreamTool();
		const lean = leanToolDefinitionWithOverrides(upstream, {});
		const outcome = await callTool(lean, sampleArgs(), makeNoUiCtx());
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		const result = outcome.result as { content: { text: string }[] };
		expect(result.content[0].text).toContain("non-interactive");
	});

	it("reserved labels still reach upstream's validator", async () => {
		const upstream = await getUpstreamTool();
		const lean = leanToolDefinitionWithOverrides(upstream, {});
		const args = {
			questions: [
				{
					question: "Pick one",
					header: "Pick",
					options: [
						{ label: "Other", description: "reserved" },
						{ label: "Fine", description: "ok" },
					],
				},
			],
		};
		const outcome = await callTool(lean, args, makeRpcCtx());
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		const result = outcome.result as { content: { text: string }[]; details: { error?: string } };
		expect(result.details.error).toBe("reserved_label");
	});
});

describe("fill-in logic", () => {
	it("wraps a lone question object into the array", () => {
		const q = sampleArgs().questions[0];
		const fixed = fillInCommonMistakes(q) as { questions: unknown[] };
		expect(Array.isArray(fixed.questions)).toBe(true);
		expect(fixed.questions.length).toBe(1);
	});

	it("restructures top-level question/header/options", () => {
		const top = { question: "Q?", header: "H", options: [{ label: "a", description: "b" }, { label: "c", description: "d" }] };
		const fixedTop = fillInCommonMistakes(top) as Record<string, unknown> & { questions: { question: string; header: string }[] };
		expect(fixedTop.questions[0].question).toBe("Q?");
		expect(fixedTop.questions[0].header).toBe("H");
		// Top-level fields moved into the question, not duplicated.
		expect("question" in fixedTop).toBe(false);
		expect("header" in fixedTop).toBe(false);
		expect("options" in fixedTop).toBe(false);
	});

	it("coerces multiSelect strings and string options", () => {
		const args = {
			questions: [
				{
					question: "Q?",
					header: "H",
					multiSelect: "false",
					options: ["A", "B"],
				},
			],
		};
		const fixed = fillInCommonMistakes(args) as typeof args;
		expect(fixed.questions[0].multiSelect).toBe(false);
		expect(fixed.questions[0].options).toEqual([
			{ label: "A", description: "" },
			{ label: "B", description: "" },
		]);
	});

	it("adds missing option descriptions", () => {
		const args = {
			questions: [
				{
					question: "Q?",
					header: "H",
					options: [{ label: "A" }, { label: "B", description: "x" }],
				},
			],
		};
		const fixed = fillInCommonMistakes(args) as typeof args;
		expect(fixed.questions[0].options).toEqual([
			{ label: "A", description: "" },
			{ label: "B", description: "x" },
		]);
	});

	it("does not misfire on well-formed args (same reference)", () => {
		const args = sampleArgs();
		expect(fillInCommonMistakes(args)).toBe(args);
	});

	it("does not invent a missing header", () => {
		const args = { questions: [{ question: "Q?", options: [{ label: "a", description: "" }] }] };
		const fixed = fillInCommonMistakes(args);
		expect(fixed).toBe(args); // left alone; validation reports it
	});

	it("leaves non-question payloads untouched", () => {
		for (const value of [null, "text", 42, [], { unrelated: true }]) {
			expect(fillInCommonMistakes(value)).toBe(value);
		}
	});
});

describe("frozen tool list", () => {
	it("setActiveTools through the proxy never reaches the real pi", async () => {
		const h = new Harness();
		const { proxiedPi, setActiveToolsCalls } = wrapUpstream(h);
		h.on("before_agent_start", async () => {
			// What upstream's reconciler does: strip tools without UI.
			const active = proxiedPi.getActiveTools?.() ?? [];
			proxiedPi.setActiveTools?.(active.filter(() => false));
		});
		h.active = [{ name: "ask_user_question" }];
		h.active = [{ name: "other" }, { name: "ask_user_question" }];

		await h.emit("before_agent_start", {});
		// The call was recorded in the shadow...
		expect(setActiveToolsCalls.length).toBe(1);
		// ...but the real pi kept its active list.
		expect(h.setActiveCalls.length).toBe(0);
		expect(h.active.length).toBe(2);
	});

	it("getActiveTools reports the shadow only once one was set", () => {
		const h = new Harness();
		const { proxiedPi } = wrapUpstream(h);
		h.active = ["a"];
		expect(proxiedPi.getActiveTools?.()).toEqual(["a"]); // passthrough
		proxiedPi.setActiveTools?.(["b"]);
		expect(proxiedPi.getActiveTools?.()).toEqual(["b"]); // shadow
	});

	it("upstream's real reconciler cannot strip the tool mid-session", async () => {
		// Register upstream against a proxy over a real harness; upstream's
		// reconciler subscribes through pi.on and runs on before_agent_start.
		const { captureUpstreamTools } = await import("./harness");
		const h = new Harness();
		const { proxiedPi } = wrapUpstream(h);
		const upstreamPkg = (await import("@juicesharp/rpiv-ask-user-question")).default as unknown as (pi: unknown) => Promise<unknown>;
		await upstreamPkg(proxiedPi);

		h.active = ["ask_user_question"];
		await h.emit("before_agent_start", {}, { hasUI: false });
		await h.emit("before_agent_start", {}, { hasUI: true });
		expect(h.setActiveCalls.length).toBe(0);
		expect(h.active.length).toBe(1);
	});
});

describe("guidance overrides", () => {
	it("user-configured fields pass through verbatim", async () => {
		withTempHome(async (home) => {
			writeGuidanceConfig(home, {
				description: "Custom description",
				promptGuidelines: ["Custom guideline"],
			});
			const upstream = await getUpstreamTool();
			const lean = leanToolDefinition(upstream);
			expect(lean.description).toBe("Custom description");
			expect(lean.promptGuidelines).toEqual(["Custom guideline"]);
			// Unset fields fall back to lean defaults.
			expect(lean.promptSnippet).toBe(LEAN_SNIPPET);
		});
	});

	it("empty config means lean defaults", async () => {
		withTempHome(async () => {
			const upstream = await getUpstreamTool();
			const lean = leanToolDefinition(upstream);
			expect(lean.description).toBe(LEAN_DESCRIPTION);
		});
	});
});

describe("lean schema still validates like upstream", () => {
	it("accepts the sample args both upstream and lean", async () => {
		const upstream = await getUpstreamTool();
		const lean = leanToolDefinitionWithOverrides(upstream, {});
		expect(validate(upstream.parameters, sampleArgs())).toEqual([]);
		expect(validate(lean.parameters, sampleArgs())).toEqual([]);
	});

	it("rejects identical bad input both ways", async () => {
		const upstream = await getUpstreamTool();
		const lean = leanToolDefinitionWithOverrides(upstream, {});
		const bad = [
			{ questions: [] },
			{ questions: [{ question: "q", header: "h", options: [{ label: "only", description: "" }] }] },
			{
				questions: [
					{
						question: "q",
						header: "this header is way too long for the limit",
						options: [
							{ label: "a", description: "" },
							{ label: "b", description: "" },
						],
					},
				],
			},
			{},
		];
		for (const args of bad) {
			const upstreamIssues = validate(upstream.parameters, args).map((i) => i.message);
			const leanIssues = validate(lean.parameters, args).map((i) => i.message);
			expect(leanIssues).toEqual(upstreamIssues);
			expect(leanIssues.length).toBeGreaterThan(0);
		}
	});
});

describe("leanSchema", () => {
	it("never mutates the input schema", async () => {
		const upstream = await getUpstreamTool();
		const before = JSON.stringify(upstream.parameters);
		leanSchema(upstream.parameters as object);
		expect(JSON.stringify(upstream.parameters)).toBe(before);
	});
});
