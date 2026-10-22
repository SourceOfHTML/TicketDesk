import { describe, expect, it } from 'vitest';
import { formatIssues } from './validation';

describe('formatIssues', () => {
  it('prefixes an issue with its path', () => {
    expect(formatIssues([{ path: ['title'], message: 'Too big' }])).toEqual(['title: Too big']);
  });

  it('returns a pathless issue whole', () => {
    expect(formatIssues([{ path: [], message: 'Unrecognized key: "extra"' }])).toEqual([
      'Unrecognized key: "extra"',
    ]);
  });

  it('joins a nested path with dots', () => {
    expect(formatIssues([{ path: ['address', 'city'], message: 'Required' }])).toEqual([
      'address.city: Required',
    ]);
  });
});
