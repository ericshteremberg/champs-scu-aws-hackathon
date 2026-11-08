import express, { type Request, type Response, type NextFunction } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { loadConfig, publicConfig, type ServerConfig } from './config.js';
import { Store } from './store.js';
import { demoCases } from './fixtures.js';
import { Investigator } from './investigator.js';
import { HttpError } from './errors.js';
import { exportMarkdown, reportEvidenceIds, validateReport } from './report.js';

export function createApp(config = loadConfig(), providedStore?: Store) {
  const store = providedStore || new Store(config.databasePath, demoCases);
  const investigator = new Investigator(config, store);
  const app = express();
  const sessions = new Map<string, number>();
  const attempts = new Map<string, { count: number; until: number }>();
  const lifecycle = new AbortController();
  let closing = false;
  const s3 = config.archiveBucket ? new S3Client({ region: config.awsRegion, maxAttempts: 2, requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 } }) : undefined;
  const sessionKey = (value: string) => createHash('sha256').update(value).digest('hex');
  const tokenMatches = (given: string, expected: string) => {
    const a = Buffer.from(sessionKey(given)); const b = Buffer.from(sessionKey(expected));
    return timingSafeEqual(a, b);
  };
  const isAuthorized = (request: Request) => {
    if (!config.accessToken) return true;
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ') && tokenMatches(authorization.slice(7), config.accessToken)) return true;
    const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('casework_session='))?.slice('casework_session='.length);
    if (!cookie) return false;
    const key = sessionKey(cookie); const expires = sessions.get(key);
    if (expires && expires > Date.now()) return true;
    sessions.delete(key); return false;
  };
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', (request, _response, next) => {
    if (closing) return next(new HttpError(503, 'The workspace is shutting down. Try again after it restarts.', 'SHUTTING_DOWN'));
    if (!config.accessToken && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(request.hostname)) return next(new HttpError(403, 'The local demo only accepts requests addressed to localhost.', 'INVALID_HOST'));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin) {
        const localOrigins = new Set([`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, 'http://127.0.0.1:5173', 'http://localhost:5173']);
        let allowed = false;
        try { const parsed = new URL(origin); allowed = config.appOrigin ? parsed.origin === config.appOrigin : localOrigins.has(parsed.origin); } catch { /* invalid origin */ }
        if (!allowed) return next(new HttpError(403, 'This request originated from an unapproved site.', 'INVALID_ORIGIN'));
      }
    }
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
  app.get('/api/config', (_request, response) => response.json(publicConfig(config)));
  app.post('/api/session', (request, response) => {
    if (!config.accessToken) { response.json({ authenticated: true }); return; }
    const ip = request.ip || 'unknown';
    const previous = attempts.get(ip); const now = Date.now();
    const attempt = previous && previous.until > now ? previous : { count: 0, until: now + 60000 };
    if (attempt.count >= 10) throw new HttpError(429, 'Too many sign-in attempts. Try again in one minute.', 'RATE_LIMIT');
    attempt.count++; attempts.set(ip, attempt);
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const parsed = z.object({ token: z.string().min(1).max(1024) }).safeParse(request.body);
    if (!parsed.success || !tokenMatches(parsed.data.token, config.accessToken)) throw new HttpError(401, 'The workspace access token is incorrect.', 'UNAUTHORIZED');
    attempts.delete(ip);
    for (const [key, expires] of sessions) if (expires < now) sessions.delete(key);
    if (sessions.size >= 100) throw new HttpError(429, 'The workspace has reached its active session limit.', 'SESSION_LIMIT');
    const token = randomBytes(32).toString('hex');
    sessions.set(sessionKey(token), now + 8 * 60 * 60 * 1000);
    response.cookie('casework_session', token, { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000, path: '/api' });
    response.json({ authenticated: true });
  });
  app.use('/api', (request, _response, next) => isAuthorized(request) ? next() : next(new HttpError(401, 'Sign in with the workspace access token.', 'UNAUTHORIZED')));
  app.delete('/api/session', (request, response) => {
    const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('casework_session='))?.slice('casework_session='.length);
    if (cookie) sessions.delete(sessionKey(cookie));
    response.clearCookie('casework_session', { path: '/api' }); response.json({ authenticated: false });
  });
  app.get('/api/cases', (_request, response) => response.json({ cases: store.listCases() }));
  app.post('/api/cases/import', async (request, response) => {
    const parsed = z.object({ caseId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/) }).strict().safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'Enter a valid approved case ID.', 'INVALID_CASE_ID');
    if (store.getCase(parsed.data.caseId)) throw new HttpError(409, 'This case is already in the workspace.', 'CASE_EXISTS');
    const item = await investigator.provider.importCase(parsed.data.caseId, AbortSignal.any([lifecycle.signal, AbortSignal.timeout(20000)]));
    if (closing) throw new HttpError(503, 'The workspace is shutting down. Try importing the case after it restarts.', 'SHUTTING_DOWN');
    if (store.getCase(item.id)) throw new HttpError(409, 'This case is already in the workspace.', 'CASE_EXISTS');
    store.saveCase(item); response.status(201).json({ case: item });
  });
  app.get('/api/cases/:id', (request, response) => {
    const item = store.getCase(String(request.params.id));
    if (!item) throw new HttpError(404, 'Case not found.', 'NOT_FOUND');
    response.json({ case: item, latestRun: item.latestRunId ? store.getRun(item.latestRunId) : undefined });
  });
  app.post('/api/cases/:id/investigate', (request, response) => {
    const item = store.getCase(String(request.params.id));
    if (!item) throw new HttpError(404, 'Case not found.', 'NOT_FOUND');
    response.status(202).json({ run: investigator.start(item) });
  });
  app.get('/api/runs/:id', (request, response) => {
    const run = store.getRun(String(request.params.id));
    if (!run) throw new HttpError(404, 'Investigation not found.', 'NOT_FOUND');
    response.json({ run });
  });
  app.post('/api/runs/:id/stop', (request, response) => response.json({ run: investigator.stop(String(request.params.id)) }));
  app.post('/api/cases/:id/review', (request, response) => {
    const parsed = z.object({ runId: z.string().min(1).max(100), responseDraft: z.string().trim().min(1).max(20000), reviewerNote: z.string().max(4000).optional() }).strict().safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'Provide the investigation ID, a response draft, and an optional review note.', 'INVALID_REVIEW');
    const item = store.getCase(String(request.params.id));
    const run = store.getRun(parsed.data.runId);
    if (!item || !run || run.caseId !== item.id) throw new HttpError(404, 'Case investigation not found.', 'NOT_FOUND');
    if (item.latestRunId !== run.id || run.status !== 'completed' || !run.report) throw new HttpError(409, 'Review the latest completed investigation for this case.', 'REPORT_NOT_READY');
    validateReport({ summary: run.report.summary, assessment: run.report.assessment, recommendation: run.report.recommendation, findings: run.report.findings, gaps: run.report.gaps, responseDraft: parsed.data.responseDraft }, run.evidence);
    run.report.responseDraft = parsed.data.responseDraft;
    run.report.evidenceIds = reportEvidenceIds(run.report);
    run.report.reviewedAt = new Date().toISOString(); run.report.reviewerNote = parsed.data.reviewerNote;
    store.saveRun(run); item.status = 'reviewed'; store.saveCase(item);
    response.json({ run });
  });
  app.post('/api/cases/:id/archive', async (request, response) => {
    if (!s3 || !config.archiveBucket) throw new HttpError(409, 'S3 archival is not configured for this workspace.', 'ARCHIVE_NOT_CONFIGURED');
    const parsed = z.object({ runId: z.string().min(1).max(100) }).strict().safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'Provide the reviewed investigation ID.', 'INVALID_ARCHIVE');
    const item = store.getCase(String(request.params.id));
    const run = store.getRun(parsed.data.runId);
    if (!item || !run || run.caseId !== item.id) throw new HttpError(404, 'Case investigation not found.', 'NOT_FOUND');
    if (run.status !== 'completed' || !run.report?.reviewedAt) throw new HttpError(409, 'Review the response before archiving the evidence packet.', 'REVIEW_REQUIRED');
    const packet = { version: 1, reviewedAt: run.report.reviewedAt, case: { ...item, status: 'reviewed', latestRunId: run.id }, report: run.report, evidence: run.evidence, investigationMode: run.mode };
    const body = JSON.stringify(packet, null, 2);
    const digest = createHash('sha256').update(body).digest('hex');
    const key = `evidence/${item.id}/${run.id}/${digest}.json`;
    try {
      await s3.send(new PutObjectCommand({ Bucket: config.archiveBucket, Key: key, Body: body, ContentType: 'application/json', ServerSideEncryption: 'AES256' }), { abortSignal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15000)]) });
    } catch { throw new HttpError(502, 'The reviewed packet could not be archived to S3. Check bucket permissions and try again.', 'ARCHIVE_FAILED'); }
    response.json({ archived: true, key, sha256: digest });
  });
  app.get('/api/cases/:id/export', (request, response) => {
    const item = store.getCase(String(request.params.id));
    const runId = typeof request.query.runId === 'string' ? request.query.runId : item?.latestRunId;
    const format = request.query.format || 'markdown';
    if (format !== 'markdown' && format !== 'json') throw new HttpError(400, 'Export format must be markdown or json.', 'INVALID_FORMAT');
    const run = runId ? store.getRun(runId) : undefined;
    if (!item || !run || run.caseId !== item.id) throw new HttpError(404, 'Case investigation not found.', 'NOT_FOUND');
    if (run.status !== 'completed' || !run.report?.reviewedAt) throw new HttpError(409, 'Review the response before exporting the evidence packet.', 'REVIEW_REQUIRED');
    const contentType = format === 'json' ? 'application/json' : 'text/markdown';
    const extension = format === 'json' ? 'json' : 'md';
    const packet = { version: 1, exportedAt: new Date().toISOString(), case: item, report: run.report, evidence: run.evidence, investigationMode: run.mode };
    const body = format === 'json' ? JSON.stringify(packet, null, 2) : exportMarkdown(item, run);
    response.setHeader('Content-Type', `${contentType}; charset=utf-8`);
    response.setHeader('Content-Disposition', `attachment; filename="casework-${item.id}.${extension}"`);
    response.send(body);
  });
  app.use('/api', (_request, _response, next) => next(new HttpError(404, 'API route not found.', 'NOT_FOUND')));
  const dist = resolve('dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false }));
    app.get('/{*path}', (_request, response) => response.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    if (error instanceof HttpError) { response.status(error.status).json({ error: error.message, code: error.code }); return; }
    if (error instanceof SyntaxError || (error && typeof error === 'object' && 'type' in error && ['entity.too.large', 'entity.parse.failed'].includes(String(error.type)))) { response.status(400).json({ error: 'The request body is invalid or too large.', code: 'INVALID_BODY' }); return; }
    console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
    response.status(500).json({ error: 'The request could not be completed. Try again.', code: 'INTERNAL_ERROR' });
  });
  return { app, store, investigator, async close() { if (closing) return; closing = true; lifecycle.abort(); await investigator.shutdown(); s3?.destroy(); if (!providedStore) store.close(); } };
}
