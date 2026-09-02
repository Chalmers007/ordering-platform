import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { normalizeHost } from '@/lib/tenancy/host';

/** The platform apex is only a launch point for the operator interface. */
export default async function Home() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get('x-forwarded-host');
  const host = forwardedHost ?? requestHeaders.get('host') ?? 'localhost:3000';
  const hostname = normalizeHost(host);
  const port = host.match(/:(\d+)$/)?.[1];
  const protocol =
    requestHeaders.get('x-forwarded-proto') ?? (hostname === 'localhost' ? 'http' : 'https');
  const adminHost = `admin.${hostname}${port ? `:${port}` : ''}`;

  redirect(`${protocol}://${adminHost}`);
}
