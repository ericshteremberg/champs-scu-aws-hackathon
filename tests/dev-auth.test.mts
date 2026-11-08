import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticateDevelopmentRequest } from '../lib/server/dev-auth.ts';

// Deliberately synthetic fixture, never a deployment credential.
const fakePassword = `FAKE-ONLY-${'0'.repeat(30)}`;
const environment = { DEPLOYMENT_MODE: 'standalone-dev', DEV_ACCESS_PASSWORD: fakePassword };
const origin = 'https://development.example.invalid';

function authorization(username = 'dev', password = fakePassword) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

function request(path = '/workspace', auth: string | null = authorization()) {
  return new Request(`${origin}${path}`, {
    headers: auth === null ? {} : { authorization: auth },
  });
}

function assertChallenge(result: Request | Response) {
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
  assert.match(result.headers.get('www-authenticate') ?? '', /^Basic\s/i);
  const cacheControl = result.headers.get('cache-control') ?? '';
  assert.match(cacheControl, /(?:^|,)\s*private\s*(?:,|$)/i);
  assert.match(cacheControl, /(?:^|,)\s*no-store\s*(?:,|$)/i);
  return result;
}

test('legacy deployment modes pass through the original request without changing identity or consuming the body', async context => {
  for (const mode of [undefined, '']) {
    await context.test(`mode ${JSON.stringify(mode)}`, async () => {
      const original = new Request('http://legacy.example.invalid/callback?return_to=%2Fcases', {
        method: 'POST',
        headers: {
          authorization: 'Bearer existing-platform-token',
          'oai-authenticated-user-id': 'existing-platform-user',
          'content-type': 'text/plain',
        },
        body: 'existing platform payload',
      });
      const result = await authenticateDevelopmentRequest(original, { DEPLOYMENT_MODE: mode });
      assert.equal(result, original);
      assert.equal(original.bodyUsed, false);
      assert.equal(original.headers.get('authorization'), 'Bearer existing-platform-token');
      assert.equal(original.headers.get('oai-authenticated-user-id'), 'existing-platform-user');
      assert.equal(await original.text(), 'existing platform payload');
    });
  }
});

test('unknown nonempty deployment modes fail closed even with valid credentials', async context => {
  for (const mode of ['standalone', 'production', 'standalone-dev ', ' ']) {
    await context.test(JSON.stringify(mode), async () => {
      const result = await authenticateDevelopmentRequest(request(), { ...environment, DEPLOYMENT_MODE: mode });
      assert.ok(result instanceof Response);
      assert.equal(result.status, 503);
    });
  }
});

test('standalone development rejects missing and short configuration before authenticating', async context => {
  for (const password of [undefined, '', 'FAKE-ONLY-SHORT', 'x'.repeat(31)]) {
    await context.test(`configured length ${password?.length ?? 'missing'}`, async () => {
      for (const auth of [null, authorization('dev', password ?? '')]) {
        const result = await authenticateDevelopmentRequest(request('/workspace', auth), {
          DEPLOYMENT_MODE: 'standalone-dev',
          DEV_ACCESS_PASSWORD: password,
        });
        assert.ok(result instanceof Response);
        assert.equal(result.status, 503);
      }
    });
  }
});

test('the minimum accepted configured password length is 32 characters', async () => {
  const password = `FAKE-ONLY-${'1'.repeat(22)}`;
  assert.equal(password.length, 32);
  const result = await authenticateDevelopmentRequest(request('/workspace', authorization('dev', password)), {
    ...environment,
    DEV_ACCESS_PASSWORD: password,
  });
  assert.ok(result instanceof Request);
});

test('standalone development rejects HTTP instead of authenticating or redirecting it', async context => {
  for (const auth of [null, authorization()]) {
    await context.test(auth === null ? 'without credentials' : 'with valid credentials', async () => {
      const insecure = new Request('http://development.example.invalid/workspace', {
        headers: auth === null ? {} : { authorization: auth },
      });
      const result = await authenticateDevelopmentRequest(insecure, environment);
      assert.ok(result instanceof Response);
      assert.equal(result.status, 403);
      assert.equal(result.headers.get('location'), null);
    });
  }
});

test('missing, malformed, and non-Basic authorization receive an uncached Basic challenge', async context => {
  const invalidHeaders: [string, string | null][] = [
    ['missing', null],
    ['Bearer', 'Bearer a-synthetic-token'],
    ['empty Basic token', 'Basic'],
    ['invalid Base64 alphabet', 'Basic !!!!'],
    ['invalid Base64 length', 'Basic a'],
    ['missing password separator', `Basic ${btoa('dev')}`],
    ['empty username', authorization('', fakePassword)],
    ['empty password', authorization('dev', '')],
  ];
  for (const [name, auth] of invalidHeaders) {
    await context.test(name, async () => {
      assertChallenge(await authenticateDevelopmentRequest(request('/workspace', auth), environment));
    });
  }
});

test('incorrect usernames and passwords cannot authenticate', async context => {
  const invalidCredentials = [
    ['incorrect username', 'reviewer', fakePassword],
    ['username case mismatch', 'Dev', fakePassword],
    ['same-length incorrect password', 'dev', `FAKE-ONLY-${'1'.repeat(30)}`],
    ['short incorrect password', 'dev', 'wrong'],
    ['long incorrect password', 'dev', `${fakePassword}extra`],
    ['correct prefix with colon suffix', 'dev', `${fakePassword}:extra`],
  ];
  for (const [name, username, password] of invalidCredentials) {
    await context.test(name, async () => {
      assertChallenge(await authenticateDevelopmentRequest(request('/workspace', authorization(username, password)), environment));
    });
  }
});

