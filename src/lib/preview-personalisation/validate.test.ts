import { describe, expect, it } from 'vitest';
import { sniffImage, validateUpload, MAX_UPLOAD_BYTES } from './validate';

const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const webp = () => new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))));
const bytesOf = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('what may be uploaded to an open endpoint', () => {
  it('accepts the three real image formats', () => {
    expect(validateUpload('image/jpeg', jpeg())).toMatchObject({ ok: true, mime: 'image/jpeg', extension: 'jpg' });
    expect(validateUpload('image/png', png())).toMatchObject({ ok: true, mime: 'image/png', extension: 'png' });
    expect(validateUpload('image/webp', webp())).toMatchObject({ ok: true, mime: 'image/webp', extension: 'webp' });
  });

  it('reads the format from the bytes, not from what the caller says', () => {
    // The endpoint is open: anyone with a storefront URL can post to it, and
    // they choose the Content-Type. "image/png" is a claim, not a fact.
    expect(sniffImage(jpeg())).toBe('image/jpeg');
    expect(sniffImage(bytesOf('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffImage(bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffImage(bytesOf('#!/bin/sh\nrm -rf /'))).toBeNull();
    expect(sniffImage(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]))).toBeNull(); // PE executable
  });

  it('refuses HTML dressed as a PNG — the stored-XSS case', () => {
    const attack = validateUpload('image/png', bytesOf('<html><script>fetch("/steal")</script></html>'));
    expect(attack.ok).toBe(false);
    expect(attack).toMatchObject({ reason: 'unsupported_type' });
  });

  it('refuses SVG outright, whatever it contains', () => {
    // A document format that executes script. No restaurant needs one to show
    // us a logo, so it is refused on the declared type before any sniffing.
    expect(validateUpload('image/svg+xml', bytesOf('<svg/>'))).toMatchObject({ ok: false, reason: 'unsupported_type' });
    expect(validateUpload('text/html', bytesOf('<h1>hi</h1>'))).toMatchObject({ ok: false, reason: 'unsupported_type' });
    expect(validateUpload('application/octet-stream', jpeg())).toMatchObject({ ok: false, reason: 'unsupported_type' });
  });

  it('refuses a real image announced as a different real image', () => {
    // Not an attack by itself, but the stored Content-Type has to match the
    // bytes or the serving route would lie to a browser.
    expect(validateUpload('image/png', jpeg())).toMatchObject({ ok: false, reason: 'content_mismatch' });
  });

  it('enforces the size limit and rejects an empty file', () => {
    expect(validateUpload('image/jpeg', new Uint8Array(0))).toMatchObject({ ok: false, reason: 'empty' });
    const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    huge.set(jpeg());
    expect(validateUpload('image/jpeg', huge)).toMatchObject({ ok: false, reason: 'too_large' });
    const atLimit = new Uint8Array(MAX_UPLOAD_BYTES);
    atLimit.set(jpeg());
    expect(validateUpload('image/jpeg', atLimit).ok).toBe(true);
  });

  it('never returns an ok verdict without a concrete mime and extension', () => {
    const v = validateUpload(null, webp());
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(['image/jpeg', 'image/png', 'image/webp']).toContain(v.mime);
      expect(['jpg', 'png', 'webp']).toContain(v.extension);
    }
  });
});
