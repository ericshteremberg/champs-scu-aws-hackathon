import { describe, expect, it } from 'vitest';
import { investigationProgressEvent, investigationFailureMessage, cancellationMessage } from '../lib/investigation/progress';

const original = { id: 'event_test', type: 'blocked', title: 'Request blocked', detail: 'The investigation did not produce the required report format.' };

describe('investigation format correction display', () => {
  it('explains automatic correction during an active run without changing the saved event', () => {
    const display = investigationProgressEvent(original, true);
    expect(display.title).toBe('Refining report format');
    expect(display.detail).toContain('investigation is still running');
    expect(original.title).toBe('Request blocked');
    expect(display.id).toBe(original.id);
  });
  it('describes a past retry without claiming that a finished run is still active or succeeded', () => {
    const display = investigationProgressEvent(original, false);
    expect(display.title).toBe('Report format correction requested');
    expect(display.detail).toContain('status above shows the final outcome');
    expect(display.detail).not.toContain('still running');
  });
  it('preserves actual failure events even when they have the same message', () => {
    const failure = { ...original, type: 'failed', title: 'Investigation failed' };
    expect(investigationProgressEvent(failure, false)).toBe(failure);
  });
  it('preserves access and scope blocks', () => {
    const denied = { ...original, detail: 'This action is not permitted for the investigation.' };
    expect(investigationProgressEvent(denied, true)).toBe(denied);
  });
});


describe('other investigation messages', () => {
  it.each([
    ['The report cites records that were not retrieved for this case.', 'citations'],
    ['Each supported finding or conflict must cite its source records.', 'citations'],
    ['The response must cite its retrieved evidence.', 'citations'],
    ['An investigation without source records must be marked insufficient.', 'assessment'],
    ['Rewrite only the presentation of the response, preserving facts and counterevidence. More model feedback.', 'wording'],
  ])('explains a recoverable report check: %s', (detail, label) => {
    expect(investigationProgressEvent({ ...original, detail }, true).title).toBe(`Refining report ${label}`);
    expect(investigationProgressEvent({ ...original, detail }, false).detail).not.toContain('still running');
  });
  it('distinguishes empty attached categories from unavailable providers', () => {
    const event = { ...original, type: 'tool_completed', section: 'order', detail: 'No attached records were classified under order. Related facts may appear in other source records.' };
    expect(investigationProgressEvent(event, true).detail).toContain('not a provider connection failure');
    const unavailable = { ...event, detail: 'The merchant API could not be reached.' };
    expect(investigationProgressEvent(unavailable, true)).toBe(unavailable);
  });
  it('describes further evidence review without declaring failure', () => {
    expect(investigationProgressEvent({ ...original, detail: 'Read these sections before finishing: order.' }, true).title).toBe('Additional evidence review requested');
  });
  it.each([
    ['cancelled', 'Investigation cancelled.'],
    ['completed', 'completed before cancellation'],
    ['failed', 'ended with an error'],
    ['stale', 'sources or draft changed'],
    ['running', 'not confirmed'],
  ] as const)('uses the actual %s outcome after cancellation', (status, expected) => {
    expect(cancellationMessage({ status })).toContain(expected);
  });
  it.each([
    ['ThrottlingException', 'limited the request rate'],
    ['ValidationException', 'request parameters'],
    ['ExpiredTokenException', 'session expired'],
    ['AccessDeniedException', 'denied this model request'],
    ['UnrecognizedClientException', 'did not accept'],
    ['ResourceNotFoundException', 'could not find'],
  ])('explains %s accurately', (name, expected) => {
    expect(investigationFailureMessage(`Amazon Bedrock could not complete the request (${name}). Check model access, region and workshop credentials.`)).toContain(expected);
  });
  it('does not invent a cause for unknown provider errors or alter unrelated errors', () => {
    expect(investigationFailureMessage('Amazon Bedrock could not complete the request. Check model access, region and workshop credentials.')).toContain('cause was not confirmed');
    expect(investigationFailureMessage('Saved report is stale.')).toBe('Saved report is stale.');
  });
});
