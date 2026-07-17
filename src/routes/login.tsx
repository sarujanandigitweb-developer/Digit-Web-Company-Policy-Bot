import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset, signIn } from "@/lib/auth/client";
import { BRAND, CARD, FOCUS_RING, TILE_GRADIENT, TONE } from "@/components/admin/theme";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

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

/**
 * Sign-in for the admin console.
 *
 * Built from the project's own components rather than Neon Auth's bundled UI kit,
 * so it reads as the same product as the dashboard it leads into.
 */
function LoginPage() {
  const [mode, setMode] = useState<"signIn" | "reset">("signIn");
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
            <div className={`${CARD} w-full max-w-[420px] p-7 sm:p-8`}>
              {mode === "signIn" ? (
                <SignInForm onForgot={() => setMode("reset")} />
              ) : (
                <ResetForm onBack={() => setMode("signIn")} />
              )}
            </div>
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

function SignInForm({ onForgot }: { onForgot: () => void }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // remember is passed through: true persists the session for 7 days, false
      // ends it with the browser. Verified against the live auth service.
      await signIn(email, password, remember);
      await navigate({ to: "/admin" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Shown on mobile, where the brand panel is hidden. */}
      <div className="mb-6 flex items-center gap-3 lg:hidden">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black text-white"
          style={{ background: TILE_GRADIENT }}
        >
          D
        </div>
        <span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
          Ask the Digit
        </span>
      </div>

      <div className="text-center">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">
          Welcome back
        </h2>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
          Sign in to your admin account
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-7 space-y-5">
        <Field id="email" label="Email address" icon={Mail}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@digitweb.lk"
            className="h-11 pl-10"
          />
        </Field>

        <Field id="password" label="Password" icon={Lock}>
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-11 pl-10 pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className={`absolute right-3 top-1/2 -translate-y-1/2 rounded text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-300 ${FOCUS_RING}`}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </Field>

        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Checkbox
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
              aria-label="Keep me signed in for 7 days"
            />
            Remember me
          </label>
          <button
            type="button"
            onClick={onForgot}
            className={`rounded text-sm font-medium text-[#2b6cf3] hover:underline ${FOCUS_RING}`}
          >
            Forgot password?
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={isSubmitting || !email || !password}
          className="h-11 w-full gap-2 text-white shadow-[-4px_4px_12px_-2px_rgba(21,36,61,0.35)] transition hover:brightness-110"
          style={{ background: BRAND }}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Signing in…
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" />
              Sign in
            </>
          )}
        </Button>
      </form>

      <div className="mt-7 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Secure access
        </span>
        <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
      </div>

      <div className="mt-5 flex gap-3 rounded-xl bg-slate-50 p-3.5 dark:bg-white/[0.03]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#15243D]/[0.06] dark:bg-white/[0.06]">
          <ShieldCheck className="h-4 w-4 text-[#15243D] dark:text-[#8FB0E8]" />
        </span>
        {/* Describes what is actually true: TLS in transit, hashed credentials
            held by the auth service. No claim the product cannot back. */}
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Encrypted in transit. Credentials are hashed and held by the authentication service —
          never by this application.
        </p>
      </div>

      <p className="mt-5 text-center text-xs text-slate-400 dark:text-slate-500">
        Staff accounts are created by an administrator.
      </p>
    </>
  );
}

/**
 * Password reset request.
 *
 * The confirmation is deliberately identical whether or not the address exists —
 * a different message would let anyone enumerate registered accounts.
 */
function ResetForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email, `${window.location.origin}/login`);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the reset email");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10">
          <Mail className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        </span>
        <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">
          Check your inbox
        </h2>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          If an account exists for{" "}
          <span className="font-medium text-slate-700 dark:text-slate-200">{email}</span>, a reset
          link is on its way. The link expires shortly.
        </p>
        <Button variant="outline" onClick={onBack} className="mt-6 h-11 w-full gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="text-center">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">
          Reset your password
        </h2>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
          We’ll email you a link to set a new one.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-7 space-y-5">
        <Field id="reset-email" label="Email address" icon={Mail}>
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@digitweb.lk"
            className="h-11 pl-10"
          />
        </Field>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={isSubmitting || !email}
          className="h-11 w-full gap-2 text-white"
          style={{ background: BRAND }}
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Send reset link
        </Button>

        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="h-11 w-full gap-2 text-slate-500"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Button>
      </form>
    </>
  );
}

/** Label + icon-prefixed input. `relative` so the icon and toggle can sit inside. */
function Field({
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
