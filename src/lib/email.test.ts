import { describe, expect, it } from "vitest";
import {
  deliverInviteEmail,
  deliverPasswordResetEmail,
  redactSmtpUrl,
  type OutboundEmail,
} from "./email";

const RESET = { to: "fred@example.com", url: "https://s.example.com/reset" };
const INVITE = {
  to: "bob@example.com",
  inviterName: "Fred",
  projectName: "Engineering",
  url: "https://s.example.com",
};

function fetchStub(response: Partial<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: true,
      status: 200,
      text: async () => "",
      ...response,
    } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

function smtpStub() {
  const calls: { smtpUrl: string; message: OutboundEmail }[] = [];
  const fn = async (smtpUrl: string, message: OutboundEmail) => {
    calls.push({ smtpUrl, message });
  };
  return { fn, calls };
}

const noEnv = {
  SMTP_URL: undefined,
  RESEND_API_KEY: undefined,
  EMAIL_FROM: undefined,
};

describe("deliverPasswordResetEmail", () => {
  it("logs the link (and sends nothing) when no transport is configured", async () => {
    const { fn, calls } = fetchStub({});
    const smtp = smtpStub();
    const logged: string[] = [];
    await deliverPasswordResetEmail(RESET, {
      env: noEnv,
      fetchFn: fn,
      log: (m) => logged.push(m),
      sendSmtp: smtp.fn,
    });
    expect(calls).toHaveLength(0);
    expect(smtp.calls).toHaveLength(0);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(RESET.to);
    expect(logged[0]).toContain(RESET.url);
  });

  it("sends over SMTP when SMTP_URL is set, defaulting the from address", async () => {
    const { fn, calls } = fetchStub({});
    const smtp = smtpStub();
    await deliverPasswordResetEmail(RESET, {
      env: { ...noEnv, SMTP_URL: "smtp://localhost:1025" },
      fetchFn: fn,
      log: () => {},
      sendSmtp: smtp.fn,
    });
    expect(calls).toHaveLength(0); // never touches Resend
    expect(smtp.calls).toHaveLength(1);
    expect(smtp.calls[0].smtpUrl).toBe("smtp://localhost:1025");
    expect(smtp.calls[0].message.to).toBe(RESET.to);
    expect(smtp.calls[0].message.from).toBe(
      "Sidetrack <no-reply@sidetrack.local>",
    );
    expect(smtp.calls[0].message.text).toContain(RESET.url);
  });

  it("uses EMAIL_FROM over SMTP when one is provided", async () => {
    const { fn } = fetchStub({});
    const smtp = smtpStub();
    await deliverPasswordResetEmail(RESET, {
      env: {
        ...noEnv,
        SMTP_URL: "smtp://localhost:1025",
        EMAIL_FROM: "Custom <hi@example.com>",
      },
      fetchFn: fn,
      log: () => {},
      sendSmtp: smtp.fn,
    });
    expect(smtp.calls[0].message.from).toBe("Custom <hi@example.com>");
  });

  it("prefers SMTP over Resend so a stray key can't leak real mail in dev", async () => {
    const { fn, calls } = fetchStub({});
    const smtp = smtpStub();
    await deliverPasswordResetEmail(RESET, {
      env: {
        SMTP_URL: "smtp://localhost:1025",
        RESEND_API_KEY: "re_123",
        EMAIL_FROM: "Sidetrack <no-reply@sidetrack.it>",
      },
      fetchFn: fn,
      log: () => {},
      sendSmtp: smtp.fn,
    });
    expect(smtp.calls).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it("posts to Resend with the configured key and from address", async () => {
    const { fn, calls } = fetchStub({});
    const smtp = smtpStub();
    await deliverPasswordResetEmail(RESET, {
      env: {
        SMTP_URL: undefined,
        RESEND_API_KEY: "re_123",
        EMAIL_FROM: "Sidetrack <no-reply@sidetrack.it>",
      },
      fetchFn: fn,
      log: () => {},
      sendSmtp: smtp.fn,
    });
    expect(smtp.calls).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer re_123",
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.from).toBe("Sidetrack <no-reply@sidetrack.it>");
    expect(body.to).toEqual([RESET.to]);
    expect(body.text).toContain(RESET.url);
  });

  it("throws when Resend rejects the send", async () => {
    const { fn } = fetchStub({
      ok: false,
      status: 422,
      text: async () => "invalid from",
    });
    const smtp = smtpStub();
    await expect(
      deliverPasswordResetEmail(RESET, {
        env: { SMTP_URL: undefined, RESEND_API_KEY: "re_123", EMAIL_FROM: "bad" },
        fetchFn: fn,
        log: () => {},
        sendSmtp: smtp.fn,
      }),
    ).rejects.toThrow(/Resend rejected.*422.*invalid from/);
  });
});

describe("deliverInviteEmail", () => {
  it("logs the link (and sends nothing) when no transport is configured", async () => {
    const { fn, calls } = fetchStub({});
    const smtp = smtpStub();
    const logged: string[] = [];
    await deliverInviteEmail(INVITE, {
      env: noEnv,
      fetchFn: fn,
      log: (m) => logged.push(m),
      sendSmtp: smtp.fn,
    });
    expect(calls).toHaveLength(0);
    expect(smtp.calls).toHaveLength(0);
    expect(logged[0]).toContain(INVITE.to);
    expect(logged[0]).toContain(INVITE.url);
  });

  it("sends over SMTP, naming the inviter and project in the body", async () => {
    const { fn } = fetchStub({});
    const smtp = smtpStub();
    await deliverInviteEmail(INVITE, {
      env: { ...noEnv, SMTP_URL: "smtp://localhost:1025" },
      fetchFn: fn,
      log: () => {},
      sendSmtp: smtp.fn,
    });
    expect(smtp.calls).toHaveLength(1);
    expect(smtp.calls[0].message.to).toBe(INVITE.to);
    expect(smtp.calls[0].message.subject).toContain("Fred");
    expect(smtp.calls[0].message.text).toContain("Engineering");
    expect(smtp.calls[0].message.text).toContain(INVITE.url);
  });

  it("labels a Resend rejection as the invite email", async () => {
    const { fn } = fetchStub({
      ok: false,
      status: 422,
      text: async () => "bad",
    });
    const smtp = smtpStub();
    await expect(
      deliverInviteEmail(INVITE, {
        env: { SMTP_URL: undefined, RESEND_API_KEY: "re_123", EMAIL_FROM: "x" },
        fetchFn: fn,
        log: () => {},
        sendSmtp: smtp.fn,
      }),
    ).rejects.toThrow(/Resend rejected the invite email.*422/);
  });
});

describe("redactSmtpUrl", () => {
  it("keeps scheme and host:port", () => {
    expect(redactSmtpUrl("smtp://localhost:1025")).toBe("smtp://localhost:1025");
  });

  it("strips embedded credentials so they can't leak into logs", () => {
    const redacted = redactSmtpUrl("smtp://user:s3cret@mail.example.com:587");
    expect(redacted).toBe("smtp://mail.example.com:587");
    expect(redacted).not.toContain("s3cret");
    expect(redacted).not.toContain("user");
  });

  it("falls back to a generic label when the value isn't a URL", () => {
    expect(redactSmtpUrl("not a url")).toBe("the configured SMTP server");
  });
});
