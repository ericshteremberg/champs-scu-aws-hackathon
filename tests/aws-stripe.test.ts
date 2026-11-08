import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createStripeService, type StripeConnection } from "../aws/stripe.ts";
import { keys } from "../aws/store.ts";
import {
  ConflictError,
  type CaseDoc,
  type DraftDoc,
  type Stored,
  type StoreChange,
} from "../aws/types.ts";

const workspace = "ws_test_owner";
function fixture(overrides: Partial<Stripe.Dispute> = {}): Stripe.Dispute {
  return {
    id: "dp_ticket_1042",
    object: "dispute",
    amount: 12500,
    currency: "usd",
    reason: "product_not_received",
    status: "needs_response",
    created: 1762000000,
    livemode: false,
    charge: "ch_ticket",
    evidence: {
      customer_name: "Synthetic customer",
      customer_email_address: "customer@example.test",
    },
    evidence_details: {
      due_by: 1763000000,
      past_due: false,
      has_evidence: false,
      submission_count: 0,
    },
    metadata: { order_id: "ATM-1042" },
    ...overrides,
  } as Stripe.Dispute;
}
const caseId = `stripe_${workspace}_dp_ticket_1042`;

function harness(sdk?: Stripe) {
  const records = new Map<string, Stored<unknown>>();
  const mapKey = (wid: string, key: string) => `${wid}/${key}`;
  let beforeCommit: ((changes: StoreChange[]) => void) | undefined;
  const read = <T>(key: string, wid = workspace) =>
    structuredClone(records.get(mapKey(wid, key)) ?? null) as Stored<T> | null;
  const put = (key: string, data: unknown, wid = workspace) => {
    const previous = records.get(mapKey(wid, key));
    records.set(mapKey(wid, key), {
      key,
      version: (previous?.version ?? 0) + 1,
      data: structuredClone(data),
    });
  };
  const getItem = async <T>(
    wid: string,
    key: string,
  ): Promise<Stored<T> | null> => read<T>(key, wid);
  const queryItems = async <T>(
    wid: string,
    prefix: string,
  ): Promise<Stored<T>[]> =>
    [...records.entries()]
      .filter(
        ([key, value]) =>
          key.startsWith(`${wid}/`) && value.key.startsWith(prefix),
      )
      .map(([, value]) => structuredClone(value) as Stored<T>);
  const commit = vi.fn(async (wid: string, changes: StoreChange[]) => {
    beforeCommit?.(changes);
    for (const change of changes) {
      const value = records.get(mapKey(wid, change.key));
      if ((value?.version ?? null) !== change.expectedVersion)
        throw new ConflictError();
    }
    for (const change of changes) {
      if (change.check) continue;
      if (change.delete) records.delete(mapKey(wid, change.key));
      else put(change.key, change.data, wid);
    }
  });
  const env = {
    STRIPE_RESTRICTED_KEY: "rk_test_synthetic",
    STRIPE_WORKSPACE_ID: workspace,
    STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
    STRIPE_ENABLE_SUBMISSION: "true",
    STRIPE_ENABLE_DRAFT_WRITES: "true",
    STRIPE_ALLOW_LIVE: "false",
  };
  const current = fixture();
  const account = {
    id: "acct_test",
    business_profile: { name: "Synthetic organizer" },
  };
  const list = vi.fn(async () => ({ data: [current], has_more: false }));
  const retrieve = vi.fn(async () => current);
  const update = vi.fn(async () => fixture({ status: "under_review" }));
  const event = {
    id: "evt_one",
    type: "charge.dispute.updated",
    livemode: false,
    account: account.id,
    data: { object: current },
  } as Stripe.Event;
  const verify = vi.fn(async () => event);
  const retrieveAccount = vi.fn(async () => account);
  const client = vi.fn(
    () =>
      ({
        accounts: { retrieveCurrent: retrieveAccount },
        disputes: { list, retrieve, update },
        webhooks: { constructEventAsync: verify },
      }) as unknown as Stripe,
  );
  const service = createStripeService({
    getItem,
    queryItems,
    commit,
    settings: () => env,
    client: sdk ? () => sdk : client,
  });
  const connection: StripeConnection = {
    accountId: account.id,
    accountName: "Synthetic organizer",
    mode: "test",
    connected: true,
    createdAt: "2026-01-01T00:00:00Z",
  };
  put(keys.stripe, connection);
  async function ready() {
    await service.syncStripe(workspace, "Reviewer");
    const row = read<CaseDoc>(keys.case(caseId))!;
    put(row.key, { ...row.data, status: "ready" });
    const draft: DraftDoc = {
      caseId,
      revision: 3,
      sourceRevision: row.data.dataRevision,
      content: "Reviewed response with the original source citation.",
      status: "approved",
      generatedAt: "2026-01-01T00:00:00Z",
      approvedAt: "2026-01-02T00:00:00Z",
      approvedBy: "Reviewer",
      method: "evidence_template",
    };
    put(keys.draft(caseId), draft);
  }
  return {
    service,
    records,
    env,
    current,
    account,
    event,
    connection,
    read,
    put,
    ready,
    list,
    retrieve,
    update,
    verify,
    client,
    retrieveAccount,
    commit,
    beforeCommit: (callback?: (changes: StoreChange[]) => void) => {
      beforeCommit = callback;
    },
  };
}

