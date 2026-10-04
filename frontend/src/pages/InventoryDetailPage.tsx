/**
 * Inventory detail: current stock, a movement summary, and the immutable ledger.
 *
 * The ledger is presented as read-only by design â€” there is no edit or delete
 * control anywhere, because the API exposes none. A mistake is corrected by
 * recording another movement, which is offered here as the only way forward.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { MovementForm } from '../components/MovementForm';
import {
  Card,
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
  Spinner,
} from '../components/ui';
import {
  inventoryApi,
  type ListMeta,
  type Movement,
  type MovementType,
  type ProductInventory,
} from '../lib/inventory';
import { ApiError } from '../lib/request';

const PAGE_SIZE = 20;

type Filter = 'all' | MovementType;

const MOVEMENT_STYLE: Record<MovementType, string> = {
  in: 'bg-green-100 text-green-700',
  out: 'bg-red-100 text-red-700',
  adjustment: 'bg-amber-100 text-amber-700',
};

const MOVEMENT_LABEL: Record<MovementType, string> = {
  in: 'Stock in',
  out: 'Stock out',
  adjustment: 'Adjustment',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** A ledger row shows the signed effect, which is what a reader cares about. */
function signedQuantity(movement: Movement): string {
  if (movement.movementType === 'in') return `+${movement.quantity}`;
  if (movement.movementType === 'out') return `âˆ’${movement.quantity}`;
  return movement.quantity > 0 ? `+${movement.quantity}` : `âˆ’${Math.abs(movement.quantity)}`;
}

export function InventoryDetailPage() {
  const { productId } = useParams<{ productId: string }>();

  const [detail, setDetail] = useState<ProductInventory | null>(null);
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moving, setMoving] = useState<MovementType | null>(null);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;

    inventoryApi
      .detail(productId)
      .then(({ data }) => {
        if (cancelled) return;
        setDetail(data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : 'Could not load this product.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [productId, reloadToken]);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;

    inventoryApi
      .movements(productId, {
        ...(filter !== 'all' ? { movementType: filter } : {}),
        page,
        limit: PAGE_SIZE,
      })
      .then(({ data, meta: listMeta }) => {
        if (cancelled) return;
        setMovements(data);
        setMeta(listMeta);
      })
      .catch(() => {
        if (!cancelled) setMovements([]);
      });

    return () => {
      cancelled = true;
    };
  }, [productId, filter, page, reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  const totalPages = meta?.totalPages ?? 1;

  if (loading) {
    return <Spinner label="Loading inventoryâ€¦" />;
  }

  if (error || !detail) {
    return (
      <div className="space-y-6">
        <ErrorBanner message={error ?? 'Product not found.'} />
        <Link to="/app/inventory">
          <SecondaryButton>Back to inventory</SecondaryButton>
        </Link>
      </div>
    );
  }

  const { product } = detail;

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.name}
        description={`${product.sku}${product.categoryName ? ` Â· ${product.categoryName}` : ''}`}
        actions={
          <Link to="/app/inventory">
            <SecondaryButton>Back</SecondaryButton>
          </Link>
        }
      />

      {notice ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Current stock</p>
          <p
            className={`mt-1 text-2xl font-bold ${
              detail.currentStock <= 0 ? 'text-red-600' : 'text-slate-900'
            }`}
          >
            {detail.currentStock} {product.unit}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Total in</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{detail.totals.in}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Total out</p>
          <p className="mt-1 text-2xl font-bold text-red-700">{detail.totals.out}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Adjustments</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">{detail.totals.adjustment}</p>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-slate-600">
          {detail.movementCount} ledger {detail.movementCount === 1 ? 'entry' : 'entries'}
          {detail.lastMovementAt ? ` Â· last ${formatDate(detail.lastMovementAt)}` : ''}
        </p>

        <div className="flex flex-wrap gap-2">
          <PrimaryButton onClick={() => setMoving('in')}>Stock in</PrimaryButton>
          <PrimaryButton onClick={() => setMoving('out')}>Stock out</PrimaryButton>
          <PrimaryButton onClick={() => setMoving('adjustment')}>Adjust</PrimaryButton>
        </div>
      </Card>

      <Card>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">Movement ledger</h2>
            <p className="text-sm text-slate-500">
              Append-only. Entries are never edited or deleted â€” a correction is a new entry.
            </p>
          </div>

          <div className="w-48">
            <Select
              label="Type"
              value={filter}
              onChange={(value) => {
                setFilter(value as Filter);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'All types' },
                { value: 'in', label: 'Stock in' },
                { value: 'out', label: 'Stock out' },
                { value: 'adjustment', label: 'Adjustment' },
              ]}
            />
          </div>
        </header>

        {movements === null ? (
          <Spinner label="Loading ledgerâ€¦" />
        ) : movements.length === 0 ? (
          <EmptyState
            title="No movements recorded"
            description="Record stock in, stock out, or an adjustment to start this product's ledger."
            action={<PrimaryButton onClick={() => setMoving('in')}>Record stock in</PrimaryButton>}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-6 py-3 font-medium">Type</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Quantity</th>
                    <th scope="col" className="px-6 py-3 font-medium">Reason</th>
                    <th scope="col" className="px-6 py-3 font-medium">Reference</th>
                    <th scope="col" className="px-6 py-3 font-medium">Recorded by</th>
                    <th scope="col" className="px-6 py-3 font-medium">When</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {movements.map((movement) => (
                    <tr key={movement.id}>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            MOVEMENT_STYLE[movement.movementType]
                          }`}
                        >
                          {MOVEMENT_LABEL[movement.movementType]}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-slate-900">
                        {signedQuantity(movement)} {product.unit}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {movement.reason ?? <span className="text-slate-400">â€”</span>}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {movement.referenceType ? (
                          <span className="text-xs">
                            {movement.referenceType}
                            <span className="block font-mono text-[10px] break-all text-slate-400">
                              {movement.referenceId}
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-400">â€”</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-600">{movement.createdBy.name}</td>
                      <td className="px-6 py-4 text-slate-500">{formatDate(movement.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages > 1 ? (
              <footer className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-sm text-slate-600">
                <span>
                  Page {meta.page} of {meta.totalPages}
                </span>
                <div className="flex gap-2">
                  <SecondaryButton
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </SecondaryButton>
                </div>
              </footer>
            ) : null}
          </>
        )}
      </Card>

      {moving ? (
        <Modal
          title={
            moving === 'in'
              ? 'Record stock in'
              : moving === 'out'
                ? 'Record stock out'
                : 'Adjust stock'
          }
          onClose={() => setMoving(null)}
        >
          {product && (
            <MovementForm
              key={moving}
              movementType={moving}
              product={{
                id: product.id,
                sku: product.sku,
                name: product.name,
                categoryId: product.categoryId,
                category: null,
                unit: product.unit,
                isActive: product.isActive,
                currentStock: detail.currentStock,
              }}
              onClose={() => setMoving(null)}
              onRecorded={(currentStock) => {
                setNotice(`Recorded. ${product.name} now has ${currentStock} ${product.unit}.`);
                setMoving(null);
                reload();
              }}
            />
          )}
        </Modal>
      ) : null}
    </div>
  );
}

