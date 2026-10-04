/**
 * Sale detail — the immutable record of a completed transaction.
 *
 * There is no edit or delete control, because the API exposes none. The stock
 * effect is a set of `out` movements in the inventory ledger, which is the only
 * place stock lives.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  Card,
  ErrorBanner,
  PageHeader,
  SecondaryButton,
  Spinner,
} from '../components/ui';
import { ApiError } from '../lib/request';
import { formatAmount, formatQuantity, salesApi, type Sale } from '../lib/sales';

export function SaleDetailPage() {
  const { saleId } = useParams<{ saleId: string }>();

  const [sale, setSale] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!saleId) return;
    let cancelled = false;

    salesApi
      .detail(saleId)
      .then(({ data }) => {
        if (cancelled) return;
        setSale(data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : 'Could not load this sale.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [saleId]);

  if (loading) return <Spinner label="Loading sale…" />;

  if (error || !sale) {
    return (
      <div className="space-y-6">
        <ErrorBanner message={error ?? 'Sale not found.'} />
        <Link to="/app/sales">
          <SecondaryButton>Back to sales</SecondaryButton>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={sale.customerName ?? 'Walk-in customer'}
        description={`Sale recorded ${new Date(sale.soldAt).toLocaleString()}`}
        actions={
          <Link to="/app/sales">
            <SecondaryButton>Back</SecondaryButton>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Total</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {formatAmount(sale.totalAmount)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Items</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{sale.itemCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Status</p>
          <p className="mt-1 text-2xl font-bold text-green-700 capitalize">{sale.status}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Recorded by</p>
          <p className="mt-1 truncate text-lg font-semibold text-slate-900">
            {sale.createdBy.name}
          </p>
        </Card>
      </div>

      <Card>
        <header className="border-b border-slate-200 px-6 py-4">
          <h2 className="font-semibold text-slate-900">Items</h2>
          <p className="text-sm text-slate-500">
            Prices are snapshotted at the time of sale, so a later price change never
            rewrites this record.
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-6 py-3 font-medium">Product</th>
                <th scope="col" className="px-6 py-3 font-medium">SKU</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">Qty</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">Unit price</th>
                <th scope="col" className="px-6 py-3 text-right font-medium">Line total</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200">
              {(sale.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-4">
                    <Link
                      to={`/app/inventory/${item.productId}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {item.productName}
                    </Link>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-700">{item.sku}</td>
                  <td className="px-6 py-4 text-right text-slate-600">
                    {formatQuantity(item.quantity)} {item.unit}
                  </td>
                  <td className="px-6 py-4 text-right text-slate-600">
                    {formatAmount(item.unitPrice)}
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-slate-900">
                    {formatAmount(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot className="border-t border-slate-200 bg-slate-50">
              <tr>
                <td colSpan={4} className="px-6 py-3 text-right text-sm font-medium text-slate-700">
                  Total
                </td>
                <td className="px-6 py-3 text-right text-base font-bold text-slate-900">
                  {formatAmount(sale.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <p className="text-xs text-slate-500">
        Sales are immutable. Each line also created an `out` movement in the inventory
        ledger — see the product&apos;s inventory for the full history.
      </p>
    </div>
  );
}
