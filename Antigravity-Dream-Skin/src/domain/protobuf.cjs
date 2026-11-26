'use strict';

/**
 * Lightweight zero-dependency protobuf wire-format decoder (MIT).
 * Decodes local Antigravity SQLite protobuf blobs; unknown fields are preserved by number.
 */

/**
 * Decode a raw protobuf message into a Map<fieldNumber, Array<number | Buffer>>.
 * @param {Buffer | Uint8Array | ArrayLike<number> | null | undefined} bytes
 * @returns {Map<number, Array<number | Buffer>>}
 */
function fields(bytes) {
  const result = new Map();
  if (!bytes || bytes.length === 0) return result;
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let offset = 0;

  const readVarint = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n && offset < data.length; shift += 7n) {
      const byte = data[offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('Invalid protobuf varint');
  };

  while (offset < data.length) {
    const key = Number(readVarint());
    const number = key >>> 3;
    const wire = key & 7;
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error('Invalid protobuf field');
    }

    let value;
    if (wire === 0) {
      value = Number(BigInt.asIntN(64, readVarint()));
    } else if (wire === 1 || wire === 2 || wire === 5) {
      const length = wire === 2 ? Number(readVarint()) : wire === 1 ? 8 : 4;
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > data.length) {
        throw new Error('Truncated protobuf');
      }
      value = data.subarray(offset, offset + length);
      offset += length;
    } else {
      throw new Error(`Unsupported protobuf wire type: ${wire}`);
    }

    let bucket = result.get(number);
    if (!bucket) {
      bucket = [];
      result.set(number, bucket);
    }
    bucket.push(value);
  }

  return result;
}

/**
 * Return the first decoded occurrence of a field number, or fallback if absent.
 * @param {Map<number, Array<any>> | null | undefined} map
 * @param {number} number
 * @param {any} [fallback=null]
 */
function first(map, number, fallback = null) {
  if (!(map instanceof Map)) return fallback;
  const list = map.get(number);
  return list && list.length > 0 ? list[0] : fallback;
}

/**
 * Decode a nested length-delimited message at field `number`.
 * @param {Map<number, Array<any>> | null | undefined} map
 * @param {number} number
 * @returns {Map<number, Array<number | Buffer>>}
 */
function nested(map, number) {
  const raw = first(map, number, null);
  if (!raw || typeof raw === 'number') return new Map();
  return fields(raw);
}

/**
 * Decode a UTF-8 string field at `number`.
 * @param {Map<number, Array<any>> | null | undefined} map
 * @param {number} number
 * @returns {string}
 */
function string(map, number) {
  const raw = first(map, number, null);
  if (!raw || typeof raw === 'number') return '';
  return Buffer.isBuffer(raw) ? raw.toString('utf8') : Buffer.from(raw).toString('utf8');
}

/**
 * Decode a google.protobuf.Timestamp / Duration (field 1: seconds, field 2: nanos) into milliseconds.
 * @param {Buffer | Uint8Array | null | undefined} bytes
 * @returns {number | null}
 */
function milliseconds(bytes) {
  if (!bytes || typeof bytes === 'number') return null;
  const map = fields(bytes);
  const seconds = first(map, 1, 0);
  const nanos = first(map, 2, 0);
  if (typeof seconds !== 'number' || typeof nanos !== 'number') return null;
  return seconds * 1000 + nanos / 1e6;
}

module.exports = {
  fields,
  first,
  nested,
  string,
  milliseconds,
};