const submit = (h: ReturnType<typeof harness>) =>
  h.service.submitStripe(workspace, "Reviewer", {
    caseId,
    confirmed: true,
    draftRevision: 3,
  });

describe("AWS Stripe integration guards and synchronization", () => {
  it("requires the configured workspace and blocks live access before requesting Stripe", async () => {
    const h = harness();
    expect(h.service.configuration("other_workspace").configured).toBe(false);
    await expect(
      h.service.connectStripe("other_workspace", "Reviewer"),
    ).rejects.toMatchObject({ status: 503 });
    h.env.STRIPE_RESTRICTED_KEY = "rk_live_synthetic";
    await expect(
      h.service.connectStripe(workspace, "Reviewer"),
    ).rejects.toMatchObject({ code: "stripe_live_disabled" });
    h.env.STRIPE_RESTRICTED_KEY = "sk_test_not_restricted";
    await expect(
      h.service.connectStripe(workspace, "Reviewer"),
    ).rejects.toMatchObject({ code: "stripe_configuration_required" });
    expect(h.client).not.toHaveBeenCalled();
  });

  it("does not rebind an existing workspace even after disconnect", async () => {
    const h = harness();
    await h.service.disconnectStripe(workspace, "Reviewer");
    h.account.id = "acct_other";
    await expect(
      h.service.connectStripe(workspace, "Reviewer"),
    ).rejects.toMatchObject({ code: "stripe_account_mismatch" });
    expect(h.read<StripeConnection>(keys.stripe)?.data.accountId).toBe(
      "acct_test",
    );
    expect(h.read<StripeConnection>(keys.stripe)?.data.connected).toBe(false);
  });

  it("checks dispute read permissions before connecting and reports status accurately", async () => {
    const h = harness();
    await h.service.disconnectStripe(workspace, "Reviewer");
    h.list.mockRejectedValueOnce(
      new Error("Restricted key lacks read permission"),
    );
    await expect(
      h.service.connectStripe(workspace, "Reviewer"),
    ).rejects.toThrow("read permission");
    expect((await h.service.listStripeIntegration(workspace)).status).toBe(
      "configuration_required",
    );
    await h.service.connectStripe(workspace, "Reviewer");
    expect((await h.service.listStripeIntegration(workspace)).status).toBe(
      "connected",
    );
  });

  it("preserves reviewed revisions on unchanged sync and invalidates changed evidence once", async () => {
    const h = harness();
    await h.ready();
    await h.service.syncStripe(workspace, "Reviewer");
    expect(h.read<DraftDoc>(keys.draft(caseId))?.data).toMatchObject({
      revision: 3,
      status: "approved",
      sourceRevision: 1,
    });
    expect(h.read<CaseDoc>(keys.case(caseId))?.data).toMatchObject({
      status: "ready",
      dataRevision: 1,
    });
    h.list.mockResolvedValue({
      data: [fixture({ amount: 15000 })],
      has_more: false,
    });
    await h.service.syncStripe(workspace, "Reviewer");
    expect(h.read<DraftDoc>(keys.draft(caseId))?.data).toMatchObject({
      revision: 4,
      status: "draft",
      approvedAt: undefined,
    });
    expect(h.read<CaseDoc>(keys.case(caseId))?.data).toMatchObject({
      status: "needs_review",
      dataRevision: 2,
    });
    await h.service.syncStripe(workspace, "Reviewer");
    expect(h.read<DraftDoc>(keys.draft(caseId))?.data.revision).toBe(4);
  });

  it("continues pagination and never rewinds a terminal case status", async () => {
    const h = harness();
    h.list.mockResolvedValueOnce({
      data: [fixture({ status: "won" })],
      has_more: true,
    });
    expect(await h.service.syncStripe(workspace, "Reviewer")).toEqual({
      imported: 1,
      hasMore: true,
    });
    await h.service.syncStripe(workspace, "Reviewer");
    expect(h.list).toHaveBeenLastCalledWith({
      limit: 50,
      starting_after: h.current.id,
    });
    expect(h.read<CaseDoc>(keys.case(caseId))?.data.status).toBe("won");
    expect(h.read<StripeConnection>(keys.stripe)?.data.nextCursor).toBeNull();
  });
});

