export interface ValidationIssueLike {
  path: readonly PropertyKey[];
  message: string;
}

/**
 * One validation message, formatted as `<path>: <message>` so the UI can attach
 * it to the right input. An issue without a path — an unknown key, for example —
 * is returned whole.
 */
export function formatIssue(issue: ValidationIssueLike): string {
  const path = issue.path.map(String).join('.');
  return path === '' ? issue.message : `${path}: ${issue.message}`;
}

export function formatIssues(issues: readonly ValidationIssueLike[]): string[] {
  return issues.map(formatIssue);
}
