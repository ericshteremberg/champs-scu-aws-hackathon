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

describe("AWS review-only submission boundary", () => {
  it.each(["true", "false"])("blocks submissions even with legacy enable flag %s", async (flag) => {
    const h = harness();
    await h.ready();
    h.env.STRIPE_ENABLE_SUBMISSION = flag;
    const before = structuredClone([...h.records]);
    h.commit.mockClear(); h.client.mockClear();
    expect(h.service.configuration(workspace).submissionEnabled).toBe(false);
    await expect(submit(h)).rejects.toMatchObject({ status: 409, code: "submission_disabled" });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.client).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
    expect([...h.records]).toEqual(before);
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

describe('Review-only Stripe draft boundary', () => {
  it.each(['true', 'false'])('blocks draft writes even with legacy flag %s', async flag => {
    const h = harness(); await h.ready();
    h.env.STRIPE_ENABLE_DRAFT_WRITES = flag;
    const before = structuredClone([...h.records]);
    h.commit.mockClear(); h.client.mockClear();
    expect(h.service.configuration(workspace).draftWritesEnabled).toBe(false);
    await expect(saveDraft(h)).rejects.toMatchObject({ status: 409, code: 'submission_disabled' });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.client).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
    expect([...h.records]).toEqual(before);
  });
});
