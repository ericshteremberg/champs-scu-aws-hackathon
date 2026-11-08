import type { InvestigationRun } from '../domain';

export const progressUnavailable = 'Investigation progress could not be refreshed. This does not confirm that the run stopped. Reconnecting automatically; the displayed status may be out of date.';

/** Present recoverable checks without changing saved audit events or terminal status. */
export function investigationProgressEvent<T extends { type: string; title: string; detail: string; section?: string }>(event: T, active: boolean): T {
  if (event.type === 'tool_completed' && /^No attached records (?:were|are) classified under /.test(event.detail)) {
    return { ...event, title: `No records classified under ${event.section || 'this section'}`, detail: 'No attached records were assigned to this category. Related facts may appear in other records; this is not a provider connection failure.' };
  }
  if (event.type !== 'blocked') return event;
  const correction = event.detail === 'The investigation did not produce the required report format.' ? 'report format'
    : ['The report cites records that were not retrieved for this case.', 'Each supported finding or conflict must cite its source records.', 'The response must cite its retrieved evidence.'].includes(event.detail) ? 'report citations'
    : event.detail === 'An investigation without source records must be marked insufficient.' ? 'report assessment'
    : event.detail.startsWith('Rewrite only the presentation of the response, preserving facts and counterevidence.') ? 'report wording'
    : undefined;
  if (correction) return {
    ...event,
    title: active ? `Refining ${correction}` : `${correction[0].toUpperCase()}${correction.slice(1)} correction requested`,
    detail: active
      ? `Causality is asking the model to correct the ${correction} automatically. The investigation is still running.`
      : `Causality requested an automatic correction to the ${correction}. This was a retry step; the investigation status above shows the final outcome.`,
  };
  if (event.detail.startsWith('Read these sections before finishing:')) return { ...event, title: 'Additional evidence review requested', detail: `${event.detail} Causality requested another review step. This is not a final run failure.` };
  return event;
}

/** Explain the known provider error without attributing every failure to credentials. */
export function investigationFailureMessage(message: string): string {
  if (!/^Amazon Bedrock could not complete the request(?: \([A-Za-z]+\))?\. Check model access, region and workshop credentials\.$/.test(message)) return message;
  if (message.includes('(ThrottlingException)')) return 'Amazon Bedrock limited the request rate. This run could not finish. Wait briefly, then retry.';
  if (message.includes('(ValidationException)')) return 'Amazon Bedrock rejected the model request parameters. This run could not finish. The model configuration needs review.';
  if (message.includes('(ExpiredTokenException)')) return 'The AWS session expired. Refresh the workshop credentials before starting another investigation.';
  if (message.includes('(UnrecognizedClientException)')) return 'AWS did not accept the configured credentials. Refresh the AWS session before retrying.';
  if (message.includes('(AccessDeniedException)')) return 'AWS denied this model request. Check permission to invoke the selected Bedrock model.';
  if (message.includes('(ResourceNotFoundException)')) return 'AWS could not find the selected model or inference profile in the configured region.';
  return 'Amazon Bedrock could not complete this run. The cause was not confirmed. Retry once; if it repeats, check the service logs.';
}

export function cancellationMessage(run: Pick<InvestigationRun, 'status'> | null | undefined): string {
  if (run?.status === 'cancelled') return 'Investigation cancelled. No draft was approved or submitted.';
  if (run?.status === 'completed') return 'The investigation completed before cancellation took effect. Review the saved report.';
  if (run?.status === 'failed') return 'The investigation ended with an error before cancellation took effect. Check its status for details.';
  if (run?.status === 'stale') return 'The investigation stopped because its sources or draft changed. Your newer changes were preserved.';
  return 'Cancellation is not confirmed. Check the investigation status before retrying.';
}
