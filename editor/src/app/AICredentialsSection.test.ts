import { describe, it, expect } from 'vitest';
import type { SettingsStatus } from '@/api/client';
import { CREDENTIALS, DEFAULT_SETTINGS, ENDPOINT_ENV } from '@engine/ai/providers.ts';
import { addressRows, keyRows } from './AICredentialsSection';

/** A status as the engine's settings route builds it: a credential per `CREDENTIALS`, an address per `ENDPOINT_ENV`. */
const status: SettingsStatus = {
  settings_file: 'ai-settings.json',
  ai: { provider: '', model: '', environment: [] },
  credentials: Object.fromEntries(Object.keys(CREDENTIALS).map((id) => [id, { configured: false, source: '' }])),
  endpoints: Object.fromEntries(Object.keys(ENDPOINT_ENV).map((id) => [id, ''])),
};

describe('the settings dialog\'s keys and addresses', () => {
  it('offer every provider the engine takes a key or an address for, and no other (B36)', () => {
    // GitHub Models' address could be set by the environment and not here.
    expect(keyRows(status).map((row) => row.id).sort()).toEqual(Object.keys(CREDENTIALS).sort());
    expect(addressRows(status).map((row) => row.id).sort()).toEqual(Object.keys(ENDPOINT_ENV).sort());
  });

  it('show, in an empty address box, the address the engine calls then', () => {
    for (const row of addressRows(status)) {
      if (DEFAULT_SETTINGS.endpoints[row.id]) expect(row.placeholder).toBe(DEFAULT_SETTINGS.endpoints[row.id]);
    }
  });
});
