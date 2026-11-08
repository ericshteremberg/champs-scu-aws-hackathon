export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED') { super(message); }
}

export function assertActive(signal: AbortSignal) {
  if (signal.aborted) throw new HttpError(409, 'This investigation is no longer active.', 'RUN_INACTIVE');
}
