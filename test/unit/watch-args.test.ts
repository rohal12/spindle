import { describe, it, expect } from 'vitest';
import { parseWatchArgs, parseUnwatchName } from '../support/macro-args';

describe('parseWatchArgs', () => {
  // ── Existing behaviour ────────────────────────────────────────────

  it('reads the condition and keyword options', () => {
    expect(
      parseWatchArgs(`'$gold >= 100' goto "Victory" once name "gold-watch"`),
    ).toEqual({
      condition: '$gold >= 100',
      options: { goto: 'Victory', once: true, name: 'gold-watch' },
    });
  });

  it('reads dialog, run and priority options', () => {
    expect(
      parseWatchArgs(`"$hp <= 0" dialog 'Game Over' run "$x += 1" priority 5`),
    ).toEqual({
      condition: '$hp <= 0',
      options: { dialog: 'Game Over', run: '$x += 1', priority: 5 },
    });
  });

  it('reads a condition with no options', () => {
    expect(parseWatchArgs(`'$x > 0'`)).toEqual({
      condition: '$x > 0',
      options: {},
    });
  });

  it('keeps the other quote kind inside a string', () => {
    expect(parseWatchArgs(`"$name == 'Bob'" goto "it's here"`)).toEqual({
      condition: "$name == 'Bob'",
      options: { goto: "it's here" },
    });
  });

  it('returns null without a quoted condition', () => {
    expect(parseWatchArgs('$x > 0 once')).toBeNull();
    expect(parseWatchArgs('')).toBeNull();
  });

  it('returns null for an unterminated condition', () => {
    expect(parseWatchArgs(`'$x > 0 once`)).toBeNull();
  });

  // ── Escapes ──────────────────────────────────────────────────────

  it('reads a condition containing escaped quotes', () => {
    expect(
      parseWatchArgs(String.raw`"$name == \"Bob\"" goto "Hello" once`),
    ).toEqual({
      condition: '$name == "Bob"',
      options: { goto: 'Hello', once: true },
    });
    expect(parseWatchArgs(String.raw`'$name == \'Bob\'' once`)).toEqual({
      condition: "$name == 'Bob'",
      options: { once: true },
    });
  });

  it('reads option values containing escaped quotes', () => {
    expect(
      parseWatchArgs(
        String.raw`'$x > 0' run "$msg = \"a \\\"quoted\\\" b\"" name "say \"hi\""`,
      ),
    ).toEqual({
      condition: '$x > 0',
      options: {
        run: String.raw`$msg = "a \"quoted\" b"`,
        name: 'say "hi"',
      },
    });
  });

  it('closes a value after an even run of backslashes', () => {
    expect(
      parseWatchArgs(String.raw`'$x > 0' name "C:\\" goto "Next" once`),
    ).toEqual({
      condition: '$x > 0',
      options: { name: 'C:\\', goto: 'Next', once: true },
    });
  });

  it('closes a condition after an even run of backslashes', () => {
    expect(parseWatchArgs(String.raw`"$path == 'C:\\\\'" once`)).toEqual({
      condition: String.raw`$path == 'C:\\'`,
      options: { once: true },
    });
  });

  it('keeps a quote escaped after an odd run of backslashes', () => {
    // "a\\\" once" — escaped backslash, escaped quote: still one string
    expect(parseWatchArgs(String.raw`'$x' name "a\\\" once" goto "B"`)).toEqual(
      {
        condition: '$x',
        options: { name: 'a\\" once', goto: 'B' },
      },
    );
  });

  it('reads a condition containing a regex literal with quotes', () => {
    expect(
      parseWatchArgs(String.raw`'/[\'"/]/.test($s)' run "$n += 1"`),
    ).toEqual({
      condition: String.raw`/['"/]/.test($s)`,
      options: { run: '$n += 1' },
    });
  });

  it('leaves other backslash sequences in a condition untouched', () => {
    expect(parseWatchArgs(String.raw`'/\d+/.test($code)' once`)).toEqual({
      condition: String.raw`/\d+/.test($code)`,
      options: { once: true },
    });
  });
});

describe('parseUnwatchName', () => {
  it('strips the surrounding quotes', () => {
    expect(parseUnwatchName('"gold-watch"')).toBe('gold-watch');
    expect(parseUnwatchName("'gold-watch'")).toBe('gold-watch');
  });

  it('accepts a bare name', () => {
    expect(parseUnwatchName(' gold-watch ')).toBe('gold-watch');
  });

  it('unescapes the name like {watch} does', () => {
    expect(parseUnwatchName(String.raw`"say \"hi\""`)).toBe('say "hi"');
    expect(parseUnwatchName(String.raw`"C:\\"`)).toBe('C:\\');
  });
});
