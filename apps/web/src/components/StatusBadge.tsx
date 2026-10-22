const LABELS: Record<string, string> = {
  ready: 'Ready', 'not-provisioned': 'Not provisioned', 'unsupported-architecture': 'Unsupported architecture', offline: 'Offline', busy: 'Busy',
  'verification-failed': 'Verification failed', 'not-run': 'Not run', passed: 'Passed', failed: 'Failed', blocked: 'Blocked', skipped: 'Skipped',
  'failed-to-start': 'Failed to start', 'closed-with-error': 'Closed with error', completed: 'Completed', running: 'Running', expired: 'Expired', interrupted: 'Interrupted',
};

export function StatusBadge({ value, title }: { value: string; title?: string }) {
  return <span className={`badge b-${value}`} title={title}>{LABELS[value] ?? value.replace(/-/g, ' ')}</span>;
}
