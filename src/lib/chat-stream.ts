import type { UIMessageChunk } from "ai";

/**
 * Attaches custom data parts (follow-ups, citation sources) to the answer's own
 * assistant message.
 *
 * A data chunk that arrives BEFORE the model's `start` chunk has no message to join.
 * The client then creates an empty assistant message for it, which renders as a stray
 * "…" bubble above the real answer. Inserting the data right after `start` keeps
 * everything in one message. If the model never starts (an error first), nothing is
 * inserted, so no empty message is created.
 */
export function insertAfterStart(
  dataChunks: UIMessageChunk[],
): TransformStream<UIMessageChunk, UIMessageChunk> {
  let inserted = false;
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      if (!inserted && chunk.type === "start") {
        inserted = true;
        for (const data of dataChunks) controller.enqueue(data);
      }
    },
  });
}
