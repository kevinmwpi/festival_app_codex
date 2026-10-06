import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import resolveConfig, { legalPlaceholderProblems, releaseArtworkProblems } from '../app.config';

const PROJECT_ROOT = join(__dirname, '..');

/** A minimal valid PNG of `size`×`size` with the given colour type (2 = RGB, 6 = RGBA). */
function png(size: number, colourType: 2 | 6, extraChunk?: string): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = colourType;
  const channels = colourType === 6 ? 4 : 3;
  const raw = Buffer.alloc((size * channels + 1) * size);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    ...(extraChunk ? [chunk(extraChunk, Buffer.alloc(6))] : []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'festie-config-'));
  mkdirSync(join(dir, 'assets/images'), { recursive: true });
  mkdirSync(join(dir, 'app/legal'), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('release artwork guard', () => {
  it('accepts the Festie artwork in this repository', () => {
    expect(releaseArtworkProblems(PROJECT_ROOT)).toEqual([]);
  });

  it('rejects template artwork by hash', () => {
    const icon = png(1024, 2);
    writeFileSync(join(dir, 'assets/images/icon.png'), icon);
    const templates = { 'assets/images/icon.png': createHash('md5').update(icon).digest('hex') };
    expect(releaseArtworkProblems(dir, './assets/images/icon.png', templates)).toEqual([
      'assets/images/icon.png is still the Expo template artwork; replace it with Festie artwork',
    ]);
  });

  it('rejects an icon with alpha or the wrong size', () => {
    writeFileSync(join(dir, 'assets/images/icon.png'), png(512, 6));
    expect(releaseArtworkProblems(dir, undefined, {})).toEqual([
      'assets/images/icon.png must be 1024×1024 (it is 512×512)',
      'assets/images/icon.png must not have an alpha channel (App Store icons are opaque)',
    ]);
    writeFileSync(join(dir, 'assets/images/icon.png'), png(1024, 2, 'tRNS'));
    expect(releaseArtworkProblems(dir, undefined, {})).toEqual([
      'assets/images/icon.png must not have an alpha channel (App Store icons are opaque)',
    ]);
    writeFileSync(join(dir, 'assets/images/icon.png'), png(1024, 2));
    expect(releaseArtworkProblems(dir, undefined, {})).toEqual([]);
  });
});

describe('bundled legal placeholder guard', () => {
  it('reports __PLACEHOLDER__ tokens but not the runtime support-email token', () => {
    writeFileSync(join(dir, 'app/legal/terms-of-use.tsx'), 'const a = "__LEGAL_NAME__ at __POSTAL_ADDRESS__, __SUPPORT_EMAIL__";');
    writeFileSync(join(dir, 'app/legal/privacy-policy.tsx'), 'const a = "Email: __SUPPORT_EMAIL__";');
    expect(legalPlaceholderProblems(dir)).toEqual([
      'app/legal/terms-of-use.tsx still contains __LEGAL_NAME__, __POSTAL_ADDRESS__',
    ]);
  });
});

describe('config function', () => {
  const ENV = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: 'pk.test-token',
    EXPO_PUBLIC_SUPPORT_EMAIL: 'help@example.com',
    EXPO_PUBLIC_PRIVACY_POLICY_URL: 'https://example.com/privacy.html',
    EXPO_PUBLIC_SUPPORT_URL: 'https://example.com/support.html',
  };
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [...Object.keys(ENV), 'EAS_BUILD_PROFILE']) saved[key] = process.env[key];
    Object.assign(process.env, ENV);
    cpSync(join(PROJECT_ROOT, 'assets/images'), join(dir, 'assets/images'), { recursive: true });
    writeFileSync(join(dir, 'app/legal/privacy-policy.tsx'), '"__SUPPORT_EMAIL__"');
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const run = () =>
    resolveConfig({ config: { name: 'Festie', slug: 'festival-app', icon: './assets/images/icon.png' }, projectRoot: dir } as never);

  it('fails a production build while the bundled Terms still has placeholders', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    writeFileSync(join(dir, 'app/legal/terms-of-use.tsx'), '"Governed by __GOVERNING_LAW__"');
    expect(run).toThrow(/terms-of-use\.tsx still contains __GOVERNING_LAW__/);
  });

  it('fails a production build without a public Mapbox token', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    writeFileSync(join(dir, 'app/legal/terms-of-use.tsx'), '"Governed by the laws of Ruritania."');
    delete process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
    expect(run).toThrow(/EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is not set/);

    process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN = 'sk.secret-token';
    expect(run).toThrow(/EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN must be a Mapbox public token/);
  });

  it('passes a production build with final content, and never guards development builds', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    writeFileSync(join(dir, 'app/legal/terms-of-use.tsx'), '"Governed by the laws of Ruritania. __SUPPORT_EMAIL__"');
    expect(run().name).toBe('Festie');

    process.env.EAS_BUILD_PROFILE = 'development';
    writeFileSync(join(dir, 'app/legal/terms-of-use.tsx'), '"__GOVERNING_LAW__"');
    expect(run().name).toBe('Festie');
  });
});
