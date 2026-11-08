/** Fixture data is never available in a production build. Local test servers must opt in. */
export function sampleDataEnabled() {
  return process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV === 'development' && process.env.CAUSALITY_TEST_FIXTURES === 'true');
}
export function visibleWorkspaceCases<T extends { source: string }>(cases: T[]): T[] {
  return sampleDataEnabled() ? cases : cases.filter(item => item.source !== 'demo');
}
export function visibleWorkspaceEvents<T extends { action?: string; caseId?: string | null }>(events: T[], hiddenCaseIds: Set<string>): T[] {
  return sampleDataEnabled() ? events : events.filter(item => !item.action?.startsWith('demo.') && (!item.caseId || !hiddenCaseIds.has(item.caseId)));
}
