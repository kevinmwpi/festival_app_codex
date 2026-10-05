import { describe, expect, it } from 'vitest';

import { FESTIE_NAMESPACE, isUuid, uuidV5 } from '../src/lib/uuid';

describe('uuidV5', () => {
  it('matches the RFC 4122 reference vector', () => {
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('is deterministic and namespaced', () => {
    const a = uuidV5('stage:main', FESTIE_NAMESPACE);
    expect(uuidV5('stage:main', FESTIE_NAMESPACE)).toBe(a);
    expect(uuidV5('stage:main', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('rejects a non-UUID namespace', () => {
    expect(() => uuidV5('x', 'nope')).toThrow(/namespace/);
  });
});

describe('isUuid', () => {
  it('accepts canonical UUIDs only', () => {
    expect(isUuid('23201458-2b66-526f-943e-27ba5f93b817')).toBe(true);
    expect(isUuid('23201458-2B66-526F-943E-27BA5F93B817')).toBe(true);
    expect(isUuid('23201458-2b66-526f-943e-27ba5f93b81')).toBe(false);
    expect(isUuid('pending-abc123')).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
