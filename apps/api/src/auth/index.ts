import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { and, eq, gt } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AskminkDb } from '@askmink/db';
import { sessions, users, workspaceMembers, workspaces } from '@askmink/db';
import { generateRandomToken, hashPassword, sha256Hex, verifyPassword } from '../crypto/encryption.js';
import type { AppConfig } from '../config.js';
import { CSRF_COOKIE_NAME } from '../security/middleware.js';

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  workspaceId: string;
  role: string;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getSessionCookieName(isSecure: boolean): string {
  // Use __Host- prefix when served over HTTPS (production/Coolify); fallback name on local HTTP
  return isSecure ? '__Host-askmink_session' : 'askmink_session';
}

export class AuthService {
  private readonly isSecure: boolean;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly db: AskminkDb,
    private readonly config: AppConfig
  ) {
    this.isSecure = config.appUrl.startsWith('https://') && config.nodeEnv === 'production';
    if (config.appMode === 'cloud' && config.auth0?.domain) {
      this.jwks = createRemoteJWKSet(
        new URL(`https://${config.auth0.domain}/.well-known/jwks.json`)
      );
    }
  }

  issueCsrfCookie(c: Context): string {
    const existing = getCookie(c, CSRF_COOKIE_NAME);
    if (existing && existing.length >= 32) {
      return existing;
    }
    const token = generateRandomToken(32);
    setCookie(c, CSRF_COOKIE_NAME, token, {
      httpOnly: false, // Must be readable by SPA to echo in X-CSRF-Token (Double Submit Cookie)
      secure: this.isSecure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return token;
  }

  async signupLocal(input: {
    name: string;
    email: string;
    password: string;
    workspaceName?: string;
  }): Promise<{ user: AuthUser; sessionToken: string }> {
    // TODO(security): Add leaked password detection & optional MFA in future hardening.
    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, input.email.toLowerCase()),
    });
    if (existing) {
      throw new Error('An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const [createdUser] = await this.db
      .insert(users)
      .values({
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash,
        authProvider: 'local',
      })
      .returning();

    const [createdWorkspace] = await this.db
      .insert(workspaces)
      .values({
        name: input.workspaceName?.trim() || `${input.name}'s Workspace`,
        ownerId: createdUser!.id,
      })
      .returning();

    await this.db.insert(workspaceMembers).values({
      workspaceId: createdWorkspace!.id,
      userId: createdUser!.id,
      role: 'owner',
    });

    const sessionToken = await this.createSession(createdUser!.id, createdWorkspace!.id);
    return {
      user: {
        userId: createdUser!.id,
        email: createdUser!.email,
        name: createdUser!.name,
        workspaceId: createdWorkspace!.id,
        role: 'owner',
      },
      sessionToken,
    };
  }

  async loginLocal(input: {
    email: string;
    password: string;
  }): Promise<{ user: AuthUser; sessionToken: string }> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.email, input.email.toLowerCase()),
    });
    if (!user || !user.passwordHash) {
      throw new Error('Invalid email or password');
    }
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      throw new Error('Invalid email or password');
    }

    const membership = await this.db.query.workspaceMembers.findFirst({
      where: eq(workspaceMembers.userId, user.id),
    });
    if (!membership) {
      throw new Error('No workspace assigned to this account');
    }

    const sessionToken = await this.createSession(user.id, membership.workspaceId);
    return {
      user: {
        userId: user.id,
        email: user.email,
        name: user.name,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      sessionToken,
    };
  }

  private async createSession(userId: string, workspaceId: string): Promise<string> {
    const rawToken = generateRandomToken(32);
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(sessions).values({
      tokenHash,
      userId,
      workspaceId,
      expiresAt,
    });
    return rawToken;
  }

  setSessionCookie(c: Context, rawToken: string): void {
    setCookie(c, getSessionCookieName(this.isSecure), rawToken, {
      httpOnly: true,
      secure: this.isSecure,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  }

  clearSessionCookie(c: Context): void {
    deleteCookie(c, getSessionCookieName(this.isSecure), { path: '/' });
  }

  // Invalidate ALL active sessions for the user on logout (per security guidelines)
  async logoutAllUserSessions(userId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async resolveRequestUser(c: Context): Promise<AuthUser | null> {
    // Cloud Mode: Auth0 Bearer JWT
    if (this.config.appMode === 'cloud' && this.jwks && this.config.auth0) {
      const authHeader = c.req.header('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const token = authHeader.slice(7);
          const { payload } = await jwtVerify(token, this.jwks, {
            issuer: `https://${this.config.auth0.domain}/`,
            audience: this.config.auth0.audience || undefined,
            algorithms: ['RS256'],
          });
          const sub = typeof payload.sub === 'string' ? payload.sub : null;
          if (!sub) return null;
          const user = await this.db.query.users.findFirst({
            where: eq(users.externalAuthId, sub),
          });
          if (!user) return null;
          const membership = await this.db.query.workspaceMembers.findFirst({
            where: eq(workspaceMembers.userId, user.id),
          });
          if (!membership) return null;
          return {
            userId: user.id,
            email: user.email,
            name: user.name,
            workspaceId: membership.workspaceId,
            role: membership.role,
          };
        } catch {
          return null;
        }
      }
    }

    // Self-Hosted Mode: HttpOnly Session Cookie
    const cookieToken = getCookie(c, getSessionCookieName(this.isSecure));
    if (!cookieToken) return null;

    const tokenHash = sha256Hex(cookieToken);
    const now = new Date();
    const sessionRow = await this.db.query.sessions.findFirst({
      where: and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)),
    });
    if (!sessionRow) return null;

    const user = await this.db.query.users.findFirst({
      where: eq(users.id, sessionRow.userId),
    });
    const membership = await this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.userId, sessionRow.userId),
        eq(workspaceMembers.workspaceId, sessionRow.workspaceId)
      ),
    });
    if (!user || !membership) return null;

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
  }

  requireAuth(): MiddlewareHandler<{ Variables: { authUser: AuthUser } }> {
    return async (c, next) => {
      const user = await this.resolveRequestUser(c);
      if (!user) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      c.set('authUser', user);
      return next();
    };
  }
}
