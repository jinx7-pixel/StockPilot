/**
 * Create purchase order form.
 *
 * The running total is a **preview only**. The authoritative total is computed
 * server-side in PostgreSQL from the quantities and unit costs entered here, and
 * the confirmed order replaces this figure on success. The form deliberately
 * offers no total, unit-cost-of-record or stock input — the server rejects
 * those as unknown fields.
 */

import { useRef, useState, type FormEvent } from 'react';

import { ErrorBanner, Field, PrimaryButton, SecondaryButton, Textarea } from './ui';
import { ApiError } from '../lib/request';
import { type Product } from '../lib/catalog';
import {
  formatAmount,
  purchaseOrderApi,
  type PurchaseOrder,
  type PurchaseOrderInput,
  type Supplier,
} from '../lib/purchasing';

interface DraftLine {
  key: string;
  productId: string;
  quantity: string;
  unitCost: string;
}

export function CreatePurchaseOrderForm({
  suppliers,
  products,
  onClose,
  onCreated,
}: {
  suppliers: Supplier[];
  products: Product[];
  onClose: () => void;
  onCreated: (order: PurchaseOrder) => void;
}) {
  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);
  const activeProducts = products.filter((product) => product.isActive);

  const [supplierId, setSupplierId] = useState(activeSuppliers[0]?.id ?? '');
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { key: 'line-1', productId: activeProducts[0]?.id ?? '', quantity: '1', unitCost: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref rather than a module-level counter: mutating module state during render
  // is a React purity violation, and a ref is per-instance anyway.
  const nextLineKey = useRef(2);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    const unused = activeProducts.find(
      (product) => !lines.some((line) => line.productId === product.id),
    );
    setLines((current) => [
      ...current,
      {
        key: `line-${nextLineKey.current++}`,
        productId: unused?.id ?? activeProducts[0]?.id ?? '',
        quantity: '1',
        unitCost: '',
      },
    ]);
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
  }

  const complete = lines.filter(
    (line) =>
      line.productId !== '' &&
      Number(line.quantity) > 0 &&
      line.unitCost !== '' &&
      Number(line.unitCost) >= 0 &&
      Number.isFinite(Number(line.unitCost)),
  );
  const canSubmit = complete.length > 0 && supplierId !== '';

  /** Indicative total for display; the server recomputes it authoritatively. */
  const estimatedTotal = complete.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const unitCost = Number(line.unitCost);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) return sum;
    return sum + quantity * unitCost;
  }, 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);

    const input: PurchaseOrderInput = {
      supplierId,
      ...(expectedAt ? { expectedAt: new Date(expectedAt).toISOString() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      items: complete.map((line) => ({
        productId: line.productId,
        quantity: line.quantity.trim(),
        unitCost: line.unitCost.trim(),
      })),
    };

    try {
      const created = await purchaseOrderApi.create(input);
      onCreated(created);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Could not create the purchase order.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (activeSuppliers.length === 0 || activeProducts.length === 0) {
    return (
      <div className="space-y-4">
        <ErrorBanner
          message={
            activeSuppliers.length === 0
              ? 'Add an active supplier before raising a purchase order.'
              : 'Add an active product before raising a purchase order.'
          }
        />
        <div className="flex justify-end">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    );
  }

  return (
    <form id="create-po-form" onSubmit={handleSubmit} className="space-y-4">
      <ErrorBanner message={error} />

      <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
        Creating an order records intent only. Stock increases when goods are received.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="po-supplier" className="block text-sm font-medium text-slate-700">
            Supplier
          </label>
          <select
            id="po-supplier"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            {activeSuppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </div>

        <Field
          label="Expected delivery"
          type="date"
          value={expectedAt}
          onChange={setExpectedAt}
          required={false}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-700">Items</legend>

        {lines.map((line) => {
          const product = activeProducts.find((p) => p.id === line.productId);
          return (
            <div
              key={line.key}
              className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3"
            >
              <div className="min-w-48 flex-1">
                <label className="block text-sm font-medium text-slate-700">Product</label>
                <select
                  value={line.productId}
                  onChange={(event) => updateLine(line.key, { productId: event.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {activeProducts.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} — {option.sku}
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-28">
                <label className="block text-sm font-medium text-slate-700">Quantity</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={line.quantity}
                  onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>

              <div className="w-32">
                <label className="block text-sm font-medium text-slate-700">Unit cost</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.unitCost}
                  onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                  placeholder="0.00"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>

              <div className="flex-1 text-right text-sm text-slate-600">
                {product ? `sells at ${formatAmount(product.sellingPrice.toFixed(2))}` : null}
              </div>

              {lines.length > 1 ? (
                <SecondaryButton onClick={() => removeLine(line.key)}>Remove</SecondaryButton>
              ) : null}
            </div>
          );
        })}

        <SecondaryButton onClick={addLine}>Add another item</SecondaryButton>
      </fieldset>

      <Textarea
        label="Notes"
        value={notes}
        onChange={setNotes}
        required={false}
        maxLength={2000}
        rows={2}
        placeholder="Optional note for your own records"
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3">
        <p className="text-sm text-slate-600">
          Estimated total{' '}
          <span className="font-semibold text-slate-900">
            {formatAmount(estimatedTotal.toFixed(2))}
          </span>
        </p>
        <p className="text-xs text-slate-500">
          Final total is calculated by the server.
        </p>
      </div>

      <div className="flex justify-end gap-3">
        <SecondaryButton onClick={onClose} disabled={saving}>
          Cancel
        </SecondaryButton>
        <PrimaryButton type="submit" disabled={saving || !canSubmit}>
          {saving ? 'Creating…' : 'Create purchase order'}
        </PrimaryButton>
      </div>
    </form>
  );
}

