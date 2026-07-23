import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  checkResetOtp,
  OtpUnavailableError,
  resetPasswordWithOtp,
  sendResetOtp,
} from "@/lib/auth/client";
import { AuthField, AuthShell } from "@/components/auth/auth-shell";
import { BRAND, FOCUS_RING } from "@/components/admin/theme";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

/** Seconds a user must wait before the service will send another code. */
const RESEND_COOLDOWN = 60;
const OTP_LENGTH = 6;
const MIN_PASSWORD = 8;

type Step = "email" | "verify" | "reset" | "done";

/**
 * Code-based password reset.
 *
 * The whole secret path — generating the one-time code, emailing it, storing it
 * with an expiry, rate-limiting requests, spending it once, and hashing the new
 * password — is owned by Neon Auth. This page only walks the user through the
 * three steps and never sees or stores the code itself. State lives in memory,
 * so a refresh safely restarts the flow rather than leaving a code lying around.
 */
function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");

  return (
    <AuthShell>
      {step === "email" && (
        <EmailStep
          email={email}
          setEmail={setEmail}
          onSent={() => {
            setOtp("");
            setStep("verify");
          }}
        />
      )}
      {step === "verify" && (
        <VerifyStep
          email={email}
          otp={otp}
          setOtp={setOtp}
          onVerified={() => setStep("reset")}
          onBack={() => setStep("email")}
        />
      )}
      {step === "reset" && (
        <ResetStep
          email={email}
          otp={otp}
          onDone={() => setStep("done")}
          onBadCode={() => {
            setOtp("");
            setStep("verify");
          }}
        />
      )}
      {step === "done" && <DoneStep />}
    </AuthShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 1 — request a code                                                     */
/* -------------------------------------------------------------------------- */

function EmailStep({
  email,
  setEmail,
  onSent,
}: {
  email: string;
  setEmail: (v: string) => void;
  onSent: () => void;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await sendResetOtp(email.trim());
      // Neutral by design: whether or not the address exists, we advance to the
      // code step. The service is the only thing that knows if an email went out.
      onSent();
    } catch (e) {
      setError(
        e instanceof OtpUnavailableError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not send the code",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <StepHeader
        icon={KeyRound}
        title="Forgot your password?"
        subtitle="Enter your registered email and we'll send you a 6-digit verification code."
      />

      <form onSubmit={onSubmit} className="mt-7 space-y-5">
        <AuthField id="reset-email" label="Email address" icon={Mail}>
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
        </AuthField>

        <ErrorNote error={error} />

        <Button
          type="submit"
          disabled={submitting || !email}
          className="h-11 w-full gap-2 text-white shadow-[-4px_4px_12px_-2px_rgba(21,36,61,0.35)] transition hover:brightness-110"
          style={{ background: BRAND }}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Send verification code
        </Button>

        <BackToSignIn onClick={() => navigate({ to: "/login" })} />
      </form>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 2 — enter the code                                                     */
/* -------------------------------------------------------------------------- */

function VerifyStep({
  email,
  otp,
  setOtp,
  onVerified,
  onBack,
}: {
  email: string;
  otp: string;
  setOtp: (v: string) => void;
  onVerified: () => void;
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [resending, setResending] = useState(false);
  const [resentNote, setResentNote] = useState<string | null>(null);

  // Count the resend cooldown down to zero. Starts running as soon as the step
  // mounts, because a code was just sent to get here.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (otp.length < OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code.`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await checkResetOtp(email, otp);
      if (result === "invalid") {
        setError("That code is invalid or has expired. Request a new one below.");
        return;
      }
      // Valid — advance. The code is definitively verified and spent when the
      // password is set in the final step.
      onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify the code");
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setResentNote(null);
    try {
      await sendResetOtp(email);
      setOtp("");
      setCooldown(RESEND_COOLDOWN);
      setResentNote("A new code is on its way if the account exists.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resend the code");
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <StepHeader
        icon={ShieldCheck}
        title="Enter verification code"
        subtitle={
          <>
            We sent a {OTP_LENGTH}-digit code to{" "}
            <span className="font-medium text-slate-700 dark:text-slate-200">{email}</span>. It
            expires shortly.
          </>
        }
      />

      <form onSubmit={onSubmit} className="mt-7 space-y-5">
        <div className="flex justify-center">
          <InputOTP
            maxLength={OTP_LENGTH}
            value={otp}
            onChange={setOtp}
            inputMode="numeric"
            autoFocus
            containerClassName="gap-2"
          >
            <InputOTPGroup className="gap-2">
              {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="h-12 w-11 rounded-lg border-slate-200 text-lg dark:border-white/10"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <ErrorNote error={error} />
        {resentNote && !error && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
            {resentNote}
          </p>
        )}

        <Button
          type="submit"
          disabled={submitting || otp.length < OTP_LENGTH}
          className="h-11 w-full gap-2 text-white shadow-[-4px_4px_12px_-2px_rgba(21,36,61,0.35)] transition hover:brightness-110"
          style={{ background: BRAND }}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          Verify code
        </Button>

        <div className="text-center text-sm text-slate-500 dark:text-slate-400">
          Didn’t get it?{" "}
          <button
            type="button"
            onClick={onResend}
            disabled={cooldown > 0 || resending}
            className={`rounded font-medium text-[#2b6cf3] hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline dark:disabled:text-slate-500 ${FOCUS_RING}`}
          >
            {resending
              ? "Resending…"
              : cooldown > 0
                ? `Resend code in ${cooldown}s`
                : "Resend code"}
          </button>
        </div>

        <BackToSignIn label="Use a different email" onClick={onBack} />
      </form>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 3 — set a new password                                                 */
/* -------------------------------------------------------------------------- */

function ResetStep({
  email,
  otp,
  onDone,
  onBadCode,
}: {
  email: string;
  otp: string;
  onDone: () => void;
  onBadCode: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const s = strength(password);
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && password !== confirm;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await resetPasswordWithOtp(email, otp, password);
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not reset your password";
      // An invalid/expired code can only be discovered here (it is spent atomically
      // with the reset). Send the user back to re-enter or resend a fresh one.
      if (/invalid|expired/i.test(msg)) {
        setError(msg);
        setTimeout(onBadCode, 1200);
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <StepHeader
        icon={Lock}
        title="Set a new password"
        subtitle="Choose a strong password you don't use elsewhere."
      />

      <form onSubmit={onSubmit} className="mt-7 space-y-5">
        <AuthField id="new-password" label="New password" icon={Lock}>
          <Input
            id="new-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-11 pl-10 pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className={`absolute right-3 top-1/2 -translate-y-1/2 rounded text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-300 ${FOCUS_RING}`}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </AuthField>

        {password.length > 0 && <StrengthMeter score={s.score} label={s.label} />}

        <AuthField id="confirm-password" label="Confirm new password" icon={Lock}>
          <Input
            id="confirm-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            className="h-11 pl-10"
          />
        </AuthField>

        {(tooShort || mismatch) && !error && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {tooShort ? `Use at least ${MIN_PASSWORD} characters.` : "The passwords do not match."}
          </p>
        )}

        <ErrorNote error={error} />

        <Button
          type="submit"
          disabled={submitting || password.length < MIN_PASSWORD || password !== confirm}
          className="h-11 w-full gap-2 text-white shadow-[-4px_4px_12px_-2px_rgba(21,36,61,0.35)] transition hover:brightness-110"
          style={{ background: BRAND }}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          Reset password
        </Button>
      </form>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 4 — success                                                            */
/* -------------------------------------------------------------------------- */

function DoneStep() {
  const navigate = useNavigate();
  const [seconds, setSeconds] = useState(4);
  const done = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((n) => (n <= 1 ? 0 : n - 1)), 1000);
    const go = setTimeout(() => {
      if (!done.current) {
        done.current = true;
        void navigate({ to: "/login" });
      }
    }, 4000);
    return () => {
      clearInterval(tick);
      clearTimeout(go);
    };
  }, [navigate]);

  return (
    <div className="text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
      </span>
      <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">
        Password reset
      </h2>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        Your password has been updated. Redirecting you to sign in
        {seconds > 0 ? ` in ${seconds}s` : "…"}
      </p>
      <Button
        onClick={() => navigate({ to: "/login" })}
        className="mt-6 h-11 w-full gap-2 text-white"
        style={{ background: BRAND }}
      >
        Go to sign in
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                 */
/* -------------------------------------------------------------------------- */

function StepHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b6cf3]/10">
        <Icon className="h-6 w-6 text-[#2b6cf3]" />
      </span>
      <h2 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">
        {title}
      </h2>
      <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        {subtitle}
      </p>
    </div>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
    >
      {error}
    </p>
  );
}

function BackToSignIn({
  onClick,
  label = "Back to sign in",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="h-11 w-full gap-2 text-slate-500"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Button>
  );
}

/** Four-segment strength meter. score is 0–4; anything under MIN_PASSWORD reads weak. */
function StrengthMeter({ score, label }: { score: number; label: string }) {
  const colors = ["bg-red-500", "bg-amber-500", "bg-yellow-500", "bg-emerald-500"];
  const active = colors[Math.max(0, Math.min(colors.length - 1, score - 1))];
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i < score ? active : "bg-slate-200 dark:bg-white/10"}`}
          />
        ))}
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">Password strength: {label}</p>
    </div>
  );
}

/** A simple, honest strength score: length plus character variety. */
function strength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "—" };
  let score = 0;
  if (pw.length >= MIN_PASSWORD) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < MIN_PASSWORD) score = Math.min(score, 1);
  const label = ["Too short", "Weak", "Fair", "Good", "Strong"][score] ?? "Weak";
  return { score, label };
}
