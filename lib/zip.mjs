// A deterministic zip for Docs bundles (Docs bundles: "the zip is
// deterministic"): the same files give the same bytes, so the same commit
// gives the same digest. Entries are sorted by name, every entry has the same
// timestamp (1980-01-01 00:00, the earliest a zip can hold) and mode
// (a regular file, rw-r--r--), and no entry carries extra fields or a comment.
// Each file is deflated, or stored when deflating does not make it smaller.
// node:zlib only; no zip64, which the bundle limits (1 GiB, 30,000 files)
// never need. readZip reads such a zip back, refusing unsafe names; unpackZip
// unpacks an untrusted one safely (intake and release builds).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const DOS_TIME = 0;
const MODE = 0o100644;
const UTF8 = 0x0800;
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

// A name a bundle may hold: relative, `/`-separated, no empty, `.` or `..`
// segment, no backslash or control character.
export function safeEntryName(name) {
  if (typeof name !== 'string' || !name || name.startsWith('/') || /[\\\0-\x1f]/.test(name)) return false;
  return name.split('/').every((s) => s && s !== '.' && s !== '..');
}

function checkNames(names) {
  const seen = new Set();
  for (const name of names) {
    if (!safeEntryName(name)) throw new Error(`Unsafe zip entry name ${JSON.stringify(name)}`);
    // Two names that differ only in case would overwrite each other on macOS and Windows.
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Two zip entries named ${name} (names are compared without case)`);
    seen.add(key);
  }
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Writes `entries` ([{ name, data } or { name, file }]) to `out`, one entry
// at a time. Returns { bytes, sha256, count }.
export function writeZip(out, entries) {
  checkNames(entries.map((e) => e.name));
  const sorted = [...entries].sort(byName);
  if (sorted.length > 0xffff) throw new Error(`${sorted.length} entries is more than a zip without zip64 holds`);
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(out, 'w');
  let offset = 0;
  const write = (buf) => {
    fs.writeSync(fd, buf);
    hash.update(buf);
    offset += buf.length;
  };
  const centrals = [];
  try {
    for (const e of sorted) {
      const data = e.data ?? fs.readFileSync(e.file);
      const name = Buffer.from(e.name, 'utf8');
      const deflated = zlib.deflateRawSync(data, { level: 9 });
      const stored = deflated.length >= data.length;
      const body = stored ? data : deflated;
      const crc = zlib.crc32(data);
      const at = offset;
      if (at + 30 + name.length + body.length > 0xffffffff) throw new Error('The bundle is larger than a zip without zip64 holds (4 GiB)');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(LOCAL, 0);
      local.writeUInt16LE(20, 4); // version needed: 2.0
      local.writeUInt16LE(UTF8, 6);
      local.writeUInt16LE(stored ? 0 : 8, 8);
      local.writeUInt16LE(DOS_TIME, 10);
      local.writeUInt16LE(DOS_DATE, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28); // no extra fields
      write(local);
      write(name);
      write(body);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(CENTRAL, 0);
      central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(UTF8, 8);
      central.writeUInt16LE(stored ? 0 : 8, 10);
      central.writeUInt16LE(DOS_TIME, 12);
      central.writeUInt16LE(DOS_DATE, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(body.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(name.length, 28);
      // extra, comment, disk, internal attributes: 0
      central.writeUInt32LE((MODE << 16) >>> 0, 38);
      central.writeUInt32LE(at, 42);
      centrals.push(central, name);
    }
    const start = offset;
    for (const c of centrals) write(c);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0);
    end.writeUInt16LE(sorted.length, 8);
    end.writeUInt16LE(sorted.length, 10);
    end.writeUInt32LE(offset - start, 12);
    end.writeUInt32LE(start, 16);
    write(end);
  } finally {
    fs.closeSync(fd);
  }
  return { bytes: offset, sha256: hash.digest('hex'), count: sorted.length };
}

// The central directory of a zip, read without inflating anything:
// [{ name, method, crc, csize, size, dataAt }]. Refuses unsafe or repeated
// names, encryption, anything but regular files (symbolic links,
// directories, devices), methods other than stored and deflate, a local
// header that names another file, and entries whose data overlap or run
// past the end (the overlapping-entry zip bomb).
function centralDirectory(buf) {
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0 || endAt + 22 > buf.length) throw new Error('Not a zip: no end of central directory');
  const count = buf.readUInt16LE(endAt + 10);
  let at = buf.readUInt32LE(endAt + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL) throw new Error('Bad central directory entry');
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const csize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nlen = buf.readUInt16LE(at + 28);
    const elen = buf.readUInt16LE(at + 30);
    const clen = buf.readUInt16LE(at + 32);
    const mode = buf.readUInt32LE(at + 38) >>> 16;
    const localAt = buf.readUInt32LE(at + 42);
    const nameBytes = buf.subarray(at + 46, at + 46 + nlen);
    const name = nameBytes.toString('utf8');
    if (!safeEntryName(name)) throw new Error(`Unsafe zip entry name ${JSON.stringify(name)}`);
    if (flags & 0x1) throw new Error(`${name}: encrypted entries are not accepted`);
    const type = mode & 0o170000;
    if (type === 0o120000) throw new Error(`${name}: symbolic links are not accepted`);
    if (type !== 0 && type !== 0o100000) throw new Error(`${name}: only regular files are accepted (mode ${mode.toString(8)})`);
    if (method !== 0 && method !== 8) throw new Error(`${name}: compression method ${method} is not accepted`);
    if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== LOCAL) throw new Error(`${name}: bad local header`);
    const localName = buf.subarray(localAt + 30, localAt + 30 + buf.readUInt16LE(localAt + 26));
    if (!localName.equals(nameBytes)) throw new Error(`${name}: the local header names another file (${JSON.stringify(localName.toString('utf8'))})`);
    const dataAt = localAt + 30 + localName.length + buf.readUInt16LE(localAt + 28);
    if (dataAt + csize > buf.length) throw new Error(`${name}: data runs past the end of the zip`);
    out.push({ name, method, crc, csize, size, localAt, dataAt });
    at += 46 + nlen + elen + clen;
  }
  checkNames(out.map((e) => e.name));
  const byOffset = [...out].sort((a, b) => a.localAt - b.localAt);
  for (let i = 1; i < byOffset.length; i++) {
    const prev = byOffset[i - 1];
    if (byOffset[i].localAt < prev.dataAt + prev.csize) throw new Error(`${byOffset[i].name}: overlaps ${prev.name} in the zip`);
  }
  return out;
}

// One entry's bytes, never more than its declared size; checks size and CRC.
function inflate(buf, e) {
  const body = buf.subarray(e.dataAt, e.dataAt + e.csize);
  let data;
  try {
    data = e.method === 0 ? Buffer.from(body) : zlib.inflateRawSync(body, { maxOutputLength: Math.max(e.size, 1) });
  } catch (err) {
    throw new Error(`${e.name}: does not inflate to its declared size (${err.code ?? err.message})`);
  }
  if (data.length !== e.size || zlib.crc32(data) !== e.crc) throw new Error(`${e.name}: size or CRC does not match`);
  return data;
}

// The entries of a zip as writeZip writes them: [{ name, data }], in order,
// with the checks of centralDirectory and each entry's size and CRC.
export function readZip(buf) {
  return centralDirectory(buf).map((e) => ({ name: e.name, data: inflate(buf, e) }));
}

// What safe unpacking accepts (Releases and deployments, Intake): the bundle
// limits (1 GiB, 30,000 files), at most 100 times the zip's size in all, and
// no entry over 1 MiB that inflates more than 1,000 times (a zip bomb).
export const UNPACK_LIMITS = { files: 30_000, bytes: 1024 ** 3, ratio: 100, entryRatio: 1000, entryRatioFrom: 1024 ** 2 };

// Unpacks a zip (a Buffer, or a file path) into `dir`, which must be empty or
// absent: every check of readZip, the limits above from the declared sizes
// before anything inflates, and each file created new (O_EXCL, O_NOFOLLOW)
// inside `dir`. Returns { files, bytes }.
export function unpackZip(zip, dir, limits = UNPACK_LIMITS) {
  const buf = Buffer.isBuffer(zip) ? zip : fs.readFileSync(zip);
  const entries = centralDirectory(buf);
  if (entries.length > limits.files) throw new Error(`${entries.length} files, more than ${limits.files}`);
  const bytes = entries.reduce((n, e) => n + e.size, 0);
  if (bytes > limits.bytes) throw new Error(`${bytes} bytes unpacked, more than ${limits.bytes}`);
  if (bytes > Math.max(buf.length, 1) * limits.ratio) throw new Error(`Unpacks to ${bytes} bytes, more than ${limits.ratio} times the zip's ${buf.length}`);
  for (const e of entries) {
    if (e.size >= limits.entryRatioFrom && e.size > Math.max(e.csize, 1) * limits.entryRatio) throw new Error(`${e.name}: inflates ${e.size} bytes from ${e.csize}, more than ${limits.entryRatio} times`);
  }
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  if (fs.readdirSync(root).length) throw new Error(`${root} is not empty: a bundle unpacks into an empty folder`);
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;
  for (const e of entries) {
    const target = path.resolve(root, ...e.name.split('/'));
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`${e.name}: unpacks outside ${root}`);
    const data = inflate(buf, e);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const fd = fs.openSync(target, O_WRONLY | O_CREAT | O_EXCL | (O_NOFOLLOW ?? 0), 0o644);
    try {
      fs.writeSync(fd, data);
    } finally {
      fs.closeSync(fd);
    }
  }
  return { files: entries.length, bytes };
}
