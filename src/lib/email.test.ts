import { describe, expect, it } from "vitest";
import {
  deliverInviteEmail,
  deliverJoinInviteEmail,
  deliverPasswordResetEmail,
  deliverSignupNotificationEmail,
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

describe("deliverJoinInviteEmail", () => {
  const sent = async (invite: Partial<Parameters<typeof deliverJoinInviteEmail>[0]>) => {
    const smtp = smtpStub();
    await deliverJoinInviteEmail(
      { to: "jo@example.com", inviterName: "Fred", url: "https://x.test/invite/tok", places: [], within: null, days: 30, ...invite },
      { env: { ...noEnv, SMTP_URL: "smtp://localhost:1025" }, fetchFn: fetchStub({}).fn, log: () => {}, sendSmtp: smtp.fn },
    );
    return smtp.calls[0].message;
  };

  it("says whose day they're invited to see, with the link on its own line", async () => {
    const { to, subject, text } = await sent({ places: ["Home", "Life"], within: "week" });
    expect(to).toBe("jo@example.com");
    expect(subject).toBe("Fred wants to share their week with you");
    expect(text).toContain("what they're getting done this week");
    expect(text).toContain("\n\nJoin here: https://x.test/invite/tok\n\n");
    expect(text).toContain("works for 30 days");
  });

  it("invites a friend to join without saying anything is shared", async () => {
    const { subject, text } = await sent({});
    expect(subject).toBe("Fred invited you to Sidetrack");
    expect(text).toMatch(/^Fred invited you to join them on Sidetrack\./);
    expect(text).not.toMatch(/share/);
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

  it("says a space invite is to a space, not a list", async () => {
    const smtp = smtpStub();
    await deliverInviteEmail(
      { ...INVITE, projectName: "Household", kind: "space" },
      {
        env: { ...noEnv, SMTP_URL: "smtp://localhost:1025" },
        fetchFn: fetchStub({}).fn,
        log: () => {},
        sendSmtp: smtp.fn,
      },
    );
    const { subject, text } = smtp.calls[0].message;
    expect(subject).toBe("Fred invited you to a Sidetrack space");
    expect(text).toContain('join the space "Household"');
  });

  it("says when they'll only view or comment, and not for an editor", async () => {
    const text = async (role: "viewer" | "commenter" | "editor") => {
      const smtp = smtpStub();
      await deliverInviteEmail(
        { ...INVITE, role },
        {
          env: { ...noEnv, SMTP_URL: "smtp://localhost:1025" },
          fetchFn: fetchStub({}).fn,
          log: () => {},
          sendSmtp: smtp.fn,
        },
      );
      return smtp.calls[0].message.text;
    };
    expect(await text("viewer")).toContain('"Engineering" in Sidetrack, as a viewer.');
    expect(
      await (async () => {
        const smtp = smtpStub();
        await deliverInviteEmail(
          { ...INVITE, role: "viewer", onlyMine: true },
          { env: { ...noEnv, SMTP_URL: "smtp://localhost:1025" }, fetchFn: fetchStub({}).fn, log: () => {}, sendSmtp: smtp.fn },
        );
        return smtp.calls[0].message.text;
      })(),
    ).toContain(`"Engineering" in Sidetrack, as a viewer of ${INVITE.inviterName}'s items.`);
    expect(
      await (async () => {
        const smtp = smtpStub();
        await deliverInviteEmail(
          { ...INVITE, role: "commenter", onlyMine: true, within: "today" },
          { env: { ...noEnv, SMTP_URL: "smtp://localhost:1025" }, fetchFn: fetchStub({}).fn, log: () => {}, sendSmtp: smtp.fn },
        );
        return smtp.calls[0].message.text;
      })(),
    ).toContain(`"Engineering" in Sidetrack, as a commenter of ${INVITE.inviterName}'s day.`);
    expect(await text("commenter")).toContain("as a commenter.");
    expect(await text("editor")).toContain('collaborate on "Engineering"');
    expect(await text("editor")).not.toContain(" as ");
  });

  it("names every place one invite covers, and what they'll do in each", async () => {
    const smtp = smtpStub();
    await deliverInviteEmail(
      {
        ...INVITE,
        places: [
          { name: "Home", kind: "list", role: "editor" },
          { name: "Health", kind: "list", role: "viewer" },
          { name: "Family", kind: "space", role: "commenter" },
        ],
      },
      {
        env: { ...noEnv, SMTP_URL: "smtp://localhost:1025" },
        fetchFn: fetchStub({}).fn,
        log: () => {},
        sendSmtp: smtp.fn,
      },
    );
    const { subject, text } = smtp.calls[0].message;
    expect(subject).toBe(`${INVITE.inviterName} invited you to Sidetrack`);
    expect(text).toContain(
      `invited you to "Home", "Health" (as a viewer) and "Family" (a space, as a commenter) in Sidetrack.`,
    );
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

describe("deliverSignupNotificationEmail", () => {
  it("emails the operator, not the new user, naming who signed up", async () => {
    const { fn } = fetchStub({});
    const smtp = smtpStub();
    await deliverSignupNotificationEmail(
      { to: "fred@example.com", name: "Ada", email: "ada@example.com", username: "ada", userNumber: 42 },
      { env: { ...noEnv, SMTP_URL: "smtp://localhost:1025" }, fetchFn: fn, log: () => {}, sendSmtp: smtp.fn },
    );
    expect(smtp.calls).toHaveLength(1);
    expect(smtp.calls[0].message.to).toBe("fred@example.com");
    expect(smtp.calls[0].message.subject).toBe("Sidetrack signup #42: Ada");
    expect(smtp.calls[0].message.text).toContain("ada@example.com");
    expect(smtp.calls[0].message.text).toContain("@ada");
    expect(smtp.calls[0].message.text).toContain("User #42");
    expect(smtp.calls[0].message.replyTo).toBe("ada@example.com");
  });

  it("sets the new user as reply-to over Resend too", async () => {
    const { fn, calls } = fetchStub({});
    await deliverSignupNotificationEmail(
      { to: "fred@example.com", name: "Ada", email: "ada@example.com", username: null, userNumber: 2 },
      {
        env: { ...noEnv, RESEND_API_KEY: "re_test", EMAIL_FROM: "Sidetrack <hi@example.com>" },
        fetchFn: fn,
        log: () => {},
        sendSmtp: smtpStub().fn,
      },
    );
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.to).toEqual(["fred@example.com"]);
    expect(body.reply_to).toBe("ada@example.com");
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
