import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Send,
  Paperclip,
  Mic,
  Plus,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  FileText,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

const BRAND = "#15243D";
const BRAND_2 = "#22375f";

const SUGGESTIONS = [
  { icon: "🌴", title: "Leave policy", q: "What is the company's leave policy?" },
  { icon: "🕒", title: "Working hours", q: "What are the working hours?" },
  { icon: "🛡️", title: "Harassment complaints", q: "How does the company handle harassment complaints?" },
  { icon: "📘", title: "Code of conduct", q: "What is the code of conduct?" },
];

const THINKING_PHASES = [
  "Analyzing policy…",
  "Searching knowledge…",
  "Preparing answer…",
];

/* ---------- sound engine (WebAudio, no assets) ---------- */
function useSounds(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = () => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const AC =
        (window.AudioContext as typeof AudioContext | undefined) ||
        // @ts-expect-error webkit
        (window.webkitAudioContext as typeof AudioContext | undefined);
      if (AC) ctxRef.current = new AC();
    }
    return ctxRef.current;
  };
  const play = useCallback(
    (freq: number, duration = 0.08, type: OscillatorType = "sine", gain = 0.04) => {
      if (!enabled) return;
      const ctx = getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    },
    [enabled],
  );
  return {
    send: () => play(520, 0.06, "triangle", 0.05),
    start: () => play(720, 0.09, "sine", 0.035),
    done: () => {
      play(660, 0.08, "sine", 0.04);
      setTimeout(() => play(880, 0.09, "sine", 0.04), 70);
    },
    hover: () => play(1200, 0.02, "sine", 0.015),
  };
}

