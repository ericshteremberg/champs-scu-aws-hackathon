import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadAwsSession } from '../scripts/load-aws-session.mjs';

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'causality-session-test-'));
  directories.push(root);
  return root;
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('saved workshop session loading', () => {
  it('replaces inherited expired credentials while retaining intentional noncredential overrides', () => {
    const file = pathToFileURL(join(fixture(), '.dev.vars'));
    writeFileSync(file, 'AWS_ACCESS_KEY_ID=NEWKEY\nAWS_SECRET_ACCESS_KEY=NEWSECRET\nAWS_SESSION_TOKEN=NEWTOKEN\nAWS_REGION=us-east-1\nBEDROCK_MODEL_ID=saved-model\nCAUSALITY_FRONTEND_ORIGIN=https://saved.example.test\nEXTRA_SETTING=saved\n');
    const environment = { AWS_ACCESS_KEY_ID: 'OLDKEY', AWS_SECRET_ACCESS_KEY: 'OLDSECRET', AWS_SESSION_TOKEN: 'OLDTOKEN', AWS_REGION: 'explicit-region', BEDROCK_MODEL_ID: 'explicit-model', CAUSALITY_FRONTEND_ORIGIN: 'https://explicit.example.test' };
    loadAwsSession({ file, environment });
    expect(environment).toEqual({ AWS_ACCESS_KEY_ID: 'NEWKEY', AWS_SECRET_ACCESS_KEY: 'NEWSECRET', AWS_SESSION_TOKEN: 'NEWTOKEN', AWS_REGION: 'explicit-region', BEDROCK_MODEL_ID: 'explicit-model', CAUSALITY_FRONTEND_ORIGIN: 'https://explicit.example.test', EXTRA_SETTING: 'saved' });
  });

  it('preserves exported credentials when no saved session exists', () => {
    const file = pathToFileURL(join(fixture(), '.dev.vars'));
    const environment = { AWS_ACCESS_KEY_ID: 'EXPORTEDKEY', AWS_SECRET_ACCESS_KEY: 'EXPORTEDSECRET', AWS_SESSION_TOKEN: 'EXPORTEDTOKEN' };
    loadAwsSession({ file, environment });
    writeFileSync(file, 'BEDROCK_MODEL_ID=selected-model\n');
    loadAwsSession({ file, environment });
    expect(environment).toEqual({ AWS_ACCESS_KEY_ID: 'EXPORTEDKEY', AWS_SECRET_ACCESS_KEY: 'EXPORTEDSECRET', AWS_SESSION_TOKEN: 'EXPORTEDTOKEN', BEDROCK_MODEL_ID: 'selected-model' });
  });

  it('rejects a partial saved session before mixing it with inherited credentials', () => {
    const file = pathToFileURL(join(fixture(), '.dev.vars'));
    writeFileSync(file, 'AWS_ACCESS_KEY_ID=NEWKEY\nAWS_SECRET_ACCESS_KEY=NEWSECRET\n');
    const environment = { AWS_ACCESS_KEY_ID: 'OLDKEY', AWS_SECRET_ACCESS_KEY: 'OLDSECRET', AWS_SESSION_TOKEN: 'OLDTOKEN' };
    expect(() => loadAwsSession({ file, environment })).toThrow('saved .dev.vars AWS session is incomplete');
    expect(environment.AWS_ACCESS_KEY_ID).toBe('OLDKEY');
  });
});

describe('portable local setup scripts', () => {
  it('initializes access beside the project when run elsewhere and preserves the existing password', () => {
    const root = fixture(); const outside = fixture(); const scripts = join(root, 'scripts');
    mkdirSync(scripts);
    const script = join(scripts, 'init-dev-access.mjs');
    copyFileSync(new URL('../scripts/init-dev-access.mjs', import.meta.url), script);
    const first = spawnSync(process.execPath, [script], { cwd: outside, encoding: 'utf8' });
    expect(first.status).toBe(0);
    const accessPath = join(root, '.dev-worker-access.txt');
    const access = readFileSync(accessPath, 'utf8');
    const password = access.match(/^Password: (.+)$/m)?.[1];
    expect(password?.length).toBeGreaterThanOrEqual(32);
    expect(first.stdout).not.toContain(password);
    expect(statSync(accessPath).mode & 0o777).toBe(0o600);
    expect(existsSync(join(outside, '.dev-worker-access.txt'))).toBe(false);
    const second = spawnSync(process.execPath, [script], { cwd: outside, encoding: 'utf8' });
    expect(second.status).toBe(0);
    expect(readFileSync(accessPath, 'utf8')).toBe(access);
  });

  it('saves refreshed exports beside the project without losing model settings or printing credentials', () => {
    const root = fixture(); const outside = fixture(); const scripts = join(root, 'scripts');
    mkdirSync(scripts);
    const script = join(scripts, 'save-aws-session.mjs');
    copyFileSync(new URL('../scripts/save-aws-session.mjs', import.meta.url), script);
    const file = pathToFileURL(join(root, '.dev.vars'));
    writeFileSync(file, 'BEDROCK_MODEL_ID=preserved-model\nAWS_ACCESS_KEY_ID=OLDKEY\nAWS_SECRET_ACCESS_KEY=OLDSECRET\nAWS_SESSION_TOKEN=OLDTOKEN\n');
    const refreshed = { AWS_ACCESS_KEY_ID: 'REFRESHEDKEY', AWS_SECRET_ACCESS_KEY: 'REFRESHEDSECRET', AWS_SESSION_TOKEN: 'REFRESHEDTOKEN' };
    const result = spawnSync(process.execPath, [script], { cwd: outside, env: { ...process.env, ...refreshed }, encoding: 'utf8' });
    expect(result.status).toBe(0);
    for (const value of Object.values(refreshed)) expect(result.stdout + result.stderr).not.toContain(value);
    const environment = { AWS_ACCESS_KEY_ID: 'EXPIREDKEY', AWS_SECRET_ACCESS_KEY: 'EXPIREDSECRET', AWS_SESSION_TOKEN: 'EXPIREDTOKEN' };
    loadAwsSession({ file, environment });
    expect(environment).toEqual({ ...refreshed, AWS_REGION: 'us-east-1', BEDROCK_MODEL_ID: 'preserved-model' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(join(outside, '.dev.vars'))).toBe(false);
  });
});
