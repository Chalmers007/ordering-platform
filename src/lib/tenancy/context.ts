import 'server-only';

import { headers } from 'next/headers';
import type { Surface, TenantContext, TenantStatus } from '@/types/database';
import {
  HOSTNAME_HEADER,
  SURFACE_HEADER,
  TENANT_ID_HEADER,
  TENANT_NAME_HEADER,
  TENANT_SLUG_HEADER,
  TENANT_STATUS_HEADER,
} from '../../proxy';

/**
 * The tenant for the current request, as resolved by proxy.ts from the
 * Host header.
 *
 * These headers are stripped from every inbound request before being set, so
 * they cannot be forged. Nothing in the application accepts a tenant id from
 * a request body.
 */
export async function getTenantContext(): Promise<TenantContext | null> {
  const h = await headers();
  const tenantId = h.get(TENANT_ID_HEADER);
  const slug = h.get(TENANT_SLUG_HEADER);

  if (!tenantId || !slug) return null;

  return {
    tenantId,
    slug,
    name: decodeURIComponent(h.get(TENANT_NAME_HEADER) ?? ''),
    status: (h.get(TENANT_STATUS_HEADER) ?? 'pending') as TenantStatus,
    hostname: h.get(HOSTNAME_HEADER) ?? '',
    impersonated: h.get('x-impersonated-tenant') !== null,
  };
}

export async function getSurface(): Promise<Surface> {
  const h = await headers();
  return (h.get(SURFACE_HEADER) ?? 'marketing') as Surface;
}

export class TenantResolutionError extends Error {
  constructor(message = 'No storefront is configured for this address') {
    super(message);
    this.name = 'TenantResolutionError';
  }
}

/** Use where a missing tenant is a programming error rather than a 404. */
export async function requireTenantContext(): Promise<TenantContext> {
  const context = await getTenantContext();
  if (!context) throw new TenantResolutionError();
  if (context.status !== 'active') {
    throw new TenantResolutionError('This restaurant is not currently accepting orders');
  }
  return context;
}
