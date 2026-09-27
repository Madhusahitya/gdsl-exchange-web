/**
 * - **Production** (`NODE_ENV=production`): login is required for protected routes unless you set
 *   `NEXT_PUBLIC_DISABLE_AUTH_GUARD=1` (not recommended for real clients).
 * - **Development**: guard is off unless `NEXT_PUBLIC_AUTH_GUARD=1` (stricter local testing).
 */
export const AUTH_GUARD_ENABLED =
  process.env.NODE_ENV === 'production'
    ? process.env.NEXT_PUBLIC_DISABLE_AUTH_GUARD !== '1'
    : process.env.NEXT_PUBLIC_AUTH_GUARD === '1'
