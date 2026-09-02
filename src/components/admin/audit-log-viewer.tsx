'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { diffAuditRow, isMoneyField } from '@/lib/admin/diff';
import { formatCents } from '@/lib/money';
import type { AuditLog } from '@/types/database';

type TenantOption = { id: string; name: string };

const PAGE_SIZE = 50;

/**
 * Cross-tenant audit browser.
 *
 * Queries `audit_logs` directly rather than through an RPC, so RLS does the
 * scoping: a super admin sees every tenant, a restaurant owner sees only
 * their own, and the same component is correct for both.
 */
export function AuditLogViewer({
  tenants,
  initialLogs,
}: {
  tenants: TenantOption[];
  initialLogs: AuditLog[];
}) {
  const [logs, setLogs] = useState<AuditLog[]>(initialLogs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [tenantId, setTenantId] = useState('');
  const [userId, setUserId] = useState('');
  const [operation, setOperation] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const tenantNames = useMemo(
    () => new Map(tenants.map((tenant) => [tenant.id, tenant.name])),
    [tenants],
  );

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();

    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (tenantId) query = query.eq('tenant_id', tenantId);
    if (userId.trim()) query = query.eq('user_id', userId.trim());
    if (operation) query = query.eq('operation', operation);
    if (action) query = query.eq('action', action as 'INSERT' | 'UPDATE' | 'DELETE');
    if (from) query = query.gte('created_at', new Date(from).toISOString());
    // The picker gives a date; the filter must cover the whole of that day.
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      query = query.lte('created_at', end.toISOString());
    }

    const { data, error: queryError } = await query;
    setLoading(false);

    if (queryError) {
      setError(queryError.message);
      return;
    }
    setLogs((data ?? []) as AuditLog[]);
  }, [tenantId, userId, operation, action, from, to]);

  // Re-run whenever a filter changes, debounced so typing a user id does
  // not fire a query per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => void search(), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  function toggle(id: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <select
          aria-label="Filter by restaurant"
          className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm"
          value={tenantId}
          onChange={(event) => setTenantId(event.target.value)}
        >
          <option value="">All restaurants</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by operation"
          className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm"
          value={operation}
          onChange={(event) => setOperation(event.target.value)}
        >
          <option value="">All operations</option>
          {[
            'TOGGLE_KITCHEN_PAUSE',
            'ADJUST_PREP_TIME',
            'ADVANCE_ORDER_STATUS',
            'PROVISION_TENANT',
            'ASSIGN_TENANT_OWNER',
            'START_IMPERSONATION',
            'END_IMPERSONATION',
          ].map((value) => (
            <option key={value} value={value}>
              {value.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by action"
          className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        >
          <option value="">All actions</option>
          <option value="INSERT">INSERT</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
        </select>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <Input
            className="pl-9"
            aria-label="Filter by user id"
            placeholder="User id"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </div>

        <Input
          type="date"
          aria-label="From date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Input
          type="date"
          aria-label="To date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-500">Loading…</p>
        ) : logs.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-500">
            No audit entries match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {logs.map((log) => {
              const open = expanded.has(log.id);
              const diffs = open
                ? diffAuditRow(log.old_data, log.new_data, log.changed_fields)
                : [];

              return (
                <li key={log.id}>
                  <button
                    onClick={() => toggle(log.id)}
                    aria-expanded={open}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                  >
                    {open ? (
                      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                    ) : (
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold">
                          {log.action}
                        </span>{' '}
                        {log.table_name}
                        {log.operation ? (
                          <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-800">
                            {log.operation}
                          </span>
                        ) : null}
                        {log.impersonated ? (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
                            impersonated
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-neutral-500">
                        {log.tenant_id ? tenantNames.get(log.tenant_id) ?? log.tenant_id : 'Platform'}
                        {log.user_id ? ` · ${log.user_id}` : ' · system'}
                        {log.changed_fields?.length
                          ? ` · ${log.changed_fields.join(', ')}`
                          : ''}
                      </p>
                    </div>

                    {/* Rendered in the viewer's own locale and timezone, which the server
                        cannot know. The client value is the correct one, so the mismatch is
                        expected rather than a bug to chase. */}
                    <time
                      suppressHydrationWarning
                      dateTime={log.created_at}
                      className="shrink-0 text-xs text-neutral-500"
                    >
                      {new Date(log.created_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  </button>

                  {open ? (
                    <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3">
                      {diffs.length === 0 ? (
                        <p className="text-sm text-neutral-500">No field-level changes recorded.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                            <tr>
                              <th scope="col" className="py-1 pr-4">Field</th>
                              <th scope="col" className="py-1 pr-4">Before</th>
                              <th scope="col" className="py-1">After</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diffs.map((diff) => {
                              const money = isMoneyField(diff.field);
                              const show = (value: string) =>
                                money && /^-?\d+$/.test(value)
                                  ? `${formatCents(Number(value))} (${value})`
                                  : value;

                              return (
                                <tr key={diff.field} className="align-top">
                                  <td className="py-1 pr-4 font-medium">{diff.field}</td>
                                  <td className="py-1 pr-4 break-all text-red-700">
                                    {show(diff.before)}
                                  </td>
                                  <td className="py-1 break-all text-emerald-700">
                                    {show(diff.after)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        Showing the {logs.length} most recent matching entries.
      </p>
    </div>
  );
}
