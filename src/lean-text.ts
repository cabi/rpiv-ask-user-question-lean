/**
 * Lean tool texts, schema transform, and argument fill-ins.
 *
 * Everything the model reads on every request lives here so the token cost
 * is reviewable in one place. The lean texts are our own strings — they
 * replace upstream's defaults but preserve every rule that affects how the
 * model calls the tool; anything else (counts, lengths, UI behavior) is
 * either expressed by the schema or was human-only prose.
 *
 * `leanSchema` derives the lean parameter schema from upstream's registered
 * schema at runtime: field descriptions are stripped, all constraints
 * (types, maxLength, minItems/maxItems, defaults) are kept verbatim, and two
 * short descriptions are re-injected where the field name alone is unclear.
 * Nothing is hardcoded about the schema shape, so upstream schema tweaks
 * flow through on upgrade.
 *
 * `fillInCommonMistakes` repairs unambiguous argument mistakes before Pi's
 * schema validation runs (chained after upstream's own `prepareArguments`,
 * which already decodes double-encoded JSON). Each fix only fires on an
 * exact mistaken shape and never mutates its input; well-formed arguments
 * come back as the same reference. Ambiguous cases (e.g. a missing
 * `header`, which would have to be invented) are left alone so validation
 * reports the real problem.
 */

/** What the tool does — shown in the tool list. */
export const LEAN_DESCRIPTION =
	"Show the questions you author to the user as a multiple-choice questionnaire and return their answers.";

/** One-liner for the system prompt: when to reach for the tool. */
export const LEAN_SNIPPET =
	"Ask the user structured multiple-choice questions when requirements are ambiguous or a decision is needed";

/**
 * How to author a questionnaire. Each rule appears exactly once across
 * description, snippet, and guidelines; counts and lengths live only in the
 * schema.
 */
export const LEAN_GUIDELINES: string[] = [
	"Ask all clarifying questions in one invocation; do not stack calls back-to-back.",
	"Each option needs a concise label (1-5 words) and a description stating what the choice means or its trade-offs.",
	'If you recommend an option, put it first and append "(Recommended)" to its label.',
	'Every question gets an automatic "Type something." row; the labels "Other" and "Type something." are reserved.',
	"Use options[].preview for side-by-side comparison (code, mockups, diagrams); skip it when labels and descriptions suffice.",
];

/**
 * Short descriptions re-injected after stripping, for fields whose purpose
 * the name alone does not convey. Keys are JSON-schema property names.
 */
const SHORT_FIELD_DESCRIPTIONS: Record<string, string> = {
	header: "short label shown next to the question",
	preview: "markdown shown beside the option list when the option is focused; single-select questions only",
};

/** Recursively copy a JSON-schema node, dropping every `description` key. */
function stripDescriptions(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(stripDescriptions);
	if (node !== null && typeof node === "object") {
		const out: Record<string | symbol, unknown> = {};
		for (const key of Reflect.ownKeys(node)) {
			if (key === "description") continue;
			out[key] = stripDescriptions((node as Record<string | symbol, unknown>)[key]);
		}
		return out;
	}
	return node;
}

/** Recursively inject the short descriptions by property name. */
function injectShortDescriptions(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(injectShortDescriptions);
	if (node !== null && typeof node === "object") {
		const out: Record<string | symbol, unknown> = {};
		for (const key of Reflect.ownKeys(node)) {
			const value = (node as Record<string | symbol, unknown>)[key];
			if (typeof key === "string" && key in SHORT_FIELD_DESCRIPTIONS && value && typeof value === "object") {
				out[key] = { ...(value as object), description: SHORT_FIELD_DESCRIPTIONS[key] };
			} else {
				out[key] = injectShortDescriptions(value);
			}
		}
		return out;
	}
	return node;
}

/** Upstream schema → lean schema: no field prose, all constraints kept. */
export function leanSchema(parameters: object): unknown {
	return injectShortDescriptions(stripDescriptions(parameters));
}

// ---------------------------------------------------------------------------
// Argument fill-ins (run before Pi's schema validation, after upstream's
// double-JSON decode)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(obj: Record<string, unknown>, key: string): boolean {
	return typeof obj[key] === "string";
}

function hasArray(obj: Record<string, unknown>, key: string): boolean {
	return Array.isArray(obj[key]);
}

/** "true"/"false" (any case, trimmed) → boolean; any other string → undefined. */
function coerceBooleanString(value: unknown): boolean | undefined {
	if (typeof value !== "string") return undefined;
	const norm = value.trim().toLowerCase();
	if (norm === "true") return true;
	if (norm === "false") return false;
	return undefined;
}

/** A question-shaped object: has at least a string `question` and an `options` array. */
function looksLikeQuestion(value: unknown): value is Record<string, unknown> {
	return isRecord(value) && hasString(value, "question") && hasArray(value, "options");
}

function fixOption(option: unknown): { value: unknown; changed: boolean } {
	// Option sent as a plain string → label with no separate description.
	if (typeof option === "string") {
		return { value: { label: option, description: "" }, changed: true };
	}
	// Option object with a label but no description key → empty description.
	if (
		isRecord(option) &&
		hasString(option, "label") &&
		!("description" in option)
	) {
		return { value: { ...option, description: "" }, changed: true };
	}
	return { value: option, changed: false };
}

function fixQuestion(question: unknown): { value: unknown; changed: boolean } {
	if (!isRecord(question)) return { value: question, changed: false };
	let changed = false;
	const out: Record<string, unknown> = { ...question };
	const multiSelect = coerceBooleanString(out.multiSelect);
	if (multiSelect !== undefined) {
		out.multiSelect = multiSelect;
		changed = true;
	}
	if (Array.isArray(out.options)) {
		const fixed = out.options.map(fixOption);
		if (fixed.some((f) => f.changed)) {
			out.options = fixed.map((f) => f.value);
			changed = true;
		}
	}
	return { value: changed ? out : question, changed };
}

/**
 * Fill in the pieces behind the most common call mistakes. Pure: returns the
 * input reference untouched when nothing applies. Reserved labels ("Other",
 * "Type something.") are deliberately left for upstream to reject.
 */
export function fillInCommonMistakes(args: unknown): unknown {
	if (!isRecord(args)) return args;

	let questions: unknown = args.questions;
	let changed = false;

	// `questions` sent as a single question object → wrap in the array.
	if (looksLikeQuestion(questions)) {
		questions = [questions];
		changed = true;
	}

	// One question sent at the top level (no `questions` key) → restructure.
	// Only when every required field is present — a missing `header` cannot
	// be invented, so it must surface as a validation error instead.
	if (questions === undefined && hasString(args, "question") && hasString(args, "header") && hasArray(args, "options")) {
		const question: Record<string, unknown> = {
			question: args.question,
			header: args.header,
			options: args.options,
		};
		if ("multiSelect" in args) question.multiSelect = args.multiSelect;
		questions = [question];
		changed = true;
	}

	if (Array.isArray(questions)) {
		const fixed = questions.map(fixQuestion);
		if (fixed.some((f) => f.changed)) {
			questions = fixed.map((f) => f.value);
			changed = true;
		}
	}

	if (!changed) return args;

	const out: Record<string, unknown> = { ...args, questions };
	if (questions !== args.questions) {
		// The restructured form moved these fields under questions[0].
		delete out.question;
		delete out.header;
		delete out.options;
		delete out.multiSelect;
	}
	return out;
}
