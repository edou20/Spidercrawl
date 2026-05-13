import { logger } from "./logger.js";

/**
 * Sends email via Resend when RESEND_API_KEY and FROM_EMAIL are set.
 * No-op if not configured.
 */
export async function sendTransactionalEmail(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.FROM_EMAIL?.trim();
  if (!key || !from) return;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, text }, "Resend email send failed");
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, "Resend email send threw");
  }
}
