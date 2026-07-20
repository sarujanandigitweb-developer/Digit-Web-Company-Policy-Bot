import {
  APICallError,
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import {
  knownApiKeyEnvNames,
  resolveProviderChain,
  type ProviderId,
  type ResolvedProvider,
} from "./providers.server";

/**
 * Chunks the SDK emits before the provider has actually produced anything.
 * `start` in particular is emitted before the HTTP request even resolves, so it
 * proves nothing about provider health. We buffer these and only commit to a
 * provider once something outside this set arrives — see attemptProvider.
 */
const PREAMBLE_CHUNK_TYPES = new Set(["start", "start-step", "text-start", "reasoning-start"]);

/** Per-provider retries are off: the chain is the retry strategy, and the SDK's
 *  backoff (3 attempts) would delay fallback by several seconds per provider. */
const MAX_RETRIES_PER_PROVIDER = 0;

/**
 * How long a provider has to produce its first content chunk.
 *
 * A provider that accepts the connection and then stalls never emits an error,
 * so without this the chain would wait on it forever — worse than a clean
 * failure. Only the probe is bounded; once a provider commits, a slow-but-alive
 * generation is left to run as long as it needs.
 */
const FIRST_CHUNK_TIMEOUT_MS = Number(process.env.AI_FIRST_CHUNK_TIMEOUT_MS ?? 20_000);

export interface ProviderFailure {
  provider: ProviderId;
  modelId: string;
  reason: string;
}

export class NoProvidersConfiguredError extends Error {
  constructor() {
    super(`No AI provider key. Set one of: ${knownApiKeyEnvNames().join(", ")}.`);
    this.name = "NoProvidersConfiguredError";
  }
}

export class AllProvidersFailedError extends Error {
  constructor(readonly failures: ProviderFailure[]) {
    super(
      `All ${failures.length} AI provider(s) failed: ` +
        failures.map((f) => `${f.provider} (${f.reason})`).join("; "),
    );
    this.name = "AllProvidersFailedError";
  }
}

function log(message: string) {
  console.log(`[ai-gateway] ${message}`);
}

/** Whether any provider has a key — lets callers fail fast before doing work. */
export function hasConfiguredProvider(): boolean {
  return resolveProviderChain().length > 0;
}

function describeError(error: unknown, fallbackText?: string): string {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ? `HTTP ${error.statusCode}` : "network error";
    return `${status}: ${error.message.slice(0, 160)}`;
  }
  if (error instanceof Error) return error.message.slice(0, 160);
  return fallbackText?.slice(0, 160) ?? "unknown error";
}

/**
 * Whether a different provider might succeed where this one failed.
 *
 * Rate limits, timeouts, network faults and server errors are all provider-
 * specific, so we move on. So are auth failures and unknown models (a key that
 * is invalid *here* says nothing about the next provider). A 400 means we sent
 * a malformed request — every provider would reject it, so we surface it
 * instead of burning the whole chain on it.
 */
function canFallBackFrom(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === undefined) return true; // never reached the provider
    if (status === 400 || status === 422) return false;
    return true;
  }
  return true; // timeout, abort, DNS, or something unrecognised
}

type Attempt =
  | { ok: true; stream: ReadableStream<UIMessageChunk> }
  | { ok: false; reason: string; canFallBack: boolean };

/**
 * Replays the buffered preamble, then hands over to the live stream.
 * `reader` is null when the provider finished during probing.
 */
function replayThenStream(
  buffered: UIMessageChunk[],
  reader: ReadableStreamDefaultReader<UIMessageChunk> | null,
): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of buffered) controller.enqueue(chunk);
      if (!reader) controller.close();
    },
    async pull(controller) {
      if (!reader) return;
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });
}

/**
 * Runs one provider up to the point where we know whether it works.
 *
 * `streamText` never throws — a failed request surfaces as an `error` chunk
 * inside the stream. So we read chunks, holding the preamble in memory, until
 * either an error appears (this provider is out; nothing was sent to the
 * browser, so the next one can take over cleanly) or real content arrives (we
 * are committed). Buffering costs a few metadata chunks and no perceptible
 * latency, since we stop the moment the first token lands.
 */
