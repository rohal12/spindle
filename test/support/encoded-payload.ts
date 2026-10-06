// Read and change saves in their stored (encoded) form, for tests that check
// what a save holds or how malformed saved data is refused.

import { deserialize, serialize } from '../../src/class-registry';
import type { EncodedPayload } from '../../src/saves/format';

/** The payload an encoded payload holds, decoded without any checks. */
export function storedBody(encoded: EncodedPayload): Record<string, any> {
  return deserialize<Record<string, any>>(encoded.data);
}

/**
 * `encoded` with its decoded payload changed by `edit` (which may write
 * values decodePayload() refuses) and serialized again.
 */
export function editStored(
  encoded: EncodedPayload,
  edit: (payload: Record<string, any>) => void,
): EncodedPayload {
  const body = storedBody(encoded);
  edit(body);
  return { ...encoded, data: serialize(body) };
}

/**
 * `encoded` with its decoded payload changed by `edit`, which puts the
 * string "__BAD__" somewhere; in the serialized text that string is
 * replaced by `raw`, a devalue entry serialize() never writes.
 */
export function editStoredRaw(
  encoded: EncodedPayload,
  edit: (payload: Record<string, any>) => void,
  raw: string,
): EncodedPayload {
  const { data } = editStored(encoded, edit);
  if (!data.includes('"__BAD__"')) throw new Error('edit left no "__BAD__"');
  return { ...encoded, data: data.replace('"__BAD__"', raw) };
}
