import { createAuthClient } from "better-auth/react";
import { twoFactorClient, usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  // No onTwoFactorRedirect: LoginForm reads `twoFactorRedirect` from the
  // sign-in result and goes to /login/two-factor itself, keeping `next`.
  plugins: [usernameClient(), twoFactorClient()],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  requestPasswordReset,
  resetPassword,
  changePassword,
  twoFactor,
} = authClient;
