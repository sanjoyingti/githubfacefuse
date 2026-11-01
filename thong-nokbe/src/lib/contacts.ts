import { useCallback, useEffect, useState } from 'react';
import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts';
import { findUsersByPhones } from './users';
import { normalizePhone } from './phone';
import type { UserProfile } from './types';

export interface ContactRow {
  key: string;
  name: string;
  phone: string; // E.164
  user?: UserProfile; // set when this number uses the app
}

const FIELDS = [ContactField.FULL_NAME, ContactField.PHONES] as const;
let cached: { rows: ContactRow[]; denied: boolean } | null = null;

async function load(): Promise<{ rows: ContactRow[]; denied: boolean }> {
  const { granted } = await requestPermissionsAsync();
  if (!granted) return { rows: [], denied: true };
  const details = await Contact.getAllDetails(FIELDS);
  const byPhone = new Map<string, ContactRow>();
  for (const c of details) {
    for (const p of c.phones ?? []) {
      const n = normalizePhone(p.number ?? '');
      if (n && !byPhone.has(n)) byPhone.set(n, { key: `${c.id}-${n}`, name: c.fullName || n, phone: n });
    }
  }
  const list = [...byPhone.values()];
  const registered = await findUsersByPhones(list.map((r) => r.phone));
  return { rows: list.map((r) => ({ ...r, user: registered[r.phone] })).sort((a, b) => a.name.localeCompare(b.name)), denied: false };
}

/** Phone contacts, with the ones who use the app marked. Cached for the session; call reload() to refresh. */
export function useContacts() {
  const [state, setState] = useState(cached);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    () =>
      load()
        .then((res) => {
          cached = res;
          setState(res);
        })
        .catch((e: any) => {
          setError(e?.message ?? String(e));
          setState({ rows: [], denied: false });
        }),
    [],
  );

  useEffect(() => {
    if (!cached) run();
  }, [run]);

  return { loading: !state, rows: state?.rows ?? [], permissionDenied: !!state?.denied, error, reload: run };
}
