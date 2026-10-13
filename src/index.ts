/**
 * Extension entry point. Captures upstream's registration through a Proxy,
 * registers the lean tool definitions against the real pi instance, and
 * never lets upstream's reconciler mutate the active tool list.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import upstreamPkg from "@juicesharp/rpiv-ask-user-question";
import { leanToolDefinition, wrapUpstream, type PiLike } from "./wrapper";

export default function (pi: ExtensionAPI) {
	const { proxiedPi, capturedTools } = wrapUpstream(pi as unknown as PiLike);
	void upstreamPkg(proxiedPi as unknown as Parameters<typeof upstreamPkg>[0]);

	for (const captured of capturedTools) {
		pi.registerTool(leanToolDefinition(captured) as Parameters<typeof pi.registerTool>[0]);
	}
}

export * from "./wrapper";
