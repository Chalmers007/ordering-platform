import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const files = [
  path.join(__dirname, 'integrations-panel.tsx'),
  path.join(__dirname, '../../app/(kds)/app/(dashboard)/integrations/page.tsx'),
];

describe('owner integrations copy', () => {
  it('does not expose CRM or vendor-specific terminology', () => {
    const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/gohighlevel|highlevel|\bghl\b|\bsquare\b|\bclover\b/i);
  });

  it('uses truthful provider-neutral status copy', () => {
    const panel = fs.readFileSync(files[0], 'utf8');
    expect(panel).toContain('Payment account not connected. Online checkout is disabled.');
    expect(panel).toContain('Point-of-sale connections are not available yet.');
  });
});
