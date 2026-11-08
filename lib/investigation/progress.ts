/** Present recoverable format checks without changing the saved audit event or run status. */
export function investigationProgressEvent<T extends { type: string; title: string; detail: string }>(event: T, active: boolean): T {
  if (event.type !== 'blocked' || event.detail !== 'The investigation did not produce the required report format.') return event;
  return {
    ...event,
    title: active ? 'Refining report format' : 'Report format correction requested',
    detail: active
      ? 'Causality is asking the model to correct the report format automatically. The investigation is still running.'
      : 'Causality requested an automatic correction to the report format. This was a retry step; the investigation status above shows the final outcome.',
  };
}
