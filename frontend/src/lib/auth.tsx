import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  api,
  describeError,
  setAuthTokenProvider,
  setUnauthorizedHandler,
  type AuthUser,
} from "@/lib/apiClient";

export type AuthResult = { ok: true } | { ok: false; error: string };

export const SESSION_EXPIRED_MESSAGE = "Your session expired. Please sign in again.";

interface AuthContextValue {
  user: AuthUser | null;
  /** Shown on the login page, for example after a session expires. */
  notice: string | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, displayName: string) => Promise<AuthResult>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The token lives in memory only. It is never written to localStorage or cookies.
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    setAuthTokenProvider(() => tokenRef.current);
    setUnauthorizedHandler(() => {
      if (tokenRef.current === null) return; // already signed out
      tokenRef.current = null;
      setUser(null);
      setNotice(SESSION_EXPIRED_MESSAGE);
    });
    return () => {
      setAuthTokenProvider(() => null);
      setUnauthorizedHandler(null);
      tokenRef.current = null;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    try {
      const token = await api.login(email, password);
      tokenRef.current = token.accessToken;
      try {
        const me = await api.me();
        setUser(me);
        setNotice(null);
        return { ok: true };
      } catch (error) {
        tokenRef.current = null;
        throw error;
      }
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string): Promise<AuthResult> => {
      try {
        await api.register(email, password, displayName);
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
      const result = await signIn(email, password);
      if (!result.ok) {
        return { ok: false, error: `Your account was created, but signing in failed. ${result.error}` };
      }
      return result;
    },
    [signIn],
  );

  const signOut = useCallback(() => {
    tokenRef.current = null;
    setUser(null);
    setNotice(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, notice, signIn, signUp, signOut }),
    [user, notice, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** For components that also render in demo mode, where no AuthProvider exists. */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}