'use client';

import { useRef, useState, useTransition } from 'react';
import Papa from 'papaparse';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { importMenu, type ImportSummary } from '@/app/(kds)/app/(dashboard)/menu/actions';

/**
 * Bulk import.
 *
 * Accepts CSV or JSON with the same flat shape, because that is what falls
 * out of a spreadsheet:
 *
 *   category,name,description,price,available
 *   Pizzas,Margherita,"San Marzano, basil",14.00,true
 *
 * Parsing happens here; validation happens on the server, per row, so one
 * malformed line reports itself instead of abandoning the other 300.
 */
export function MenuImport() {
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const isJson = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';

    const send = (rows: unknown[]) => {
      startTransition(async () => {
        const result = await importMenu(rows);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setSummary(result.data);
        const { itemsCreated, itemsUpdated, skipped } = result.data;
        toast.success(
          `Imported ${itemsCreated} new and updated ${itemsUpdated} item${itemsUpdated === 1 ? '' : 's'}` +
            (skipped.length ? ` · ${skipped.length} skipped` : ''),
        );
      });
    };

    if (isJson) {
      void file.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as unknown;
          const rows = Array.isArray(parsed)
            ? parsed
            : ((parsed as { items?: unknown[] }).items ?? []);
          send(rows);
        } catch {
          toast.error('That file is not valid JSON');
        }
      });
      return;
    }

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      // Header names vary by spreadsheet; normalise rather than demand exact.
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (results) => {
        const rows = results.data.map((row) => ({
          category: row.category ?? row.section ?? '',
          name: row.name ?? row.item ?? row.title ?? '',
          description: row.description ?? '',
          price: row.price ?? row.amount ?? '0',
          available: (row.available ?? 'true').toLowerCase() !== 'false',
        }));
        send(rows);
      },
      error: () => toast.error('That file could not be read'),
    });
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="font-semibold text-neutral-100">Bulk import</h2>
      <p className="mt-0.5 text-sm text-neutral-400">
        CSV or JSON with columns <code className="text-neutral-300">category, name, description, price, available</code>.
        Items are matched by name — an existing item is updated, not duplicated.
      </p>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        className={`mt-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragging ? 'border-neutral-400 bg-neutral-800' : 'border-neutral-700'
        }`}
      >
        <Upload className="mx-auto h-6 w-6 text-neutral-500" aria-hidden />
        <p className="mt-2 text-sm text-neutral-300">Drop a CSV or JSON file here</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            event.target.value = '';
          }}
        />
        <Button
          variant="outline"
          className="mt-3"
          loading={pending}
          onClick={() => inputRef.current?.click()}
        >
          Choose a file
        </Button>
      </div>

      {summary ? (
        <div className="mt-3 rounded-lg bg-neutral-800 px-3 py-2.5 text-sm text-neutral-200">
          <p>
            {summary.categoriesCreated} new categor
            {summary.categoriesCreated === 1 ? 'y' : 'ies'} · {summary.itemsCreated} items created ·{' '}
            {summary.itemsUpdated} updated
          </p>
          {summary.skipped.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-300">
              {summary.skipped.slice(0, 8).map((s) => (
                <li key={s.row}>
                  Row {s.row}: {s.reason}
                </li>
              ))}
              {summary.skipped.length > 8 ? (
                <li>…and {summary.skipped.length - 8} more</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