/* ---------- typewriter reveal ---------- */
function useTypewriter(full: string, active: boolean) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(full);
  const idxRef = useRef(0);
  useEffect(() => {
    if (!active || reduce) {
      setShown(full);
      idxRef.current = full.length;
      return;
    }
    if (full.length < idxRef.current) idxRef.current = 0;
    let raf = 0;
    let last = performance.now();
    const step = (t: number) => {
      const delta = t - last;
      const chars = Math.max(1, Math.floor(delta / 12)); // ~80 chars/sec
      idxRef.current = Math.min(full.length, idxRef.current + chars);
      setShown(full.slice(0, idxRef.current));
      last = t;
      if (idxRef.current < full.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [full, active, reduce]);
  return active && !reduce ? shown : full;
}

function renderText(message: UIMessage): string {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/* ---------- component ---------- */
function Index() {
  const [input, setInput] = useState("");
  const [dark, setDark] = useState(false);
  const [sound, setSound] = useState(false);
  const sounds = useSounds(sound);
  const reduce = useReducedMotion();

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isLoading = status === "submitted" || status === "streaming";
  const wasLoading = useRef(false);

  useEffect(() => {
    if (dark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [dark]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [messages, status, reduce]);

  useEffect(() => {
    if (!isLoading) inputRef.current?.focus();
    if (wasLoading.current && !isLoading) sounds.done();
    if (!wasLoading.current && isLoading) sounds.start();
    wasLoading.current = isLoading;
  }, [isLoading, sounds]);

  // autosize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(160, el.scrollHeight) + "px";
  }, [input]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || isLoading) return;
    sounds.send();
    void sendMessage({ text: t });
    setInput("");
  };

  const newChat = () => {
    setMessages([]);
    setInput("");
    sounds.send();
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[linear-gradient(180deg,#F5F7FA_0%,#FFFFFF_60%)] dark:bg-[linear-gradient(180deg,#0b1220_0%,#0f172a_60%)]">
      {/* floating blobs */}
      <BlobBackground reduce={!!reduce} />

      <Header
        dark={dark}
        setDark={setDark}
        sound={sound}
        setSound={setSound}
        onNewChat={newChat}
        onHover={sounds.hover}
      />

      <main className="flex flex-1 flex-col">
        <div ref={scrollRef} className="flex-1">
          <div className="mx-auto w-full max-w-[1200px] px-4 pb-40 pt-8 sm:px-8 sm:pt-12">
            {messages.length === 0 ? (
              <Welcome onPick={submit} onHover={sounds.hover} />
            ) : (
              <div className="space-y-6">
                <AnimatePresence initial={false}>
                  {messages.map((m, i) => (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      isStreaming={isLoading && i === messages.length - 1 && m.role === "assistant"}
                    />
                  ))}
                </AnimatePresence>
                {status === "submitted" && <ThinkingIndicator />}
                {error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
                    Something went wrong. Please try again.
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>
      </main>

      <Composer
        input={input}
        setInput={setInput}
        onSubmit={() => submit(input)}
        isLoading={isLoading}
        inputRef={inputRef}
        onHover={sounds.hover}
      />
    </div>
  );
}

/* ---------- header ---------- */
function Header({
  dark,
  setDark,
  sound,
  setSound,
  onNewChat,
  onHover,
}: {
  dark: boolean;
  setDark: (v: boolean) => void;
  sound: boolean;
  setSound: (v: boolean) => void;
  onNewChat: () => void;
  onHover: () => void;
}) {
  return (
    <header
      className="sticky top-0 z-40 h-[72px] border-b border-white/10 backdrop-blur-xl"
      style={{
        background: `linear-gradient(90deg, ${BRAND} 0%, ${BRAND_2} 100%)`,
        boxShadow: "0 8px 24px -12px rgba(21,36,61,0.4)",
      }}
    >
      <div className="flex h-full w-full items-center justify-between px-5 sm:px-10">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            whileHover={{ rotate: 3, scale: 1.05 }}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-xl font-black text-white shadow-lg"
            style={{
              background: "linear-gradient(135deg, #2b4a82 0%, #15243D 100%)",
              boxShadow: "0 6px 18px -4px rgba(43,74,130,0.6), inset 0 1px 0 rgba(255,255,255,0.15)",
            }}
          >
            D
          </motion.div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-white sm:text-base">
              Ask the Digit
            </div>
            <div className="text-[11px] text-white/60 sm:text-xs">Knowledge Interface</div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/85 md:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Knowledge Base Connected
          </div>
          <IconBtn onClick={() => setSound(!sound)} onHover={onHover} label="Toggle sound">
            {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </IconBtn>
          <IconBtn onClick={() => setDark(!dark)} onHover={onHover} label="Toggle theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconBtn>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            onMouseEnter={onHover}
            onClick={onNewChat}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-semibold text-[#15243D] shadow-md transition hover:shadow-lg sm:px-4 sm:text-sm"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Chat</span>
          </motion.button>
        </div>
      </div>
    </header>
  );
}

function IconBtn({
  children,
  onClick,
  onHover,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  onHover: () => void;
  label: string;
}) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.95 }}
      onMouseEnter={onHover}
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/85 transition hover:bg-white/10"
    >
      {children}
    </motion.button>
  );
}

/* ---------- welcome ---------- */
function Welcome({ onPick, onHover }: { onPick: (q: string) => void; onHover: () => void }) {
  const subtitle = useTypewriter("Knowledge Interface", true);
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center text-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs text-slate-600 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
      >
        <Sparkles className="h-3.5 w-3.5" style={{ color: BRAND }} />
        DIGIT WEB LANKA · Policy AI
      </motion.div>
      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white"
        style={{ letterSpacing: "-0.02em" }}
      >
        Ask the Digit
      </motion.h1>
      <div className="mt-2 h-6 text-base text-slate-500 sm:text-lg dark:text-slate-400">
        {subtitle}
        <span className="ml-0.5 inline-block w-[2px] animate-pulse bg-slate-400">&nbsp;</span>
      </div>
      <p className="mt-4 max-w-md text-sm text-slate-500 dark:text-slate-400">
        Ask anything about Digit Web Lanka policies. Every answer is grounded in the official manual.
      </p>

      <div className="mt-10 grid w-full gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s.q}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 + i * 0.06 }}
            whileHover={{ y: -3 }}
            onMouseEnter={onHover}
            onClick={() => onPick(s.q)}
            className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/80 p-4 text-left shadow-sm backdrop-blur transition hover:border-slate-300 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
          >
            <div className="text-xl">{s.icon}</div>
            <div>
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {s.title}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{s.q}</div>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/* ---------- messages ---------- */
function MessageBubble({
  message,
  isStreaming,
}: {
  message: UIMessage;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";
  const text = renderText(message);
  const shown = useTypewriter(text, !isUser && isStreaming);

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex justify-end"
      >
        <div
          className="max-w-[80%] rounded-2xl rounded-tr-md px-5 py-3 text-sm leading-relaxed text-white shadow-md"
          style={{
            background: `linear-gradient(135deg, #2b4a82 0%, ${BRAND} 100%)`,
          }}
        >
          {text}
        </div>
      </motion.div>
    );
  }

  const sources = extractSources(text);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex gap-3"
    >
      <div
        className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black text-white shadow"
        style={{ background: `linear-gradient(135deg, #2b4a82 0%, ${BRAND} 100%)` }}
      >
        D
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
        <div className="prose prose-sm max-w-none leading-[1.7] text-slate-800 dark:prose-invert dark:text-slate-100">
          <ReactMarkdown>{shown || "…"}</ReactMarkdown>
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 animate-pulse bg-slate-500 align-middle dark:bg-slate-300" />
          )}
        </div>

        {sources.length > 0 && !isStreaming && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-white/10">
            {sources.map((s, i) => (
              <motion.div
                key={i}
                whileHover={{ y: -2 }}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 shadow-sm transition hover:shadow dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
              >
                <FileText className="h-3.5 w-3.5" style={{ color: BRAND }} />
                <span className="font-medium">{s.label}</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  High
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function extractSources(text: string): { label: string }[] {
  const out: { label: string }[] = [];
  const seen = new Set<string>();

  // Only scan the "## Sources" section so body prose can't produce chips.
  const idx = text.search(/^#{1,6}\s*Sources\s*$/im);
  if (idx === -1) return out;

  // Cited headings look like `> "### 6.1 General Leave Guidelines"` — a numbered
  // manual heading, optionally wrapped in blockquote/quote/hash markers.
  const re = /^[>\s"']*#{0,6}\s*(\d{1,2}(?:\.\d{1,2})*)\s+([A-Za-z][^"'\n]*?)["']?\s*$/;
  for (const line of text.slice(idx).split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    const label = `${m[1]} ${m[2].trim()}`;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label });
    if (out.length >= 6) break;
  }
  return out;
}

/* ---------- thinking ---------- */
function ThinkingIndicator() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % THINKING_PHASES.length), 2000);
    return () => clearInterval(t);
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
    >
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: BRAND }}
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.span
          key={phase}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
        >
          {THINKING_PHASES[phase]}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

/* ---------- composer ---------- */
function Composer({
  input,
  setInput,
  onSubmit,
  isLoading,
  inputRef,
  onHover,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onHover: () => void;
}) {
  const canSend = !!input.trim() && !isLoading;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5 sm:pb-6">
      <div className="pointer-events-auto w-full" style={{ maxWidth: "min(1100px, 90%)" }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white/85 p-2 shadow-[0_20px_50px_-20px_rgba(21,36,61,0.35)] backdrop-blur-xl transition focus-within:border-slate-300 dark:border-white/10 dark:bg-slate-900/70"
        >
          <IconGhost disabled onHover={onHover} label="Attach">
            <Paperclip className="h-4 w-4" />
          </IconGhost>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            rows={1}
            placeholder="Ask about leave, conduct, working hours…"
            disabled={isLoading}
            className="max-h-[160px] min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <IconGhost disabled onHover={onHover} label="Voice">
            <Mic className="h-4 w-4" />
          </IconGhost>
          <motion.button
            whileHover={canSend ? { y: -1 } : undefined}
            whileTap={canSend ? { scale: 0.95 } : undefined}
            type="submit"
            disabled={!canSend}
            onMouseEnter={onHover}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition disabled:cursor-not-allowed"
            style={{
              background: canSend
                ? `linear-gradient(135deg, #2b6cf3 0%, #1e4fd6 100%)`
                : "#cbd5e1",
              boxShadow: canSend ? "0 8px 20px -8px rgba(43,108,243,0.6)" : "none",
            }}
          >
            <Send className="h-4 w-4" />
          </motion.button>
        </form>
        <p className="mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
          Answers grounded in the DIGIT WEB LANKA policy manual · Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}

function IconGhost({
  children,
  disabled,
  onHover,
  label,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onHover: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={onHover}
      aria-label={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-500 dark:hover:bg-white/5"
    >
      {children}
    </button>
  );
}

/* ---------- background blobs ---------- */
function BlobBackground({ reduce }: { reduce: boolean }) {
  const blobs = useMemo(
    () => [
      { c: "#2b6cf3", x: "10%", y: "20%", s: 420 },
      { c: BRAND, x: "80%", y: "10%", s: 380 },
      { c: "#22c55e", x: "70%", y: "80%", s: 340 },
    ],
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
      {blobs.map((b, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full blur-3xl"
          style={{
            left: b.x,
            top: b.y,
            width: b.s,
            height: b.s,
            background: b.c,
            opacity: 0.05,
          }}
          animate={
            reduce
              ? undefined
              : { x: [0, 30, -20, 0], y: [0, -20, 25, 0] }
          }
          transition={{ duration: 20 + i * 4, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}
