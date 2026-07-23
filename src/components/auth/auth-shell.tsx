import { motion, useReducedMotion } from "framer-motion";
import { BarChart3, BookOpen, MessageSquare } from "lucide-react";
import { Label } from "@/components/ui/label";
import { CARD, TILE_GRADIENT, TONE } from "@/components/admin/theme";

/**
 * The shared visual shell for every unauthenticated page (sign in, forgot
 * password, verify code, reset password).
 *
 * Extracted so the whole auth flow is the same product as the login screen by
 * construction — one gradient, one brand panel, one card — rather than three
 * pages that merely try to look alike. Pages supply only their card contents.
 */

const FEATURES = [
  {
    icon: BookOpen,
    tone: "blue" as const,
    title: "Centralized Knowledge",
    body: "Access all policy documents, manuals, and company knowledge in one place.",
  },
  {
    icon: MessageSquare,
    tone: "emerald" as const,
    title: "AI-Powered Answers",
    body: "Get instant, grounded answers from your organization's knowledge base.",
  },
  {
    icon: BarChart3,
    tone: "violet" as const,
    title: "Smarter Insights",
    body: "Analytics and knowledge gaps to help your team document what matters.",
  },
];

export function AuthShell({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#F7F9FC_0%,#EEF2F8_100%)] dark:bg-[linear-gradient(135deg,#0b1220_0%,#0f172a_100%)]">
      <div className="relative mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 py-10">
        <div className="grid flex-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <BrandPanel reduce={!!reduce} />

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.05 }}
            className="w-full justify-self-center lg:justify-self-end"
          >
            <div className={`${CARD} w-full max-w-[420px] p-7 sm:p-8`}>{children}</div>
          </motion.div>
        </div>

        <footer className="pt-10 text-center text-xs text-slate-400 dark:text-slate-500">
          © {new Date().getFullYear()} Ask the Digit · DIGIT WEB LANKA. All rights reserved.
        </footer>
      </div>
    </div>
  );
}

function BrandPanel({ reduce }: { reduce: boolean }) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="hidden lg:block"
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-black text-white"
        style={{
          background: TILE_GRADIENT,
          boxShadow: "-4px 8px 20px -4px rgba(21,36,61,0.4), inset 0 1px 0 rgba(255,255,255,0.15)",
        }}
      >
        D
      </div>

      <h1 className="mt-7 text-[44px] font-bold leading-[1.05] tracking-[-0.03em] text-slate-900 dark:text-white">
        Ask the Digit
      </h1>
      <p className="mt-3 text-lg text-slate-500 dark:text-slate-400">
        Knowledge that <span className="font-medium text-[#2b6cf3]">answers</span>. Insights that{" "}
        <span className="font-medium text-[#2b6cf3]">empower</span>.
      </p>

      <div className="mt-9 h-px w-full max-w-md bg-gradient-to-r from-slate-200 to-transparent dark:from-white/10" />

      <ul className="mt-8 space-y-6">
        {FEATURES.map((f, i) => {
          const t = TONE[f.tone];
          return (
            <motion.li
              key={f.title}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.15 + i * 0.08 }}
              className="flex gap-4"
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${t.bg}`}
              >
                <f.icon className={`h-[18px] w-[18px] ${t.fg}`} />
              </span>
              <div className="max-w-sm">
                <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                  {f.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  {f.body}
                </p>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
}

/** Label + icon-prefixed input, shared by the auth forms. `relative` so the icon
 *  (and any trailing toggle the caller adds) can sit inside the field. */
export function AuthField({
  id,
  label,
  icon: Icon,
  children,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
        {label}
      </Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        {children}
      </div>
    </div>
  );
}
