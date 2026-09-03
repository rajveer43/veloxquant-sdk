import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { VeloxQuantModel } from './client.js';

/**
 * Wraps an already-loaded VeloxQuantModel as a Vercel AI SDK LanguageModelV4,
 * usable with generateText()/streamText().
 *
 * Takes a running VeloxQuantModel (not a bare model-name string) rather than
 * managing the vq.load() lifecycle itself: createOpenAICompatible() is
 * synchronous and needs a baseURL up front, but getting one requires an
 * async vq.load() — and an AI SDK provider has no disposal hook where this
 * function could call model.stop() safely. Putting lifecycle in the
 * caller's hands (matching how vq.load()/autopilot() already work) avoids
 * leaking a server process with no one responsible for stopping it.
 *
 * @example
 * const model = await vq.load({ model: "mlx-community/Qwen3-8B-4bit", optimize: "auto" });
 * const result = await generateText({ model: veloxquant(model), prompt: "Hello!" });
 * await model.stop();
 */
export function veloxquant(model: VeloxQuantModel): LanguageModelV4 {
  const provider = createOpenAICompatible({
    baseURL: `${model.baseUrl}/v1`,
    name: 'veloxquant',
  });
  return provider(model.model);
}
