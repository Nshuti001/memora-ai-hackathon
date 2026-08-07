import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { databaseAvailable, ensureSchema, shutdown } from './helpers.js';
import {
  AuthError,
  login,
  normalizeEmail,
  revokeSession,
  signup,
  userForToken,
  validatePassword,
} from '../src/auth.js';
import { handleRequest, type ApiRequest, type ApiResponse } from '../src/api.js';
import { remember } from '../src/memory.js';
import { query } from '../src/db.js';

const available = await databaseAvailable();

after(async () => {
  await shutdown();
});

function freshEmail(): string {
  return `u-${randomUUID().slice(0, 12)}@example.test`;
}

async function cleanupUser(email: string): Promise<void> {
  const rows = await query<{ id: string; tenant_id: string }>(
    'SELECT id, tenant_id FROM users WHERE email = $1',
    [email.toLowerCase()],
  );
  for (const row of rows) {
    await query('DELETE FROM memory_audit WHERE tenant_id = $1', [row.tenant_id]);
    await query('DELETE FROM memories WHERE tenant_id = $1', [row.tenant_id]);
    await query('DELETE FROM agents WHERE tenant_id = $1', [row.tenant_id]);
    await query('DELETE FROM users WHERE id = $1', [row.id]);
  }
}

describe('input validation', () => {
  test('accepts a normal address and lowercases it', () => {
    assert.equal(normalizeEmail('  Jane.Doe@Example.COM '), 'jane.doe@example.com');
  });

  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', '@example.com', 'x@.com']) {
    test(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => normalizeEmail(bad), AuthError);
    });
  }

  test('requires at least 8 characters', () => {
    assert.throws(() => validatePassword('short'), AuthError);
    assert.equal(validatePassword('longenough'), 'longenough');
  });

  test('rejects an absurdly long password', () => {
    // scrypt hashes the whole input, so an unbounded password is a cheap CPU-exhaustion vector.
    assert.throws(() => validatePassword('x'.repeat(5000)), AuthError);
  });
});

describe('accounts', { skip: available ? false : 'no CockroachDB reachable' }, () => {
  before(async () => {
    await ensureSchema();
  });

  test('signing up issues a working session', async () => {
    const email = freshEmail();
    try {
      const result = await signup({ email, password: 'correct horse battery', name: 'Jane Doe' });

      assert.equal(result.user.email, email);
      assert.equal(result.user.name, 'Jane Doe');
      assert.ok(result.token.length > 20);

      const resolved = await userForToken(result.token);
      assert.equal(resolved?.id, result.user.id);
    } finally {
      await cleanupUser(email);
    }
  });

  test('never stores the password itself', async () => {
    const email = freshEmail();
    const password = 'a-very-secret-passphrase';
    try {
      await signup({ email, password });

      const [row] = await query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE email = $1',
        [email],
      );
      assert.ok(!row.password_hash.includes(password), 'the password must not appear in the hash');
      assert.match(row.password_hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    } finally {
      await cleanupUser(email);
    }
  });

  test('stores only a hash of the session token', async () => {
    const email = freshEmail();
    try {
      const { token } = await signup({ email, password: 'correct horse battery' });

      const rows = await query<{ token_sha256: string }>(
        'SELECT token_sha256 FROM auth_sessions WHERE token_sha256 = $1',
        [token],
      );
      assert.equal(rows.length, 0, 'the raw token must never be a stored key');
    } finally {
      await cleanupUser(email);
    }
  });

  test('rejects a duplicate email with 409 rather than a 500', async () => {
    const email = freshEmail();
    try {
      await signup({ email, password: 'correct horse battery' });
      await assert.rejects(
        () => signup({ email, password: 'another password' }),
        (err: unknown) => err instanceof AuthError && err.status === 409,
      );
    } finally {
      await cleanupUser(email);
    }
  });

  test('treats email as case-insensitive across signup and login', async () => {
    const email = freshEmail();
    try {
      await signup({ email: email.toUpperCase(), password: 'correct horse battery' });
      const result = await login({ email: email.toLowerCase(), password: 'correct horse battery' });
      assert.equal(result.user.email, email.toLowerCase());
    } finally {
      await cleanupUser(email);
    }
  });

  test('rejects a wrong password', async () => {
    const email = freshEmail();
    try {
      await signup({ email, password: 'correct horse battery' });
      await assert.rejects(
        () => login({ email, password: 'wrong password entirely' }),
        (err: unknown) => err instanceof AuthError && err.status === 401,
      );
    } finally {
      await cleanupUser(email);
    }
  });

  test('gives the same message for an unknown account as for a wrong password', async () => {
    // Distinguishable errors turn the login form into an account-enumeration oracle.
    const email = freshEmail();
    try {
      await signup({ email, password: 'correct horse battery' });

      const wrongPassword = await login({ email, password: 'nope nope nope' }).catch((e) => e);
      const noSuchUser = await login({ email: freshEmail(), password: 'nope nope nope' }).catch((e) => e);

      assert.equal(wrongPassword.message, noSuchUser.message);
      assert.equal(wrongPassword.status, noSuchUser.status);
    } finally {
      await cleanupUser(email);
    }
  });

  test('signing out invalidates the token', async () => {
    const email = freshEmail();
    try {
      const { token } = await signup({ email, password: 'correct horse battery' });
      assert.ok(await userForToken(token));

      await revokeSession(token);
      assert.equal(await userForToken(token), null);
    } finally {
      await cleanupUser(email);
    }
  });

  test('an expired session is treated as signed out', async () => {
    const email = freshEmail();
    try {
      const { token } = await signup({ email, password: 'correct horse battery' });
      await query(`UPDATE auth_sessions SET expires_at = now() - INTERVAL '1 minute'`);

      assert.equal(await userForToken(token), null);
    } finally {
      await cleanupUser(email);
    }
  });

  test('a garbage token resolves to nobody', async () => {
    assert.equal(await userForToken('not-a-real-token'), null);
    assert.equal(await userForToken(undefined), null);
  });

  test('each account gets its own tenant', async () => {
    const a = freshEmail();
    const b = freshEmail();
    try {
      const first = await signup({ email: a, password: 'correct horse battery' });
      const second = await signup({ email: b, password: 'correct horse battery' });
      assert.notEqual(first.user.tenantId, second.user.tenantId);
    } finally {
      await cleanupUser(a);
      await cleanupUser(b);
    }
  });
});

