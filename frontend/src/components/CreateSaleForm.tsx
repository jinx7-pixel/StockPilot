/**
 * Create-sale form.
 *
 * A cart of product lines plus optional customer details. The running total is a
 * *preview only*: the authoritative total is computed server-side in PostgreSQL
 * from the products' current selling prices, and the confirmed sale replaces
 * this figure on success. The form deliberately offers no price or total input —
 * the server rejects them as unknown fields.
 *
 * Prices come from the products API and stock levels from the inventory API;
 * the two are joined in the parent page. That keeps the sale form working
 * without changing either API contract.
 */

import { useState, type FormEvent } from 'react';

import {
  ErrorBanner,
  Field,
  PrimaryButton,
  SecondaryButton,
} from './ui';
import { ApiError } from '../lib/request';
import { formatAmount, formatQuantity, salesApi, type CreateSaleInput, type Sale } from '../lib/sales';

export interface SellableProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  sellingPrice: number;
  /** Current stock, from the inventory listing. */
  currentStock: number;
}

interface DraftLine {
  key: string;
  productId: string;
  quantity: string;
}

let draftKey = 0;

export function CreateSaleForm({
  products,
  onClose,
  onCreated,
}: {
  products: SellableProduct[];
  onClose: () => void;
  onCreated: (sale: Sale) => void;
}) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { key: 'line-1', productId: products[0]?.id ?? '', quantity: '1' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    const unused = products.find(
      (product) => !lines.some((line) => line.productId === product.id),
    );
    draftKey += 1;
    setLines((current) => [
      ...current,
      { key: `line-${draftKey}`, productId: unused?.id ?? products[0]?.id ?? '', quantity: '1' },
    ]);
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
  }

  const complete = lines.filter(
    (line) => line.productId !== '' && Number(line.quantity) > 0,
  );
  const canSubmit = complete.length > 0 && products.length > 0;

  /**
   * Indicative total, computed from the prices already loaded for display.
   * Shown only so the user gets feedback while typing; the server recomputes it
   * authoritatively in `numeric`.
   */
  const estimatedTotal = complete.reduce((sum, line) => {
    const product = products.find((p) => p.id === line.productId);
    const quantity = Number(line.quantity);
    if (!product || !Number.isFinite(quantity)) return sum;
    return sum + product.sellingPrice * quantity;
  }, 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);

    const input: CreateSaleInput = {
      ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
      ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
      items: complete.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
    };

    try {
      const { data } = await salesApi.create(input);
      onCreated(data);
    } catch (cause) {
      // A 409 carries the server's own explanation, e.g. how much stock is
      // actually available, which is far more useful than a generic message.
      setError(cause instanceof ApiError ? cause.message : 'Could not record the sale.');
    } finally {
      setSaving(false);
    }
  }

  if (products.length === 0) {
    return (
      <div className="space-y-4">
        <ErrorBanner message="Add at least one product before recording a sale." />
        <div className="flex justify-end">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    );
  }

  return (
    <form id="create-sale-form" onSubmit={handleSubmit} className="space-y-4">
      <ErrorBanner message={error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Customer name"
          value={customerName}
          onChange={setCustomerName}
          required={false}
          maxLength={150}
          placeholder="Walk-in customer"
        />
        <Field
          label="Customer phone"
          value={customerPhone}
          onChange={setCustomerPhone}
          required={false}
          maxLength={30}
          placeholder="+91 98765 43210"
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-700">Items</legend>

        {lines.map((line) => {
          const product = products.find((p) => p.id === line.productId);
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
                  {products.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} — {option.sku} ({option.currentStock} {option.unit})
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

              <div className="flex-1 text-right text-sm text-slate-600">
                {product
                  ? `${formatAmount(product.sellingPrice.toFixed(2))} each · ${
                      product.currentStock
                    } ${product.unit} in stock`
                  : null}
              </div>

              {lines.length > 1 ? (
                <SecondaryButton onClick={() => removeLine(line.key)}>Remove</SecondaryButton>
              ) : null}
            </div>
          );
        })}

        <SecondaryButton onClick={addLine}>Add another item</SecondaryButton>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3">
        <p className="text-sm text-slate-600">
          Estimated total{' '}
          <span className="font-semibold text-slate-900">
            {formatAmount(estimatedTotal.toFixed(2))}
          </span>
        </p>
        <p className="text-xs text-slate-500">
          {formatQuantity(String(complete.length))} item
          {complete.length === 1 ? '' : 's'} · final total is calculated by the server
        </p>
      </div>

      <div className="flex justify-end gap-3">
        <SecondaryButton onClick={onClose} disabled={saving}>
          Cancel
        </SecondaryButton>
        <PrimaryButton type="submit" disabled={saving || !canSubmit}>
          {saving ? 'Recording…' : 'Record sale'}
        </PrimaryButton>
      </div>
    </form>
  );
}
