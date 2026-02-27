import { describe, it, expect } from 'vitest';
import { parseDelay } from '../../src/utils/parse-delay';

describe('parseDelay', () => {
  it('parses milliseconds suffix', () => {
    expect(parseDelay('500ms')).toBe(500);
  });

  it('parses seconds suffix', () => {
    expect(parseDelay('2s')).toBe(2000);
  });

  it('parses fractional seconds', () => {
    expect(parseDelay('0.5s')).toBe(500);
    expect(parseDelay('1.5s')).toBe(1500);
  });

  it('parses bare number as milliseconds', () => {
    expect(parseDelay('300')).toBe(300);
  });

  it('trims whitespace', () => {
    expect(parseDelay('  2s  ')).toBe(2000);
    expect(parseDelay(' 100ms ')).toBe(100);
  });

  it('handles zero values', () => {
    expect(parseDelay('0s')).toBe(0);
    expect(parseDelay('0ms')).toBe(0);
    expect(parseDelay('0')).toBe(0);
  });
});