test('valid authentication replaces every supplied platform identity header and removes credentials', async () => {
  const original = new Request(`${origin}/api/cases?view=all`, {
    headers: {
      authorization: authorization(),
      'OAI-Authenticated-User-Id': 'spoofed-administrator',
      'oai-authenticated-user-email': 'spoofed@example.invalid',
      'oai-authenticated-user-full-name': 'Spoofed Administrator',
      'oai-authenticated-user-full-name-encoding': 'incorrect',
      'oai-authenticated-role': 'administrator',
      'oai-authenticated-user-groups': 'all-workspaces',
      'x-request-id': 'preserved-request-id',
      'oai-unrelated-header': 'preserved',
    },
  });
  const result = await authenticateDevelopmentRequest(original, environment);
  assert.ok(result instanceof Request);
  assert.equal(result.headers.get('authorization'), null);
  const identity = Object.fromEntries([...result.headers].filter(([name]) => name.startsWith('oai-authenticated-')));
  assert.deepEqual(identity, {
    'oai-authenticated-user-email': 'development-reviewer@example.invalid',
    'oai-authenticated-user-full-name': 'Development reviewer',
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
    'oai-authenticated-user-id': 'causality-development-reviewer',
  });
  assert.equal(result.headers.get('x-request-id'), 'preserved-request-id');
  assert.equal(result.headers.get('oai-unrelated-header'), 'preserved');
  assert.equal(result.url, original.url);
});

test('authentication preserves request method, binary body, content type, and application headers', async () => {
  const body = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
  const original = new Request(`${origin}/api/evidence?case=synthetic`, {
    method: 'PUT',
    headers: {
      authorization: authorization(),
      'content-type': 'application/octet-stream',
      'x-evidence-name': 'synthetic.bin',
    },
    body,
  });
  const result = await authenticateDevelopmentRequest(original, environment);
  assert.ok(result instanceof Request);
  assert.equal(result.method, 'PUT');
  assert.equal(result.url, `${origin}/api/evidence?case=synthetic`);
  assert.equal(result.headers.get('content-type'), 'application/octet-stream');
  assert.equal(result.headers.get('x-evidence-name'), 'synthetic.bin');
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), body);
});

test('development sign-in and callback routes require authentication before redirecting', async context => {
  for (const path of ['/signin-with-chatgpt', '/callback']) {
    await context.test(path, async () => {
      assertChallenge(await authenticateDevelopmentRequest(request(path, null), environment));
      const result = await authenticateDevelopmentRequest(
        request(`${path}?return_to=${encodeURIComponent('https://untrusted.example.invalid/steal')}`),
        environment,
      );
      assert.ok(result instanceof Response);
      assert.equal(result.status, 303);
      assert.equal(new URL(result.headers.get('location')!, origin).href, `${origin}/workspace`);
    });
  }
});

test('development signout challenges again and explains browser credential caching', async () => {
  const result = assertChallenge(await authenticateDevelopmentRequest(request('/signout-with-chatgpt'), environment));
  const message = await result.text();
  assert.match(message, /browser/i);
  assert.match(message, /cach|keep|remember|retain/i);
  assert.equal(result.headers.get('location'), null);
});

const publicEnvironment = { DEPLOYMENT_MODE: 'standalone-dev', DEV_PUBLIC_WORKSPACE: 'true' };

test('public workspace accepts anonymous requests without a password and fixes shared identity', async () => {
  const original = new Request(`${origin}/api/workspace`, { headers: {
    authorization: 'Bearer untrusted',
    'oai-authenticated-user-id': 'another-workspace',
    'oai-authenticated-role': 'admin',
  } });
  const result = await authenticateDevelopmentRequest(original, publicEnvironment);
  assert.ok(result instanceof Request);
  assert.equal(result.headers.get('authorization'), null);
  assert.equal(result.headers.get('oai-authenticated-role'), null);
  assert.equal(result.headers.get('oai-authenticated-user-id'), 'causality-development-reviewer');
  assert.ok(await authenticateDevelopmentRequest(request('/workspace', null), publicEnvironment) instanceof Request);
});

test('public access requires an exact explicit flag and standalone deployment', async () => {
  for (const flag of [undefined, '', 'false', 'TRUE', 'true ']) {
    assertChallenge(await authenticateDevelopmentRequest(request('/workspace', null), { ...environment, DEV_PUBLIC_WORKSPACE: flag }));
  }
  const invalidMode = await authenticateDevelopmentRequest(request('/workspace', null), { ...publicEnvironment, DEPLOYMENT_MODE: 'production' });
  assert.ok(invalidMode instanceof Response);
  assert.equal(invalidMode.status, 503);
  const insecure = await authenticateDevelopmentRequest(new Request('http://development.example.invalid/workspace'), publicEnvironment);
  assert.ok(insecure instanceof Response);
  assert.equal(insecure.status, 403);
});

test('public sign-in, callback and sign-out redirect to workspace without credential prompts', async () => {
  for (const path of ['/signin-with-chatgpt', '/callback', '/signout-with-chatgpt']) {
    const result = await authenticateDevelopmentRequest(request(`${path}?return_to=https://untrusted.example.invalid`, null), publicEnvironment);
    assert.ok(result instanceof Response);
    assert.equal(result.status, 303);
    assert.equal(result.headers.get('location'), `${origin}/workspace`);
    assert.equal(result.headers.get('www-authenticate'), null);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  }
});