async function attemptProvider(
  provider: ResolvedProvider,
  system: string,
  messages: UIMessage[],
): Promise<Attempt> {
  let capturedError: unknown;

  // Aborts the underlying request if the provider stalls during probing. The
  // timer is cleared on every exit path, so a committed stream is never cut off.
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, FIRST_CHUNK_TIMEOUT_MS);

  const result = streamText({
    model: provider.model,
    system,
    messages: convertToModelMessages(messages),
    maxRetries: MAX_RETRIES_PER_PROVIDER,
    abortSignal: abort.signal,
    // The error chunk carries only a string; this keeps the typed error so we
    // can read its status code.
    onError: ({ error }) => {
      capturedError = error;
    },
  });

  const reader = result.toUIMessageStream({ originalMessages: messages }).getReader();
  const buffered: UIMessageChunk[] = [];

  const timeout = (): Attempt => ({
    ok: false,
    reason: `no response within ${FIRST_CHUNK_TIMEOUT_MS}ms`,
    canFallBack: true,
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();

      // Clean finish with no content — unusual, but nothing to fall back from.
      if (done) {
        return timedOut ? timeout() : { ok: true, stream: replayThenStream(buffered, null) };
      }

      if (value.type === "error") {
        void reader.cancel().catch(() => {});
        if (timedOut) return timeout();
        const error = capturedError ?? new Error(value.errorText);
        return {
          ok: false,
          reason: describeError(error, value.errorText),
          canFallBack: canFallBackFrom(error),
        };
      }

      buffered.push(value);
      if (!PREAMBLE_CHUNK_TYPES.has(value.type)) {
        return { ok: true, stream: replayThenStream(buffered, reader) };
      }
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    return timedOut
      ? timeout()
      : { ok: false, reason: describeError(error), canFallBack: canFallBackFrom(error) };
  } finally {
    clearTimeout(timer);
  }
}

export interface ChatStreamRequest {
  system: string;
  messages: UIMessage[];
}

/**
 * The single entry point: streams a chat completion, transparently falling back
 * down the provider chain. The returned Response is byte-for-byte the shape the
 * existing frontend already consumes.
 *
 * Fallback only covers failures that happen before the first token. Once a
 * provider starts streaming, its output is already on the wire and a mid-stream
 * failure surfaces to the client as it did before.
 *
 * @throws {NoProvidersConfiguredError} when no provider has a key
 * @throws {AllProvidersFailedError} when every configured provider failed
 */
export async function streamChatWithFallback(req: ChatStreamRequest): Promise<Response> {
  return createUIMessageStreamResponse({ stream: await streamChatBody(req) });
}

/**
 * The same provider-fallback walk, but it returns the raw UI-message stream
 * instead of a Response. A caller can then forward it and merge extra parts
 * (e.g. follow-up suggestions) into the same stream before responding, without
 * a second request or any change to how the model is chosen.
 *
 * @throws {NoProvidersConfiguredError} when no provider has a key
 * @throws {AllProvidersFailedError} when every configured provider failed
 */
export async function streamChatBody({
  system,
  messages,
}: ChatStreamRequest): Promise<ReadableStream<UIMessageChunk>> {
  const chain = resolveProviderChain();
  if (chain.length === 0) throw new NoProvidersConfiguredError();

  const failures: ProviderFailure[] = [];

  for (const provider of chain) {
    const attempt = await attemptProvider(provider, system, messages);

    if (attempt.ok) {
      const via = failures.length
        ? ` (fell back from ${failures.map((f) => f.provider).join(" → ")})`
        : "";
      log(`answering with ${provider.id} · ${provider.modelId}${via}`);
      return attempt.stream;
    }

    failures.push({ provider: provider.id, modelId: provider.modelId, reason: attempt.reason });

    if (!attempt.canFallBack) {
      log(`${provider.id} failed and the error is not recoverable elsewhere — ${attempt.reason}`);
      break;
    }

    const next = chain[chain.indexOf(provider) + 1];
    log(
      `${provider.id} · ${provider.modelId} failed — ${attempt.reason}` +
        (next ? ` · falling back to ${next.id}` : " · no providers left"),
    );
  }

  throw new AllProvidersFailedError(failures);
}
