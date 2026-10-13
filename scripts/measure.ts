/**
 * Measure how many tokens the upstream and lean tool texts take.
 *
 * Prints a per-field and total comparison (chars and js-tiktoken tokens,
 * gpt-4o encoding) for everything the model reads on every request:
 * description, promptSnippet, promptGuidelines, and the parameter schema.
 *
 * Run: npm run measure
 */

import { encodingForModel } from "js-tiktoken";
import { captureUpstreamTools, type ToolDefinition } from "../test/harness";
import { LEAN_DESCRIPTION, LEAN_GUIDELINES, LEAN_SNIPPET, leanSchema } from "../src/lean-text";
import { leanToolDefinitionWithOverrides } from "../src/wrapper";

const enc = encodingForModel("gpt-4o");

function tokens(text: string): number {
	return enc.encode(text).length;
}

function leanFor(upstream: ToolDefinition): ToolDefinition {
	return leanToolDefinitionWithOverrides(upstream, {});
}

function fieldRow(label: string, upstreamText: string, leanText: string) {
	const uc = upstreamText.length;
	const lc = leanText.length;
	const ut = tokens(upstreamText);
	const lt = tokens(leanText);
	return {
		label,
		upstream: { chars: uc, tokens: ut },
		lean: { chars: lc, tokens: lt },
		savedPct: ut === 0 ? 0 : Math.round(((ut - lt) / ut) * 100),
	};
}

const { tools } = await captureUpstreamTools();
if (tools.length === 0) {
	console.error("upstream registered no tools");
	process.exit(1);
}

const rows = [];
let upChars = 0;
let upTokens = 0;
let leanChars = 0;
let leanTokens = 0;

for (const upstream of tools) {
	const lean = leanFor(upstream);

	const textRows = [
		fieldRow(`${upstream.name} description`, upstream.description ?? "", lean.description ?? ""),
		fieldRow(`${upstream.name} promptSnippet`, upstream.promptSnippet ?? "", lean.promptSnippet ?? ""),
		fieldRow(
			`${upstream.name} promptGuidelines`,
			(upstream.promptGuidelines ?? []).join("\n"),
			(lean.promptGuidelines ?? []).join("\n"),
		),
		fieldRow(
			`${upstream.name} parameters (JSON)`,
			JSON.stringify(upstream.parameters ?? {}),
			JSON.stringify(leanSchema(upstream.parameters as object)),
		),
	];

	rows.push(...textRows);
	for (const r of textRows) {
		upChars += r.upstream.chars;
		upTokens += r.upstream.tokens;
		leanChars += r.lean.chars;
		leanTokens += r.lean.tokens;
	}
}

console.log("| Field | Upstream chars | Upstream tokens | Lean chars | Lean tokens | Token saving |");
console.log("|---|---:|---:|---:|---:|---:|");
for (const r of rows) {
	console.log(
		`| ${r.label} | ${r.upstream.chars} | ${r.upstream.tokens} | ${r.lean.chars} | ${r.lean.tokens} | ${r.savedPct}% |`,
	);
}
console.log(
	`| **Total** | **${upChars}** | **${upTokens}** | **${leanChars}** | **${leanTokens}** | **${Math.round(((upTokens - leanTokens) / upTokens) * 100)}%** |`,
);
