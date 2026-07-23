import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth/client";
import { AuthField, AuthShell } from "@/components/auth/auth-shell";
import { BRAND, FOCUS_RING, TILE_GRADIENT } from "@/components/admin/theme";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

/**
 * Sign-in for the admin console.
 *
 * Built from the project's own components rather than Neon Auth's bundled UI kit,
 * so it reads as the same product as the dashboard it leads into. The forgot-
 * password link leads to the dedicated code-based reset flow at /forgot-password.
 */
function LoginPage() {
  return (
    <AuthShell>
      <SignInForm />
    </AuthShell>
  );
}

function SignInForm() {
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
        <AuthField id="email" label="Email address" icon={Mail}>
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
        </AuthField>

        <AuthField id="password" label="Password" icon={Lock}>
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
        </AuthField>

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
            onClick={() => navigate({ to: "/forgot-password" })}
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
        Accounts are created by an administrator.
      </p>
    </>
  );
}
