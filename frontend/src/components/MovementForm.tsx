/**
 * Movement form: Stock In, Stock Out or Adjustment.
 *
 * The form adapts to the movement type rather than offering one generic screen:
 * `in`/`out` take a positive quantity, while an adjustment takes a signed one
 * and explains that the sign is the direction. The server enforces the same
 * rules; this only saves a round trip.
 *
 * A failed movement is reported verbatim from the API, so a refused
 * insufficient-stock attempt tells the user what is actually available.
 */

import { useState, type FormEvent } from 'react';

import { ErrorBanner, Field, PrimaryButton, SecondaryButton, Textarea } from '../components/ui';
import { inventoryApi, type InventoryItem, type MovementInput, type MovementType } from '../lib/inventory';
import { ApiError } from '../lib/request';

const TITLES: Record<MovementType, string> = {
  in: 'Record stock in',
  out: 'Record stock out',
  adjustment: 'Adjust stock',
};

const HINTS: Record<MovementType, string> = {
  in: 'Use a positive quantity, e.g. 25 for a delivery of 25 units.',
  out: 'Use a positive quantity. Stock can never be reduced below zero.',
  adjustment: 'Use a positive number to add stock, or a negative one to remove it. Zero is not allowed.',
};

export function MovementForm({
  movementType,
  product,
  onClose,
  onRecorded,
}: {
  movementType: MovementType;
  product: InventoryItem;
  onClose: () => void;
  onRecorded: (currentStock: number) => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [withReference, setWithReference] = useState(false);
  const [referenceType, setReferenceType] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No effect is needed to reset the quantity when the type changes: callers
  // pass `key={movementType}`, so a different type remounts this form with clean
  // state rather than cascading a render through an effect.

  const signed = movementType === 'adjustment';
  const parsed = Number(quantity);
  const locallyInvalid =
    quantity.trim() === '' || Number.isNaN(parsed) || (signed ? parsed === 0 : parsed <= 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locallyInvalid) return;

    setSaving(true);
    setError(null);

    const input: MovementInput = {
      productId: product.id,
      movementType,
      // Sent as a string so the server's decimal parsing is authoritative.
      quantity: quantity.trim(),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(withReference && referenceType.trim() && referenceId.trim()
        ? { referenceType: referenceType.trim(), referenceId: referenceId.trim() }
        : {}),
    };

    try {
      const result = await inventoryApi.record(input);
      onRecorded(result.meta.currentStock);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not record the movement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id="movement-form"
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      <ErrorBanner message={error} />

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
        <span className="font-medium text-slate-900">{product.name}</span>{' '}
        <span className="font-mono text-xs">{product.sku}</span>
        <p className="mt-1">
          Current stock: <span className="font-semibold">{product.currentStock}</span> {product.unit}
        </p>
      </div>

      <Field
        label="Quantity"
        type="number"
        value={quantity}
        onChange={setQuantity}
        step="0.01"
        placeholder={signed ? '-2.5' : '25'}
        hint={HINTS[movementType]}
      />

      <Textarea
        label="Reason"
        value={reason}
        onChange={setReason}
        maxLength={255}
        rows={2}
        placeholder={
          movementType === 'in'
            ? 'Supplier delivery'
            : movementType === 'out'
              ? 'Order fulfilment'
              : 'Stock count correction'
        }
      />

      <div className="space-y-3 rounded-lg border border-slate-200 p-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={withReference}
            onChange={(event) => setWithReference(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Link this movement to a reference
        </label>

        {withReference ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Reference type"
              value={referenceType}
              onChange={setReferenceType}
              maxLength={50}
              placeholder="purchase_order"
            />
            <Field
              label="Reference id"
              value={referenceId}
              onChange={setReferenceId}
              placeholder="UUID"
            />
          </div>
        ) : null}
      </div>

      <div className="flex justify-end gap-3">
        <SecondaryButton onClick={onClose} disabled={saving}>
          Cancel
        </SecondaryButton>
        <PrimaryButton type="submit" disabled={saving || locallyInvalid}>
          {saving ? 'Recording…' : TITLES[movementType]}
        </PrimaryButton>
      </div>
    </form>
  );
}