describe("AWS atomic Stripe submission", () => {
  it("allows exactly one parallel claim and sends the exact approved revision with an idempotency key", async () => {
    const h = harness();
    await h.ready();
    const results = await Promise.allSettled([submit(h), submit(h)]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledWith(
      h.current.id,
      {
        evidence: {
          uncategorized_text:
            "Reviewed response with the original source citation.",
        },
        submit: true,
      },
      { idempotencyKey: `causality:${workspace}:${caseId}:revision:3` },
    );
    expect(h.read<CaseDoc>(keys.case(caseId))?.data.status).toBe("submitted");
  });

  it("blocks a claim when evidence changes between validation and the atomic write", async () => {
    const h = harness();
    await h.ready();
    h.beforeCommit((changes) => {
      if (
        !changes.some(
          (change) =>
            (change.data as CaseDoc | undefined)?.status === "submitting",
        )
      )
        return;
      h.beforeCommit();
      const row = h.read<CaseDoc>(keys.case(caseId))!;
      h.put(row.key, { ...row.data, dataRevision: row.data.dataRevision + 1 });
    });
    await expect(submit(h)).rejects.toMatchObject({ code: "stale_submission" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("blocks a claim when the connection changes during validation", async () => {
    const h = harness();
    await h.ready();
    h.beforeCommit((changes) => {
      if (
        !changes.some(
          (change) =>
            (change.data as CaseDoc | undefined)?.status === "submitting",
        )
      )
        return;
      h.beforeCommit();
      h.put(keys.stripe, { ...h.connection, connected: false });
    });
    await expect(submit(h)).rejects.toMatchObject({ code: "stale_submission" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("keeps an uncertain submission locked and does not resend it", async () => {
    const h = harness();
    await h.ready();
    h.update.mockRejectedValue(new Error("Network result is unknown"));
    await expect(submit(h)).rejects.toMatchObject({
      status: 502,
      code: "submission_verification_required",
    });
    expect(h.read<CaseDoc>(keys.case(caseId))?.data.status).toBe("submitting");
    await expect(submit(h)).rejects.toThrow("submission is being verified");
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(
      [...h.records.values()].some(
        (row) =>
          (row.data as { action?: string }).action ===
          "stripe.submission_verification_required",
      ),
    ).toBe(true);
    // A needs_response sync must not unfreeze or rewrite evidence from the pending attempt.
    h.list.mockResolvedValue({
      data: [fixture({ amount: 14000 })],
      has_more: false,
    });
    await h.service.syncStripe(workspace, "Reviewer");
    expect(h.read<CaseDoc>(keys.case(caseId))?.data).toMatchObject({
      status: "submitting",
      dataRevision: 1,
    });
  });

  it("keeps the claim locked if Stripe succeeds but persistence cannot settle", async () => {
    const h = harness();
    await h.ready();
    h.beforeCommit((changes) => {
      if (
        changes.some(
          (change) =>
            (change.data as CaseDoc | undefined)?.status === "submitted",
        )
      )
        throw new Error("DynamoDB temporarily unavailable");
    });
    await expect(submit(h)).rejects.toMatchObject({
      code: "submission_verification_required",
    });
    expect(h.read<CaseDoc>(keys.case(caseId))?.data.status).toBe("submitting");
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it.each([
    "source_revision",
    "unapproved",
    "wrong_revision",
    "unconfirmed",
    "attachment",
    "expired",
    "wrong_mode",
    "wrong_owner",
    "disabled",
  ] as const)("rejects %s before sending", async (scenario) => {
    const h = harness();
    await h.ready();
    const draft = h.read<DraftDoc>(keys.draft(caseId))!;
    if (scenario === "source_revision")
      h.put(draft.key, { ...draft.data, sourceRevision: 0 });
    if (scenario === "unapproved")
      h.put(draft.key, { ...draft.data, status: "draft" });
    if (scenario === "attachment")
      h.put(keys.evidence(caseId, "file"), {
        id: "file",
        caseId,
        fileKey: "private/attachment.pdf",
      });
    if (scenario === "expired")
      h.retrieve.mockResolvedValue(
        fixture({
          evidence_details: { ...h.current.evidence_details, past_due: true },
        }),
      );
    if (scenario === "wrong_mode")
      h.retrieve.mockResolvedValue(fixture({ livemode: true }));
    if (scenario === "disabled") h.env.STRIPE_ENABLE_SUBMISSION = "false";
    await expect(
      h.service.submitStripe(workspace, "Reviewer", {
        caseId: scenario === "wrong_owner" ? "another_workspace_case" : caseId,
        confirmed: scenario !== "unconfirmed",
        draftRevision: scenario === "wrong_revision" ? 2 : 3,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe("AWS Stripe webhook verification and replay protection", () => {
  it("verifies the exact raw body and rejects invalid signatures before reading account or updating storage", async () => {
    const h = harness();
    h.verify.mockRejectedValue(new Error("Invalid signature"));
    const raw = '{ "preserve": "  whitespace  " }';
    await expect(
      h.service.handleStripeWebhook(raw, "t=1,v1=invalid"),
    ).rejects.toMatchObject({ status: 400, code: "invalid_signature" });
    expect(h.verify.mock.calls[0]?.slice(0, 3)).toEqual([
      raw,
      "t=1,v1=invalid",
      "whsec_synthetic",
    ]);
    expect(h.retrieveAccount).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("atomically deduplicates concurrent deliveries without invalidating a reviewed draft twice", async () => {
    const h = harness();
    await h.ready();
    h.retrieve.mockResolvedValue(fixture({ amount: 16000 }));
    const result = await Promise.all([
      h.service.handleStripeWebhook("{}", "valid"),
      h.service.handleStripeWebhook("{}", "valid"),
    ]);
    expect(
      result.filter((value) => "duplicate" in value && value.duplicate),
    ).toHaveLength(1);
    expect(h.read<DraftDoc>(keys.draft(caseId))?.data).toMatchObject({
      revision: 4,
      status: "draft",
    });
    expect(h.read<CaseDoc>(keys.case(caseId))?.data.dataRevision).toBe(2);
    expect(h.read(keys.stripeEvent(h.event.id))).toBeTruthy();
    await h.service.handleStripeWebhook("{}", "valid");
    expect(h.read<DraftDoc>(keys.draft(caseId))?.data.revision).toBe(4);
  });

  it("rejects a verified event from another account or environment", async () => {
    const h = harness();
    h.event.account = "acct_wrong";
    await expect(h.service.handleStripeWebhook("{}", "valid")).rejects.toThrow(
      "account or environment mismatch",
    );
    expect(h.retrieve).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
  });
});

const saveDraft = (h: ReturnType<typeof harness>, overrides = {}) =>
  h.service.saveStripeDraft(workspace, 'Reviewer', { caseId, confirmed: true, draftRevision: 3, autoSubmitAcknowledged: true, ...overrides });

describe('Stripe draft writes', () => {
  it('requires a separate enable flag and auto-response acknowledgement', async () => {
    const h = harness(); await h.ready();
    await expect(saveDraft(h, { autoSubmitAcknowledged: false })).rejects.toMatchObject({ code: 'auto_submit_ack_required' });
    h.env.STRIPE_ENABLE_DRAFT_WRITES = 'false';
    await expect(saveDraft(h)).rejects.toMatchObject({ code: 'submission_disabled' });
    expect(h.update).not.toHaveBeenCalled();
  });
  it.each(['unapproved', 'stale', 'unconfirmed', 'existing text'])('blocks %s drafts before writing', async kind => {
    const h = harness(); await h.ready();
    const row = h.read<DraftDoc>(keys.draft(caseId))!;
    if (kind === 'unapproved') h.put(row.key, { ...row.data, status: 'draft' });
    if (kind === 'stale') h.put(row.key, { ...row.data, sourceRevision: -1 });
    if (kind === 'existing text') h.current.evidence.uncategorized_text = 'Someone else’s saved response';
    await expect(saveDraft(h, { confirmed: kind !== 'unconfirmed' })).rejects.toMatchObject({ status: 409 });
    expect(h.update).not.toHaveBeenCalled();
  });
  it('keeps an uncertain draft write locked for reconciliation', async () => {
    const h = harness(); await h.ready();
    h.update.mockRejectedValueOnce(new Error('connection lost'));
    await expect(saveDraft(h)).rejects.toMatchObject({ status: 502 });
    expect(h.read<CaseDoc>(keys.case(caseId))?.data.status).toBe('submitting');
    await expect(saveDraft(h)).rejects.toMatchObject({ status: 409 });
    expect(h.update).toHaveBeenCalledTimes(1);
  });
  it('does not report a draft save when Stripe returns a submitted response', async () => {
    const h = harness(); await h.ready();
    await expect(saveDraft(h)).rejects.toMatchObject({ code: 'submission_verification_required' });
    expect(h.read<CaseDoc>(keys.case(caseId))?.data.status).toBe('submitting');
  });
  it('rehearses both write modes with the actual Stripe SDK and zero network requests', async () => {
    // Every SDK HTTP operation terminates here; there is no fetch/network fallback.
    const intercepted: { method: string; path: string; body: string; idempotencyKey: string | null }[] = [];
    let remote = fixture();
    const transport = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      const method = init?.method || 'GET';
      const body = String(init?.body || '');
      const headers = new Headers(init?.headers);
      intercepted.push({ method, path: url.pathname, body, idempotencyKey: headers.get('idempotency-key') });
      let result: unknown;
      if (method === 'GET' && url.pathname === '/v1/account') result = { id: 'acct_test', object: 'account', business_profile: { name: 'Synthetic organizer' } };
      else if (method === 'GET' && url.pathname === '/v1/disputes') result = { object: 'list', data: [remote], has_more: false, url: '/v1/disputes' };
      else if (method === 'GET' && url.pathname === `/v1/disputes/${remote.id}`) result = remote;
      else if (method === 'POST' && url.pathname === `/v1/disputes/${remote.id}`) {
        const params = new URLSearchParams(body);
        const submitted = params.get('submit') === 'true';
        remote = fixture({
          evidence: { ...remote.evidence, uncategorized_text: params.get('evidence[uncategorized_text]') || '' },
          status: submitted ? 'under_review' : 'needs_response',
          evidence_details: { ...remote.evidence_details, has_evidence: true, submission_count: submitted ? 1 : 0 },
        }); result = remote;
      } else throw new Error(`Unexpected SDK request ${method} ${url.pathname}`);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_local_rehearsal' } });
    };
    const sdk = new Stripe('rk_test_synthetic_rehearsal', { httpClient: Stripe.createFetchHttpClient(transport as typeof fetch), maxNetworkRetries: 0, telemetry: false });
    const h = harness(sdk); await h.ready();
    const { readFile, writeFile } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const report = process.env.STRIPE_REHEARSAL_REPORT ? await readFile(process.env.STRIPE_REHEARSAL_REPORT, 'utf8') : 'Reviewed synthetic report.\nStripe payment + Supabase order + Resend email.\nDelivery ≠ reading. Symbols: & + %.';
    const draft = h.read<DraftDoc>(keys.draft(caseId))!;
    h.put(draft.key, { ...draft.data, content: report });
    h.env.STRIPE_ENABLE_SUBMISSION = 'false';
    await expect(saveDraft(h)).resolves.toMatchObject({ saved: true, submitted: false });
    expect(h.read<CaseDoc>(keys.case(caseId))?.data.status).toBe('ready');
    await expect(submit(h)).rejects.toMatchObject({ code: 'submission_disabled' });
    h.env.STRIPE_ENABLE_SUBMISSION = 'true';
    const attempts = await Promise.allSettled([submit(h), submit(h)]);
    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
    expect(h.read<CaseDoc>(keys.case(caseId))?.data.status).toBe('submitted');
    const writes = intercepted.filter(r => r.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes.map(r => new URLSearchParams(r.body).get('submit'))).toEqual(['false', 'true']);
    for (const request of writes) expect(new URLSearchParams(request.body).get('evidence[uncategorized_text]')).toBe(report);
    expect(writes[0].idempotencyKey).not.toBe(writes[1].idempotencyKey);
    expect(writes[0].idempotencyKey).toContain(':revision:3:draft');
    const proof = {
      kind: 'LOCAL_SIMULATION_NOT_STRIPE_ACCEPTANCE', generatedAt: new Date().toISOString(),
      networkRequests: 0, sdk: 'stripe@23.0.0', reportSha256: createHash('sha256').update(report).digest('hex'), reportCharacters: report.length,
      syntheticDispute: remote.id, draftThenFinal: writes.map(r => ({ path: r.path, submit: new URLSearchParams(r.body).get('submit'), idempotencyKey: r.idempotencyKey })),
      exactReportPreserved: true, concurrentFinalWrites: 1, liveDisputeTouched: false,
    };
    if (process.env.STRIPE_REHEARSAL_PROOF) await writeFile(process.env.STRIPE_REHEARSAL_PROOF, JSON.stringify(proof, null, 2) + '\n');
  });
});
