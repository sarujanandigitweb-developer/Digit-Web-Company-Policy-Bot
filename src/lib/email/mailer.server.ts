import nodemailer, { type Transporter } from "nodemailer";
import { AppError } from "@/lib/http/errors";

/**
 * Outbound email over SMTP.
 *
 * Used only for password-reset codes today. Gmail is the intended provider:
 * SMTP_PASS is a 16-character App Password, not the account password. SMTP runs
 * over TCP, so any route that sends must run on a Node runtime, not edge.
 *
 * The transport is created once and reused — a fresh connection per email would
 * add a TLS handshake to every request and can trip Gmail's rate limits.
 */

let transport: Transporter | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AppError(500, "email_not_configured", `Email is not configured: ${name} is missing`);
  }
  return value;
}

function mailer(): Transporter {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT ?? 465);
  transport = nodemailer.createTransport({
    host: required("SMTP_HOST"),
    port,
    secure: port === 465, // 465 = implicit TLS; 587 negotiates STARTTLS
    auth: { user: required("SMTP_USER"), pass: required("SMTP_PASS") },
  });
  return transport;
}

function fromAddress(): string {
  return process.env.SMTP_FROM || `Ask the Digit <${required("SMTP_USER")}>`;
}

/** True when SMTP is configured — lets callers stay silent instead of 500-ing. */
export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** Sends the 6-digit reset code. Throws AppError(502) if SMTP rejects it. */
export async function sendResetCode(to: string, code: string, ttlMinutes: number): Promise<void> {
  try {
    await mailer().sendMail({
      from: fromAddress(),
      to,
      subject: `${code} is your password reset code`,
      text: resetText(code, ttlMinutes),
      html: resetHtml(code, ttlMinutes),
    });
  } catch (cause) {
    throw new AppError(502, "email_send_failed", "Could not send the reset email", {
      cause: String(cause),
    });
  }
}

function resetText(code: string, ttl: number): string {
  return [
    "Reset your Ask the Digit password",
    "",
    `Your verification code is: ${code}`,
    `It expires in ${ttl} minutes.`,
    "",
    "If you didn't request this, you can ignore this email — your password stays the same.",
  ].join("\n");
}

function resetHtml(code: string, ttl: number): string {
  const digits = code
    .split("")
    .map(
      (d) =>
        `<span style="display:inline-block;min-width:44px;margin:0 4px;padding:14px 0;` +
        `font-size:28px;font-weight:700;letter-spacing:2px;text-align:center;` +
        `border-radius:10px;background:#0f172a;color:#fff;">${d}</span>`,
    )
    .join("");
  return `
  <div style="margin:0;padding:32px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="padding:28px 32px 8px;">
        <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:#2b6cf3;">Ask the Digit</p>
        <h1 style="margin:6px 0 0;font-size:20px;color:#0f172a;">Reset your password</h1>
        <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#475569;">
          Enter this code to continue. It expires in ${ttl} minutes.
        </p>
      </div>
      <div style="padding:20px 32px;text-align:center;">${digits}</div>
      <div style="padding:0 32px 28px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">
          Didn't request this? You can safely ignore this email — your password won't change.
        </p>
      </div>
    </div>
  </div>`;
}
