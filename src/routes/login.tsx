import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth/client";
import { BRAND, PAGE_BG, TILE_GRADIENT } from "@/components/admin/theme";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

/**
 * Sign-in for the admin area.
 *
 * Built from the project's own components rather than Neon Auth's bundled UI kit,
 * so it reads as the same product as the chat screen it sits beside.
 */
function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      await navigate({ to: "/admin" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`flex min-h-screen items-center justify-center px-4 ${PAGE_BG}`}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-sm"
      >
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl text-xl font-black text-white shadow-lg"
            style={{
              background: TILE_GRADIENT,
              boxShadow:
                "0 6px 18px -4px rgba(43,74,130,0.6), inset 0 1px 0 rgba(255,255,255,0.15)",
            }}
          >
            D
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Ask the Digit
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Admin sign in</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-slate-200 bg-white/85 p-6 shadow-[0_20px_50px_-20px_rgba(21,36,61,0.35)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70"
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@digitweb.lk"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={isSubmitting || !email || !password}
              className="w-full text-white"
              style={{ background: BRAND }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  Sign in
                </>
              )}
            </Button>
          </div>
        </form>

        <p className="mt-4 text-center text-[11px] text-slate-400 dark:text-slate-500">
          Staff accounts are created by an administrator.
        </p>
      </motion.div>
    </div>
  );
}
