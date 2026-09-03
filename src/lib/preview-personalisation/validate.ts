/**
 * What may be uploaded to an anonymous preview.
 *
 * PURE, so it is testable without a network or a database.
 *
 * ── Why the declared type is not trusted ─────────────────────────────────────
 * The endpoint is open: anyone with a storefront URL can post to it. A caller
 * chooses the filename and the Content-Type header, so "image/png" is a claim,
 * not a fact. An HTML file announced as a PNG and later served from our own
 * origin is stored XSS.
 *
 * So the bytes are sniffed. SVG is rejected outright rather than sniffed —
 * it is a document format that executes script, and no restaurant needs one to
 * show us a logo.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AcceptedMime = (typeof ACCEPTED_MIME)[number];

export type Rejection =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'content_mismatch';

export type Validation =
  | { ok: true; mime: AcceptedMime; bytes: number; extension: 'jpg' | 'png' | 'webp' }
  | { ok: false; reason: Rejection; message: string };

const MESSAGES: Record<Rejection, string> = {
  empty: 'That file is empty.',
  too_large: 'Images must be 5MB or smaller.',
  unsupported_type: 'Upload a JPG, PNG or WebP image.',
  content_mismatch: 'That file is not the kind of image it claims to be.',
};

const reject = (reason: Rejection): Validation => ({ ok: false, reason, message: MESSAGES[reason] });

/** Reads the format from the bytes themselves. Null when it is not one we take. */
export function sniffImage(bytes: Uint8Array): AcceptedMime | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return 'image/png';
  // WebP: "RIFF" .... "WEBP"
  const ascii = (from: number, len: number) => String.fromCharCode(...bytes.slice(from, from + len));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  return null;
}

const EXTENSION: Record<AcceptedMime, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function validateUpload(declaredType: string | null, bytes: Uint8Array): Validation {
  if (bytes.length === 0) return reject('empty');
  if (bytes.length > MAX_UPLOAD_BYTES) return reject('too_large');

  const declared = (declaredType ?? '').split(';')[0].trim().toLowerCase();
  // SVG, HTML and anything executable are refused on the declared type before
  // sniffing, so the rejection message is the honest one.
  if (declared && !(ACCEPTED_MIME as readonly string[]).includes(declared)) {
    return reject('unsupported_type');
  }

  const sniffed = sniffImage(bytes);
  if (!sniffed) return reject('unsupported_type');
  // A PNG announced as a JPEG is not an attack in itself, but it is a caller
  // we cannot take at their word — and the stored Content-Type has to match
  // what is actually in the file or the serving route would lie to a browser.
  if (declared && declared !== sniffed) return reject('content_mismatch');

  return { ok: true, mime: sniffed, bytes: bytes.length, extension: EXTENSION[sniffed] };
}
