import { describe, it, expect } from 'vitest';
import { errorMessage } from '../../src/utils/error-message';

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage(new TypeError('bad type'), 'fallback')).toBe(
      'bad type',
    );
  });

  it('returns a thrown string itself', () => {
    expect(errorMessage('raw string')).toBe('raw string');
    expect(errorMessage('raw string', 'fallback')).toBe('raw string');
  });

  it('stringifies other thrown values', () => {
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage({ toString: () => 'custom' })).toBe('custom');
  });

  it('uses the fallback for other thrown values', () => {
    expect(errorMessage(undefined, 'Failed to save')).toBe('Failed to save');
    expect(errorMessage({ code: 1 }, 'Failed to load')).toBe('Failed to load');
  });

  it('never returns a blank message', () => {
    expect(errorMessage(new Error())).toBe('Error');
    expect(errorMessage(new Error(), 'Failed to save')).toBe('Failed to save');
    expect(errorMessage('', 'Failed to save')).toBe('Failed to save');
  });
});
