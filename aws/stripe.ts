import Stripe from "stripe";
import type { Integration } from "../lib/domain.ts";
import {
  accountBindingError,
  normalizeDispute,
  performClaimedSubmission,
  submissionEligibility,
} from "../lib/stripe/model.ts";
import { commit, getItem, keys, queryItems } from "./store.ts";
import {
  ApiError,
  ConflictError,
  mutableStatuses,
  type AuditDoc,
  type CaseDoc,
  type DraftDoc,
  type EvidenceDoc,
  type StoreChange,
} from "./types.ts";

type StripeSettings = {
  STRIPE_RESTRICTED_KEY?: string;
  STRIPE_WORKSPACE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_ALLOW_LIVE?: string;
  STRIPE_ENABLE_SUBMISSION?: string;
};
export type StripeConnection = {
  accountId: string;
  accountName: string;
  mode: "test" | "live";
  connected: boolean;
  createdAt: string;
  lastSyncAt?: string;
  nextCursor?: string | null;
};
type StripeEvent = {
  id: string;
  accountId: string;
  eventType: string;
  processedAt: string;
};
type Dependencies = {
  getItem: typeof getItem;
  queryItems: typeof queryItems;
  commit: typeof commit;
  settings: () => StripeSettings;
  client: (key: string) => Stripe;
};

