import { describe, expect, it } from 'vitest';
import { UploadAttachmentInput } from '../../../src/schemas/attachment.js';

const baseInput = {
  parent_type: 'incidents' as const,
  parent_id: 123,
  file_name: 'evidence.txt',
};

describe('UploadAttachmentInput', () => {
  it('accepts one ordinary base64 or local-file source', () => {
    expect(
      UploadAttachmentInput.safeParse({
        ...baseInput,
        content_base64: Buffer.from('hello').toString('base64'),
      }).success,
    ).toBe(true);
    expect(
      UploadAttachmentInput.safeParse({
        ...baseInput,
        file_path: 'C:\\temp\\evidence.txt',
      }).success,
    ).toBe(true);
  });

  it('requires exactly one attachment source', () => {
    expect(UploadAttachmentInput.safeParse(baseInput).success).toBe(false);
    expect(
      UploadAttachmentInput.safeParse({
        ...baseInput,
        content_base64: Buffer.from('hello').toString('base64'),
        file_path: 'C:\\temp\\evidence.txt',
      }).success,
    ).toBe(false);
  });

  it.each([
    '../secret.txt',
    'folder/evidence.txt',
    'folder\\evidence.txt',
    `evidence${String.fromCharCode(0)}.txt`,
  ])('rejects unsafe display filename %j', (file_name) => {
    expect(
      UploadAttachmentInput.safeParse({
        ...baseInput,
        file_name,
        content_base64: Buffer.from('hello').toString('base64'),
      }).success,
    ).toBe(false);
  });

  it('rejects malformed base64', () => {
    expect(
      UploadAttachmentInput.safeParse({
        ...baseInput,
        content_base64: 'not-valid-base64!*',
      }).success,
    ).toBe(false);
    expect(
      UploadAttachmentInput.safeParse({
        ...baseInput,
        content_base64: 'ZE==',
      }).success,
    ).toBe(false);
  });

  it('rejects base64 that can decode beyond the SWSD 25 MB file limit', () => {
    const maxBytes = 25 * 1024 * 1024;
    const oversizedBase64 = 'A'.repeat(Math.ceil(maxBytes / 3) * 4 + 4);

    expect(
      UploadAttachmentInput.safeParse({
        ...baseInput,
        content_base64: oversizedBase64,
      }).success,
    ).toBe(false);
  });
});
