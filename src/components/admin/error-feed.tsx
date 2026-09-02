import { AlertTriangle } from 'lucide-react';

type PlatformError = {
  source: string;
  occurred_at: string;
  tenant_name: string | null;
  reference: string | null;
  detail: string | null;
};

const SOURCE_LABELS: Record<string, string> = {
  outbound_webhook: 'CRM webhook',
  payment_webhook: 'Payment',
  dispatch: 'Dispatch',
};

/** Real failures from three tables, newest first — not a log scrape. */
export function ErrorFeed({ errors }: { errors: PlatformError[] }) {
  if (errors.length === 0) {
    return (
      <section className="mt-6" aria-labelledby="errors-heading">
        <h2 id="errors-heading" className="text-lg font-semibold">
          Recent errors
        </h2>
        <p className="mt-2 rounded-xl border border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-500">
          Nothing has failed recently.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6" aria-labelledby="errors-heading">
      <h2 id="errors-heading" className="text-lg font-semibold">
        Recent errors
      </h2>
      <ul className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
        {errors.map((error, index) => (
          <li key={`${error.source}-${error.occurred_at}-${index}`} className="flex gap-3 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {SOURCE_LABELS[error.source] ?? error.source}
                {error.tenant_name ? ` · ${error.tenant_name}` : ''}
                {error.reference ? (
                  <span className="ml-2 font-normal text-neutral-500">{error.reference}</span>
                ) : null}
              </p>
              <p className="mt-0.5 break-words text-sm text-neutral-600">{error.detail}</p>
            </div>
            {/* Viewer-local formatting; see audit-log-viewer. */}
            <time
              suppressHydrationWarning
              dateTime={error.occurred_at}
              className="shrink-0 text-xs text-neutral-500"
            >
              {new Date(error.occurred_at).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
