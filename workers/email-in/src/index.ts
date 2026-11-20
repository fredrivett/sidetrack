import PostalMime from "postal-mime";

// Cloudflare Email Worker for Sidetrack's email in. Email Routing hands every
// email sent to *@<EMAIL_IN_DOMAIN> to this Worker, which parses it and posts
// the text to Sidetrack's /api/email/inbound, signed with EMAIL_IN_SECRET.
// Sidetrack answers 404 for an address nobody has, and the email is bounced.

interface Env {
  /** Sidetrack's origin, such as https://sidetrack.it. */
  SIDETRACK_URL: string;
  /** The secret Sidetrack's EMAIL_IN_SECRET is set to. */
  EMAIL_IN_SECRET: string;
}

/** Most of an email's text that's sent; Sidetrack keeps at most this much. */
const MAX_TEXT = 20_000;

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A rough plain-text version of an HTML-only email.
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const email = await PostalMime.parse(message.raw);
    const date = email.date ? Date.parse(email.date) : NaN;
    const body = JSON.stringify({
      to: message.to,
      from: {
        address: email.from?.address || message.from,
        name: email.from?.name || null,
      },
      // Without a Message-ID a retried delivery can't be recognised; rare.
      messageId: email.messageId || `<${crypto.randomUUID()}@email-in>`,
      subject: email.subject ?? "",
      text: (email.text?.trim() || htmlToText(email.html ?? "")).slice(0, MAX_TEXT),
      sentAt: Number.isNaN(date) ? null : date,
    });
    const timestamp = String(Date.now());
    const res = await fetch(new URL("/api/email/inbound", env.SIDETRACK_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sidetrack-timestamp": timestamp,
        "x-sidetrack-signature": `sha256=${await sign(env.EMAIL_IN_SECRET, `${timestamp}.${body}`)}`,
      },
      body,
      // A redirect means the route isn't there (say, the login page before the
      // server has email in): fail rather than count the login page as stored.
      redirect: "manual",
    });
    if (res.status === 404) {
      message.setReject("No such Sidetrack address");
      return;
    }
    // Throwing fails the delivery, so the email isn't silently lost.
    if (!res.ok) throw new Error(`Sidetrack answered ${res.status}: ${await res.text()}`);
  },
} satisfies ExportedHandler<Env>;
