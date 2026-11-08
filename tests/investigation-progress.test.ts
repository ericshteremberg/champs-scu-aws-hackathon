import { describe, expect, it } from 'vitest';
import { investigationProgressEvent } from '../lib/investigation/progress';

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