/** Each source update and submission claim checks the case's DynamoDB version. */
export function createStripeService(dependencies: Dependencies) {
  const {
    getItem: read,
    queryItems: query,
    commit: write,
    settings,
  } = dependencies;
  const configuredMode = (): "live" | "test" =>
    settings().STRIPE_RESTRICTED_KEY?.startsWith("rk_live_") ? "live" : "test";
  const timestamp = () => new Date().toISOString();
  function configuration(workspaceId: string) {
    const env = settings();
    const missing: string[] = [];
    if (!env.STRIPE_RESTRICTED_KEY) missing.push("STRIPE_RESTRICTED_KEY");
    if (env.STRIPE_WORKSPACE_ID !== workspaceId)
      missing.push("STRIPE_WORKSPACE_ID");
    return {
      configured: !missing.length,
      requiredConfiguration: missing,
      submissionEnabled: env.STRIPE_ENABLE_SUBMISSION === "true",
      webhookConfigured: !!env.STRIPE_WEBHOOK_SECRET,
      workspaceId,
    };
  }
  function client(workspaceId: string) {
    if (!configuration(workspaceId).configured)
      throw new ApiError(
        503,
        "Stripe is not connected. Configure a restricted API key and this workspace ID on the server.",
        "stripe_configuration_required",
      );
    const env = settings();
    const key = env.STRIPE_RESTRICTED_KEY!;
    if (!/^rk_(test|live)_/.test(key))
      throw new ApiError(
        503,
        "Use a restricted Stripe API key for this integration.",
        "stripe_configuration_required",
      );
    if (key.startsWith("rk_live_") && env.STRIPE_ALLOW_LIVE !== "true")
      throw new ApiError(
        403,
        "Live Stripe access is disabled for this deployment.",
        "stripe_live_disabled",
      );
    return dependencies.client(key);
  }
  function auditChange(
    actor: string,
    action: string,
    detail: string,
    caseId?: string,
  ): StoreChange {
    const id = crypto.randomUUID(),
      createdAt = timestamp();
    const data: AuditDoc = {
      id,
      actor,
      action,
      detail,
      createdAt,
      ...(caseId ? { caseId } : {}),
    };
    return { key: keys.audit(createdAt, id), expectedVersion: null, data };
  }
  async function connectionFor(workspaceId: string) {
    const connection = await read<StripeConnection>(workspaceId, keys.stripe);
    if (!connection?.data.connected)
      throw new ApiError(
        409,
        "Connect Stripe before importing disputes.",
        "stripe_not_connected",
      );
    return connection;
  }
  async function verifiedConnection(workspaceId: string) {
    const connection = await connectionFor(workspaceId),
      stripe = client(workspaceId);
    const account = await stripe.accounts.retrieveCurrent();
    const invalid = accountBindingError(
      connection.data,
      account.id,
      configuredMode(),
    );
    if (invalid) throw new ApiError(409, invalid, "stripe_account_mismatch");
    return { connection, stripe };
  }
  async function listStripeIntegration(
    workspaceId: string,
  ): Promise<Integration> {
    const row = await read<StripeConnection>(workspaceId, keys.stripe);
    const connection = row?.data;
    const connected =
      connection?.connected &&
      configuration(workspaceId).configured &&
      connection.mode === configuredMode();
    return {
      id: "stripe",
      provider: "stripe",
      name: "Stripe",
      status: connected ? "connected" : "configuration_required",
      mode: connected ? connection.mode : undefined,
      accountName: connected ? connection.accountName : undefined,
      lastSyncAt: connection?.lastSyncAt,
      description: connected
        ? "Dispute records are imported from your connected account."
        : "Connect your Stripe account when you are ready. Server configuration is required; no account is connected.",
    };
  }
  async function connectStripe(workspaceId: string, actor: string) {
    const stripe = client(workspaceId),
      account = await stripe.accounts.retrieveCurrent(),
      mode = configuredMode();
    const existing = await read<StripeConnection>(workspaceId, keys.stripe);
    if (
      existing &&
      (existing.data.accountId !== account.id || existing.data.mode !== mode)
    )
      throw new ApiError(
        409,
        "This workspace is already bound to a different Stripe account or environment. Use a separate workspace.",
        "stripe_account_mismatch",
      );
    await stripe.disputes.list({ limit: 1 });
    const value: StripeConnection = {
      ...existing?.data,
      accountId: account.id,
      accountName:
        account.business_profile?.name ||
        account.settings?.dashboard?.display_name ||
        "Stripe account",
      mode,
      connected: true,
      createdAt: existing?.data.createdAt ?? timestamp(),
    };
    await write(workspaceId, [
      {
        key: keys.stripe,
        expectedVersion: existing?.version ?? null,
        data: value,
      },
      auditChange(
        actor,
        "stripe.connected",
        `Connected ${mode} Stripe account.`,
      ),
    ]);
    return { connected: true };
  }
  async function disconnectStripe(workspaceId: string, actor: string) {
    const existing = await read<StripeConnection>(workspaceId, keys.stripe);
    await write(workspaceId, [
      ...(existing
        ? [
            {
              key: keys.stripe,
              expectedVersion: existing.version,
              data: { ...existing.data, connected: false, nextCursor: null },
            },
          ]
        : []),
      auditChange(
        actor,
        "stripe.disconnected",
        "Disconnected Stripe. Previously imported evidence is retained.",
      ),
    ]);
    return { disconnected: true };
  }

  async function importDispute(
    dispute: Stripe.Dispute,
    workspaceId: string,
    binding: StripeConnection,
    options: {
      event?: Stripe.Event;
      actor?: string;
      submissionRevision?: number;
    } = {},
  ) {
    if (dispute.livemode !== (binding.mode === "live"))
      throw new ApiError(
        409,
        "Stripe environment does not match the connected account.",
      );
    const normalized = normalizeDispute(
      dispute,
      workspaceId,
      binding.accountId,
    );
    const evidenceId = `${normalized.id}_stripe`;
    const content = `Stripe dispute ${dispute.id}\nDisputed amount: ${dispute.amount} minor units ${dispute.currency.toUpperCase()}\nReason: ${dispute.reason}\nStripe status: ${dispute.status}\nCharge: ${typeof dispute.charge === "string" ? dispute.charge : (dispute.charge?.id ?? "Unavailable")}\nThis record establishes the payment dispute, not proof of delivery.`;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const [row, original, draft, connected, event] = await Promise.all([
        read<CaseDoc>(workspaceId, keys.case(normalized.id)),
        read<EvidenceDoc>(
          workspaceId,
          keys.evidence(normalized.id, evidenceId),
        ),
        read<DraftDoc>(workspaceId, keys.draft(normalized.id)),
        connectionFor(workspaceId),
        options.event
          ? read<StripeEvent>(workspaceId, keys.stripeEvent(options.event.id))
          : Promise.resolve(null),
      ]);
      if (event) return { duplicate: true };
      const mismatch = accountBindingError(
        connected.data,
        binding.accountId,
        binding.mode,
      );
      if (mismatch)
        throw new ApiError(409, mismatch, "stripe_account_mismatch");
      if (
        row &&
        (row.data.source !== "stripe" ||
          row.data.stripeAccountId !== binding.accountId ||
          row.data.stripeDisputeId !== dispute.id)
      )
        throw new ApiError(
          409,
          "The case belongs to a different Stripe account.",
        );
      const changed = original?.data.content !== content;
      let status = normalized.status;
      if (row) {
        if (row.data.status === "won" || row.data.status === "lost")
          status = row.data.status;
        else if (!["submitted", "won", "lost"].includes(normalized.status)) {
          if (["submitting", "submitted"].includes(row.data.status) || !changed)
            status = row.data.status;
        }
      }
      // A pending submission freezes its source and exact approved response until Stripe confirms a result.
      const replaceEvidence = changed && status !== "submitting";
      const value: CaseDoc = row
        ? {
            ...row.data,
            amount: normalized.amount,
            currency: normalized.currency,
            dueAt: normalized.dueAt,
            updatedAt: normalized.updatedAt,
            status,
            dataRevision: row.data.dataRevision + (replaceEvidence ? 1 : 0),
          }
        : { ...normalized, source: "stripe", dataRevision: 1 };
      const changes: StoreChange[] = [
        {
          key: keys.case(normalized.id),
          expectedVersion: row?.version ?? null,
          data: value,
        },
        { key: keys.stripe, expectedVersion: connected.version, check: true },
      ];
      if (replaceEvidence)
        changes.push({
          key: keys.evidence(normalized.id, evidenceId),
          expectedVersion: original?.version ?? null,
          data: {
            id: evidenceId,
            caseId: normalized.id,
            source: "stripe",
            title: "Stripe dispute record",
            content,
            occurredAt: normalized.createdAt,
            reference: dispute.id,
            createdAt: original?.data.createdAt ?? normalized.updatedAt,
          } satisfies EvidenceDoc,
        });
      if (
        draft &&
        replaceEvidence &&
        row &&
        mutableStatuses.includes(row.data.status) &&
        !["submitted", "won", "lost"].includes(normalized.status)
      ) {
        changes.push({
          key: draft.key,
          expectedVersion: draft.version,
          data: {
            ...draft.data,
            status: "draft",
            approvedBy: undefined,
            approvedAt: undefined,
            revision: draft.data.revision + 1,
          } satisfies DraftDoc,
        });
      }
      if (options.event)
        changes.push({
          key: keys.stripeEvent(options.event.id),
          expectedVersion: null,
          data: {
            id: options.event.id,
            accountId: binding.accountId,
            eventType: options.event.type,
            processedAt: timestamp(),
          } satisfies StripeEvent,
        });
      if (options.submissionRevision !== undefined)
        changes.push(
          auditChange(
            options.actor ?? "Stripe",
            "stripe.submitted",
            `Submitted approved response revision ${options.submissionRevision}.`,
            normalized.id,
          ),
        );
      try {
        await write(workspaceId, changes);
        return { duplicate: false };
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt === 3) throw error;
      }
    }
    throw new ConflictError();
  }

  async function syncStripe(workspaceId: string, actor: string) {
    const { connection, stripe } = await verifiedConnection(workspaceId);
    const page = await stripe.disputes.list({
      limit: 50,
      ...(connection.data.nextCursor
        ? { starting_after: connection.data.nextCursor }
        : {}),
    });
    for (const dispute of page.data)
      await importDispute(dispute, workspaceId, connection.data);
    // Concurrent syncs must not overwrite each other's pagination cursor or undo a disconnect.
    await write(workspaceId, [
      {
        key: keys.stripe,
        expectedVersion: connection.version,
        data: {
          ...connection.data,
          lastSyncAt: timestamp(),
          nextCursor: page.has_more ? page.data.at(-1)!.id : null,
        } satisfies StripeConnection,
      },
      auditChange(
        actor,
        "stripe.synced",
        `Imported ${page.data.length} dispute records${page.has_more ? "; another page is available" : ""}.`,
      ),
    ]);
    return { imported: page.data.length, hasMore: page.has_more };
  }
  async function submitStripe(
    workspaceId: string,
    actor: string,
    input: { caseId: string; confirmed: boolean; draftRevision: number },
  ) {
    if (settings().STRIPE_ENABLE_SUBMISSION !== "true")
      throw new ApiError(
        409,
        "Stripe submission is disabled. Export the reviewed response for now.",
        "submission_disabled",
      );
    const { connection, stripe } = await verifiedConnection(workspaceId);
    const [row, draft, evidence] = await Promise.all([
      read<CaseDoc>(workspaceId, keys.case(input.caseId)),
      read<DraftDoc>(workspaceId, keys.draft(input.caseId)),
      query<EvidenceDoc>(workspaceId, keys.evidencePrefix(input.caseId)),
    ]);
    if (
      !row ||
      row.data.id !== input.caseId ||
      row.data.workspaceId !== workspaceId
    )
      throw new ApiError(404, "Case not found.");
    const invalid = submissionEligibility({
      source: row.data.source,
      status: row.data.status,
      draftStatus: draft?.data.status,
      revision: draft?.data.revision,
      requestedRevision: input.draftRevision,
      confirmed: input.confirmed,
      sourceRevision: draft?.data.sourceRevision,
      dataRevision: row.data.dataRevision,
    });
    if (invalid) throw new ApiError(409, invalid);
    if (
      !row.data.stripeDisputeId ||
      row.data.stripeAccountId !== connection.data.accountId
    )
      throw new ApiError(
        409,
        "The case belongs to a different Stripe account.",
      );
    if (!draft)
      throw new ApiError(409, "Approve the response before submission.");
    if (draft.data.content.length > 20000)
      throw new ApiError(
        409,
        "Stripe accepts at most 20,000 characters in this text response. Shorten and review the draft again.",
      );
    if (evidence.some((record) => record.data.fileKey))
      throw new ApiError(
        409,
        "This integration currently submits text responses only. Export this case and include its supporting files in Stripe Dashboard.",
        "attachment_submission_required",
      );
    const disputeId = row.data.stripeDisputeId;
    const current = await stripe.disputes.retrieve(disputeId);
    if (current.livemode !== (connection.data.mode === "live"))
      throw new ApiError(
        409,
        "Stripe environment does not match the connected account.",
      );
    if (
      !["needs_response", "warning_needs_response"].includes(current.status) ||
      current.evidence_details.past_due
    )
      throw new ApiError(
        409,
        "Stripe is no longer accepting this dispute response.",
      );
    try {
      const result = await performClaimedSubmission({
        claim: async () => {
          try {
            await write(workspaceId, [
              {
                key: row.key,
                expectedVersion: row.version,
                data: {
                  ...row.data,
                  status: "submitting",
                  updatedAt: timestamp(),
                } satisfies CaseDoc,
              },
              { key: draft.key, expectedVersion: draft.version, check: true },
              {
                key: keys.stripe,
                expectedVersion: connection.version,
                check: true,
              },
            ]);
            return true;
          } catch (error) {
            if (error instanceof ConflictError) return false;
            throw error;
          }
        },
        send: () =>
          stripe.disputes.update(
            disputeId,
            {
              evidence: { uncategorized_text: draft.data.content },
              submit: true,
            },
            {
              idempotencyKey: `causality:${workspaceId}:${row.data.id}:revision:${input.draftRevision}`,
            },
          ),
        settle: async (updated) => {
          await importDispute(updated, workspaceId, connection.data, {
            actor,
            submissionRevision: input.draftRevision,
          });
        },
        uncertain: () =>
          write(workspaceId, [
            auditChange(
              actor,
              "stripe.submission_verification_required",
              `Could not confirm the result for revision ${input.draftRevision}. Case stays locked until Stripe status is verified.`,
              row.data.id,
            ),
          ]),
      });
      if (!result.claimed)
        throw new ApiError(
          409,
          "This case changed or another submission started. Refresh and review its current status.",
          "stale_submission",
        );
      return { submitted: true, stripeStatus: result.result.status };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        502,
        "The submission result could not be confirmed. The case is locked to prevent duplicate or changed submissions. Check Stripe Dashboard and sync its status.",
        "submission_verification_required",
      );
    }
  }
  async function handleStripeWebhook(body: string, signature: string) {
    const env = settings(),
      workspaceId = env.STRIPE_WORKSPACE_ID;
    if (!workspaceId || !env.STRIPE_WEBHOOK_SECRET)
      throw new ApiError(503, "Webhook configuration is incomplete.");
    const stripe = client(workspaceId);
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
        300,
        Stripe.createSubtleCryptoProvider(),
      );
    } catch {
      throw new ApiError(
        400,
        "Invalid webhook signature.",
        "invalid_signature",
      );
    }
    if (!event.type.startsWith("charge.dispute."))
      return { received: true, ignored: true };
    const { connection } = await verifiedConnection(workspaceId);
    if (
      (event.account && event.account !== connection.data.accountId) ||
      event.livemode !== (connection.data.mode === "live")
    )
      throw new ApiError(400, "Webhook account or environment mismatch.");
    if (await read<StripeEvent>(workspaceId, keys.stripeEvent(event.id)))
      return { received: true, duplicate: true };
    const object = event.data.object as Stripe.Dispute;
    const latest = await stripe.disputes.retrieve(object.id);
    if (latest.livemode !== (connection.data.mode === "live"))
      throw new ApiError(400, "Stripe environment mismatch.");
    const result = await importDispute(latest, workspaceId, connection.data, {
      event,
    });
    return { received: true, ...(result.duplicate ? { duplicate: true } : {}) };
  }
  return {
    configuration,
    listStripeIntegration,
    connectStripe,
    disconnectStripe,
    syncStripe,
    submitStripe,
    handleStripeWebhook,
  };
}

const service = createStripeService({
  getItem,
  queryItems,
  commit,
  settings: () => ({
    STRIPE_RESTRICTED_KEY: process.env.STRIPE_RESTRICTED_KEY,
    STRIPE_WORKSPACE_ID: process.env.STRIPE_WORKSPACE_ID,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_ALLOW_LIVE: process.env.STRIPE_ALLOW_LIVE,
    STRIPE_ENABLE_SUBMISSION: process.env.STRIPE_ENABLE_SUBMISSION,
  }),
  client: (key) =>
    new Stripe(key, {
      httpClient: Stripe.createFetchHttpClient(),
      maxNetworkRetries: 2,
      timeout: 15000,
    }),
});
export const {
  configuration,
  listStripeIntegration,
  connectStripe,
  disconnectStripe,
  syncStripe,
  submitStripe,
  handleStripeWebhook,
} = service;