describe('session-scoped API access', { skip: available ? false : 'no CockroachDB reachable' }, () => {
  before(async () => {
    await ensureSchema();
  });

  function req(
    method: string,
    path: string,
    opts: { token?: string; body?: Record<string, unknown>; query?: Record<string, string> } = {},
  ): ApiRequest {
    return {
      method,
      path,
      searchParams: new URLSearchParams(opts.query ?? {}),
      body: opts.body ?? null,
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    };
  }

  function body<T>(response: ApiResponse): T {
    assert.equal(response.kind, 'json');
    return (response as Extract<ApiResponse, { kind: 'json' }>).body as T;
  }

  test('one signed-in user cannot see another user\'s memories', async () => {
    const aliceEmail = freshEmail();
    const bobEmail = freshEmail();

    try {
      const alice = await signup({ email: aliceEmail, password: 'correct horse battery' });
      const bob = await signup({ email: bobEmail, password: 'correct horse battery' });

      // Alice writes through her own session.
      const created = await handleRequest(
        req('POST', '/api/memories', {
          token: alice.token,
          body: { content: 'Alice keeps the production runbook in Notion' },
        }),
      );
      assert.equal(created.status, 201);

      const aliceSees = body<{ memories: unknown[] }>(
        await handleRequest(req('GET', '/api/memories', { token: alice.token })),
      );
      assert.equal(aliceSees.memories.length, 1);

      const bobSees = body<{ memories: unknown[] }>(
        await handleRequest(req('GET', '/api/memories', { token: bob.token })),
      );
      assert.equal(bobSees.memories.length, 0, 'sessions must not cross tenant boundaries');
    } finally {
      await cleanupUser(aliceEmail);
      await cleanupUser(bobEmail);
    }
  });

  test('an invalid session is rejected rather than silently downgraded to demo', async () => {
    const response = await handleRequest(req('GET', '/api/memories', { token: 'bogus-token' }));
    assert.equal(response.status, 401);
  });

  test('signup and login round-trip through the HTTP layer', async () => {
    const email = freshEmail();
    try {
      const created = await handleRequest(
        req('POST', '/api/auth/signup', { body: { email, password: 'correct horse battery', name: 'Ann' } }),
      );
      assert.equal(created.status, 201);

      const signedIn = await handleRequest(
        req('POST', '/api/auth/login', { body: { email, password: 'correct horse battery' } }),
      );
      assert.equal(signedIn.status, 200);

      const { token } = body<{ token: string }>(signedIn);
      const me = await handleRequest(req('GET', '/api/auth/me', { token }));
      assert.equal(me.status, 200);
      assert.equal(body<{ user: { email: string } }>(me).user.email, email);
    } finally {
      await cleanupUser(email);
    }
  });

  test('a short password is rejected with 400, not 500', async () => {
    const response = await handleRequest(
      req('POST', '/api/auth/signup', { body: { email: freshEmail(), password: 'short' } }),
    );
    assert.equal(response.status, 400);
  });

  test('/api/auth/me without a token is 401', async () => {
    const response = await handleRequest(req('GET', '/api/auth/me'));
    assert.equal(response.status, 401);
  });

  test('memories written under a session survive a re-login', async () => {
    const email = freshEmail();
    try {
      const first = await signup({ email, password: 'correct horse battery' });
      await remember({
        tenantId: first.user.tenantId,
        agentId: (
          await query<{ id: string }>(
            `INSERT INTO agents (tenant_id, name) VALUES ($1, 'memora') RETURNING id`,
            [first.user.tenantId],
          )
        )[0].id,
        content: 'Persisted across sessions on purpose',
      });

      await revokeSession(first.token);
      const second = await login({ email, password: 'correct horse battery' });

      const listed = body<{ memories: unknown[] }>(
        await handleRequest(req('GET', '/api/memories', { token: second.token })),
      );
      assert.equal(listed.memories.length, 1, 'memory belongs to the account, not the session');
    } finally {
      await cleanupUser(email);
    }
  });
});
