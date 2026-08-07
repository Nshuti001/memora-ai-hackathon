/**
 * Accounts and login sessions.
 *
 * Deliberately dependency-free: scrypt and randomBytes come from node:crypto, so there is no
 * password-hashing library to keep patched and nothing to misconfigure.
 *
 * Two properties matter more than anything else here:
 *
 *   Passwords are never stored, only a scrypt hash with a per-user random salt. scrypt is
 *   memory-hard, so a leaked table is expensive to attack offline in a way that a fast hash
 *   (SHA-256, bcrypt at low cost) is not.
 *
 *   Session tokens are never stored either — only their SHA-256. Reading the database therefore
 *   does not let anyone impersonate a user. The bearer value exists only in the client.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SESSION_DAYS = 30;

export class AuthError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);

  // Constant-time: a plain === leaks how many leading bytes matched, which is enough to recover a
  // hash byte by byte given enough attempts.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Deliberately permissive — the authority on whether an address works is a delivered email. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: unknown): string {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw new AuthError(400, 'Enter a valid email address.');
  if (email.length > 254) throw new AuthError(400, 'That email address is too long.');
  return email;
}

export function validatePassword(raw: unknown): string {
  const password = String(raw ?? '');
  if (password.length < 8) throw new AuthError(400, 'Password must be at least 8 characters.');
  // scrypt hashes the whole input, so a very long password is a cheap denial-of-service vector.
  if (password.length > 200) throw new AuthError(400, 'Password must be under 200 characters.');
  return password;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function issueSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await query(
    `INSERT INTO auth_sessions (token_sha256, user_id, expires_at) VALUES ($1, $2, $3)`,
    [tokenHash(token), userId, expiresAt.toISOString()],
  );

  return { token, expiresAt: expiresAt.toISOString() };
}

/** Resolves a bearer token to its user, or null. Expired sessions are treated as absent. */
export async function userForToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;

  const rows = await query<{
    id: string;
    tenant_id: string;
    email: string;
    name: string;
    created_at: string;
  }>(
    `SELECT u.id, u.tenant_id, u.email, u.name, u.created_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_sha256 = $1 AND s.expires_at > now()`,
    [tokenHash(token)],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
  };
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await query('DELETE FROM auth_sessions WHERE token_sha256 = $1', [tokenHash(token)]);
}

/** Housekeeping for expired rows. Safe to call on any schedule. */
export async function pruneSessions(): Promise<number> {
  const rows = await query<{ token_sha256: string }>(
    'DELETE FROM auth_sessions WHERE expires_at < now() RETURNING token_sha256',
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Signup / login
// ---------------------------------------------------------------------------

export interface AuthResult {
  user: User;
  token: string;
  expiresAt: string;
}

export async function signup(input: {
  email: unknown;
  password: unknown;
  name?: unknown;
}): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  const name = String(input.name ?? '').trim().slice(0, 120);

  const passwordHash = await hashPassword(password);

  // Every account gets its own tenant, so one user's memories are physically unreachable from
  // another's — the same isolation the vector index prefix enforces.
  const tenantId = `t_${randomBytes(9).toString('base64url')}`;

  let rows;
  try {
    rows = await query<{ id: string; created_at: string }>(
      `INSERT INTO users (tenant_id, email, name, password_hash) VALUES ($1, $2, $3, $4)
         RETURNING id, created_at`,
      [tenantId, email, name, passwordHash],
    );
  } catch (err) {
    // 23505 = unique_violation on the email index.
    if ((err as { code?: string })?.code === '23505') {
      throw new AuthError(409, 'An account with that email already exists. Try signing in.');
    }
    throw err;
  }

  const user: User = {
    id: rows[0].id,
    tenantId,
    email,
    name,
    createdAt: rows[0].created_at,
  };

  return { user, ...(await issueSession(user.id)) };
}

export async function login(input: { email: unknown; password: unknown }): Promise<AuthResult> {
  const email = String(input.email ?? '').trim().toLowerCase();
  const password = String(input.password ?? '');

  const rows = await query<{
    id: string;
    tenant_id: string;
    email: string;
    name: string;
    password_hash: string;
    created_at: string;
  }>(
    `SELECT id, tenant_id, email, name, password_hash, created_at FROM users WHERE email = $1`,
    [email],
  );

  const row = rows[0];

  // Same message and comparable work whether or not the account exists: replying "no such user"
  // faster than "wrong password" turns the login form into an account-enumeration oracle.
  const ok = row
    ? await verifyPassword(password, row.password_hash)
    : await verifyPassword(password, `scrypt$${'00'.repeat(16)}$${'00'.repeat(KEY_LENGTH)}`);

  if (!row || !ok) throw new AuthError(401, 'Incorrect email or password.');

  const user: User = {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
  };

  return { user, ...(await issueSession(user.id)) };
}
