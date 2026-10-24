import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  me: vi.fn(),
  setAuthTokenProvider: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/apiClient", () => ({
  api: { login: mocks.login, register: mocks.register, me: mocks.me },
  describeError: (error: unknown) =>
    error instanceof Error ? error.message : "Something unexpected went wrong. Please try again.",
  setAuthTokenProvider: mocks.setAuthTokenProvider,
  setUnauthorizedHandler: mocks.setUnauthorizedHandler,
}));

import { AuthProvider, SESSION_EXPIRED_MESSAGE, useAuth, useOptionalAuth } from "@/lib/auth";

const USER = { id: "usr_1", email: "asha@example.com", displayName: "Asha" };
const TOKEN = { accessToken: "tok-1", tokenType: "bearer", expiresIn: 3600 };
const PASSWORD = "correct horse battery";

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

/** The token provider and expiry handler the provider registered when it mounted. */
function currentToken(): string | null {
  const provider = mocks.setAuthTokenProvider.mock.calls[0][0] as () => string | null;
  return provider();
}

function expireSession(): void {
  const handler = mocks.setUnauthorizedHandler.mock.calls[0][0] as () => void;
  act(() => handler());
}

async function run<T>(action: () => Promise<T>): Promise<T> {
  let value!: T;
  await act(async () => {
    value = await action();
  });
  return value;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.login.mockResolvedValue(TOKEN);
  mocks.me.mockResolvedValue(USER);
  mocks.register.mockResolvedValue(USER);
});

describe("on mount", () => {
  it("starts signed out with no token and registers its hooks", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user).toBeNull();
    expect(result.current.notice).toBeNull();
    expect(currentToken()).toBeNull();
    expect(mocks.setUnauthorizedHandler).toHaveBeenCalledWith(expect.any(Function));
  });

    it("removes its hooks and wipes the token when it unmounts", async () => {
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });
    await run(() => result.current.signIn("asha@example.com", PASSWORD));
    expect(currentToken()).toBe("tok-1");

    unmount();

    expect(currentToken()).toBeNull(); // the token is wiped, not just forgotten
    const calls = mocks.setAuthTokenProvider.mock.calls;
    const lastProvider = calls[calls.length - 1][0] as () => string | null;
    expect(lastProvider()).toBeNull();
    expect(mocks.setUnauthorizedHandler).toHaveBeenLastCalledWith(null);
  });
});

describe("signIn", () => {
  it("logs in, loads the account and keeps the token in memory", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    let tokenSeenByMe: string | null = null;
    mocks.me.mockImplementation(async () => {
      tokenSeenByMe = currentToken();
      return USER;
    });

    const outcome = await run(() => result.current.signIn("asha@example.com", PASSWORD));

    expect(outcome).toEqual({ ok: true });
    expect(mocks.login).toHaveBeenCalledWith("asha@example.com", PASSWORD);
    expect(tokenSeenByMe).toBe("tok-1"); // the account lookup is already authenticated
    expect(result.current.user).toEqual(USER);
    expect(result.current.notice).toBeNull();
    expect(currentToken()).toBe("tok-1");
  });

  it("returns the server's message and keeps no token when the login is refused", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    mocks.login.mockRejectedValue(new Error("Incorrect email or password."));

    const outcome = await run(() => result.current.signIn("asha@example.com", "wrong"));

    expect(outcome).toEqual({ ok: false, error: "Incorrect email or password." });
    expect(result.current.user).toBeNull();
    expect(currentToken()).toBeNull();
    expect(mocks.me).not.toHaveBeenCalled();
  });

  it("clears the token when the account lookup fails after a successful login", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    mocks.me.mockRejectedValue(new Error("The server ran into a problem. Please try again later."));

    const outcome = await run(() => result.current.signIn("asha@example.com", PASSWORD));

    expect(outcome).toEqual({
      ok: false,
      error: "The server ran into a problem. Please try again later.",
    });
    expect(result.current.user).toBeNull();
    expect(currentToken()).toBeNull();
  });

  it("clears a session-expired notice on a successful sign-in", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await run(() => result.current.signIn("asha@example.com", PASSWORD));
    expireSession();
    expect(result.current.notice).toBe(SESSION_EXPIRED_MESSAGE);

    await run(() => result.current.signIn("asha@example.com", PASSWORD));

    expect(result.current.notice).toBeNull();
    expect(result.current.user).toEqual(USER);
  });
});

describe("signUp", () => {
  it("registers, then signs in with the same credentials", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    const outcome = await run(() => result.current.signUp("asha@example.com", PASSWORD, "Asha"));

    expect(outcome).toEqual({ ok: true });
    expect(mocks.register).toHaveBeenCalledWith("asha@example.com", PASSWORD, "Asha");
    expect(mocks.login).toHaveBeenCalledWith("asha@example.com", PASSWORD);
    expect(result.current.user).toEqual(USER);
  });

  it("stops at the registration error and never tries to log in", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    mocks.register.mockRejectedValue(new Error("An account with this email already exists."));

    const outcome = await run(() => result.current.signUp("asha@example.com", PASSWORD, "Asha"));

    expect(outcome).toEqual({ ok: false, error: "An account with this email already exists." });
    expect(mocks.login).not.toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });

  it("explains it when the account was created but the sign-in failed", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    mocks.login.mockRejectedValue(new Error("Could not reach the server. Check your connection and try again."));

    const outcome = await run(() => result.current.signUp("asha@example.com", PASSWORD, "Asha"));

    expect(outcome).toEqual({
      ok: false,
      error:
        "Your account was created, but signing in failed. Could not reach the server. Check your connection and try again.",
    });
    expect(result.current.user).toBeNull();
    expect(currentToken()).toBeNull();
  });
});

describe("signOut", () => {
  it("clears the user and the token", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await run(() => result.current.signIn("asha@example.com", PASSWORD));
    expect(result.current.user).toEqual(USER);

    act(() => result.current.signOut());

    expect(result.current.user).toBeNull();
    expect(result.current.notice).toBeNull();
    expect(currentToken()).toBeNull();
  });
});

describe("session expiry", () => {
  it("signs out with a notice when the API reports an expired session", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await run(() => result.current.signIn("asha@example.com", PASSWORD));

    expireSession();

    expect(result.current.user).toBeNull();
    expect(result.current.notice).toBe(SESSION_EXPIRED_MESSAGE);
    expect(currentToken()).toBeNull();
  });

  it("ignores the signal when nobody is signed in", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    expireSession();

    expect(result.current.user).toBeNull();
    expect(result.current.notice).toBeNull();
  });
});

describe("hooks outside the provider", () => {
  it("useAuth fails with a clear message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useAuth())).toThrow("useAuth must be used inside <AuthProvider>");
    spy.mockRestore();
  });

  it("useOptionalAuth returns null (demo mode has no login)", () => {
    const { result } = renderHook(() => useOptionalAuth());
    expect(result.current).toBeNull();
  });
});