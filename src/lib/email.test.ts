import { describe, expect, it } from "vitest";
import { deliverPasswordResetEmail } from "./email";

const RESET = { to: "fred@example.com", url: "https://s.example.com/reset" };

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

describe("deliverPasswordResetEmail", () => {
  it("logs the link (and sends nothing) when RESEND_API_KEY is unset", async () => {
    const { fn, calls } = fetchStub({});
    const logged: string[] = [];
    await deliverPasswordResetEmail(RESET, {
      env: { RESEND_API_KEY: undefined, EMAIL_FROM: undefined },
      fetchFn: fn,
      log: (m) => logged.push(m),
    });
    expect(calls).toHaveLength(0);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(RESET.to);
    expect(logged[0]).toContain(RESET.url);
  });

  it("posts to Resend with the configured key and from address", async () => {
    const { fn, calls } = fetchStub({});
    await deliverPasswordResetEmail(RESET, {
      env: {
        RESEND_API_KEY: "re_123",
        EMAIL_FROM: "Sidetrack <no-reply@sidetrack.it>",
      },
      fetchFn: fn,
      log: () => {},
    });
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
    await expect(
      deliverPasswordResetEmail(RESET, {
        env: { RESEND_API_KEY: "re_123", EMAIL_FROM: "bad" },
        fetchFn: fn,
        log: () => {},
      }),
    ).rejects.toThrow(/Resend rejected.*422.*invalid from/);
  });
});
