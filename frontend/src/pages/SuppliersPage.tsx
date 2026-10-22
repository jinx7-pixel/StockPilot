/** Supplier directory backed by the authenticated, business-scoped supplier API. */

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  Card,
  DangerButton,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';
import { ApiError } from '../lib/request';
import {
  supplierApi,
  type ListMeta,
  type Supplier,
  type SupplierInput,
  type SupplierUpdateInput,
} from '../lib/purchasing';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'true' | 'false';
type SummaryCount = number | null;

const EMPTY_FORM: SupplierInput = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
};

function displayError(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
        isActive
          ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200'
          : 'border-slate-700 bg-slate-800 text-slate-300'
      }`}
    >
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card darkSurface className="min-w-0 p-4 sm:p-5">
      <p className="text-xs font-semibold tracking-[0.12em] text-slate-400 uppercase">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-100">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
    </Card>
  );
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-200">{value}</dd>
    </div>
  );
}

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [totalCount, setTotalCount] = useState<SummaryCount>(null);
  const [activeCount, setActiveCount] = useState<SummaryCount>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryRetryToken, setSummaryRetryToken] = useState(0);

  const [editing, setEditing] = useState<Supplier | null>(null);
  const [viewing, setViewing] = useState<Supplier | null>(null);
  const [statusCandidate, setStatusCandidate] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<SupplierInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    supplierApi
      .list({
        ...(appliedSearch ? { search: appliedSearch } : {}),
        isActive: status,
        page,
        limit: PAGE_SIZE,
      })
      .then(({ items, meta: listMeta }) => {
        if (cancelled) return;
        setSuppliers(items);
        setMeta(listMeta);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSuppliers(null);
        setMeta(null);
        setError(displayError(cause, 'Could not load suppliers.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, status, page, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    void Promise.allSettled([
      supplierApi.list({ isActive: 'all', page: 1, limit: 1 }),
      supplierApi.list({ isActive: 'true', page: 1, limit: 1 }),
    ]).then(([totalResult, activeResult]) => {
      if (cancelled) return;

      const failures: string[] = [];
      if (totalResult.status === 'fulfilled') {
        setTotalCount(totalResult.value.meta.total);
      } else {
        setTotalCount(null);
        failures.push(displayError(totalResult.reason, 'Could not load the total supplier count.'));
      }

      if (activeResult.status === 'fulfilled') {
        setActiveCount(activeResult.value.meta.total);
      } else {
        setActiveCount(null);
        failures.push(displayError(activeResult.reason, 'Could not load the active supplier count.'));
      }

      setSummaryError(failures.length > 0 ? failures.join(' ') : null);
      setSummaryLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [reloadToken, summaryRetryToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setSummaryLoading(true);
    setSummaryError(null);
    setReloadToken((token) => token + 1);
  }, []);

  function retrySummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    setSummaryRetryToken((token) => token + 1);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setCreating(true);
  }

  function openEdit(supplier: Supplier) {
    setViewing(null);
    setForm({
      name: supplier.name,
      contactName: supplier.contactName ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
    });
    setFormError(null);
    setEditing(supplier);
  }

  function closeForm() {
    if (saving) return;
    setCreating(false);
    setEditing(null);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const name = form.name.trim();
    if (!name) {
      setFormError('Supplier name is required.');
      return;
    }

    const phone = form.phone?.trim() ?? '';
    if (phone && (phone.length < 5 || !/^[+()\d\s.-]+$/.test(phone))) {
      setFormError('Phone must be at least 5 characters and use only digits, spaces, +, ( ), - or .');
      return;
    }

    setSaving(true);
    setFormError(null);
    setNotice(null);

    const optionalValues = {
      contactName: form.contactName?.trim() ?? '',
      phone,
      email: form.email?.trim() ?? '',
      address: form.address?.trim() ?? '',
      notes: form.notes?.trim() ?? '',
    };

    try {
      if (editing) {
        const payload: SupplierUpdateInput = {
          name,
          contactName: optionalValues.contactName || null,
          phone: optionalValues.phone || null,
          email: optionalValues.email || null,
          address: optionalValues.address || null,
          notes: optionalValues.notes || null,
        };
        await supplierApi.update(editing.id, payload);
        setNotice('Supplier updated.');
      } else {
        const payload: SupplierInput = {
          name,
          ...(optionalValues.contactName ? { contactName: optionalValues.contactName } : {}),
          ...(optionalValues.phone ? { phone: optionalValues.phone } : {}),
          ...(optionalValues.email ? { email: optionalValues.email } : {}),
          ...(optionalValues.address ? { address: optionalValues.address } : {}),
          ...(optionalValues.notes ? { notes: optionalValues.notes } : {}),
        };
        const created = await supplierApi.create(payload);
        setNotice(
          created.isActive
            ? 'Supplier created and ready for new purchase orders.'
            : 'Supplier created.',
        );
      }

      setCreating(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      reload();
    } catch (cause) {
      setFormError(displayError(cause, 'Could not save the supplier.'));
    } finally {
      setSaving(false);
    }
  }

  function requestStatusChange(supplier: Supplier) {
    setStatusCandidate(supplier);
    setStatusError(null);
  }

  function closeStatusDialog() {
    if (statusSaving) return;
    setStatusCandidate(null);
    setStatusError(null);
  }

  async function confirmStatusChange() {
    if (!statusCandidate || statusSaving) return;

    setStatusSaving(true);
    setStatusError(null);
    setError(null);
    setNotice(null);

    try {
      const updated = await supplierApi.update(statusCandidate.id, {
        isActive: !statusCandidate.isActive,
      });
      setNotice(
        updated.isActive
          ? `${updated.name} is active and can be selected for new purchase orders.`
          : `${updated.name} is inactive. Its purchase-order history is preserved.`,
      );
      setStatusCandidate(null);
      reload();
    } catch (cause) {
      setStatusError(displayError(cause, 'Could not update this supplier.'));
    } finally {
      setStatusSaving(false);
    }
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = search.trim();
    if (nextSearch === appliedSearch && page === 1) return;
    setAppliedSearch(nextSearch);
    setPage(1);
    setError(null);
    setLoading(true);
  }

  function clearFilters() {
    const needsRequest = appliedSearch !== '' || status !== 'all' || page !== 1;
    setSearch('');
    setAppliedSearch('');
    setStatus('all');
    setPage(1);
    setError(null);
    if (needsRequest) setLoading(true);
  }

  const hasFilters = appliedSearch !== '' || status !== 'all';
  const showClearFilters = hasFilters || search.trim() !== '';
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Manage supplier information and keep purchasing organized."
        darkSurface
        actions={<PrimaryButton darkSurface onClick={openCreate}>Add Supplier</PrimaryButton>}
      />

      {error && suppliers !== null ? <ErrorBanner darkSurface message={error} /> : null}
      {notice ? (
        <p role="status" className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      {summaryError ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <ErrorBanner darkSurface message={`Supplier totals are unavailable: ${summaryError}`} />
          </div>
          <SecondaryButton darkSurface onClick={retrySummary} disabled={summaryLoading}>Retry totals</SecondaryButton>
        </div>
      ) : null}

      <section aria-label="Supplier summary" className="grid gap-4 sm:grid-cols-2 lg:max-w-3xl">
        <SummaryCard
          label="Total suppliers"
          value={totalCount === null ? '—' : formatCount(totalCount)}
          detail={totalCount !== null ? 'Across active and inactive records' : summaryLoading ? 'Loading supplier total…' : 'Total unavailable'}
        />
        <SummaryCard
          label="Active suppliers"
          value={activeCount === null ? '—' : formatCount(activeCount)}
          detail={activeCount !== null ? 'Available for new purchase orders' : summaryLoading ? 'Loading active total…' : 'Active total unavailable'}
        />
      </section>

      <Card darkSurface className="p-4 sm:p-5">
        <form onSubmit={applySearch} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1.4fr)_minmax(12rem,1fr)_auto] lg:items-end">
          <Field
            label="Search supplier or contact name"
            value={search}
            onChange={setSearch}
            required={false}
            maxLength={150}
            placeholder="Supplier or contact name"
            darkSurface
          />

          <Select
            label="Supplier status"
            value={status}
            onChange={(value) => {
              setStatus(value as StatusFilter);
              setPage(1);
              setError(null);
              setLoading(true);
            }}
            options={[
              { value: 'all', label: 'All suppliers' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
            darkSurface
          />

          <div className="flex items-end gap-2">
            <PrimaryButton darkSurface type="submit">Search</PrimaryButton>
            {showClearFilters ? <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      <Card darkSurface className="overflow-hidden">
        {loading ? (
          <Spinner darkSurface label={suppliers === null ? 'Loading suppliers…' : 'Updating suppliers…'} />
        ) : suppliers === null ? (
          <EmptyState
            title="Suppliers could not be loaded"
            description={error ?? 'Check your connection and retry to load the supplier directory.'}
            action={<SecondaryButton darkSurface onClick={reload}>Retry</SecondaryButton>}
            darkSurface
          />
        ) : suppliers.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No suppliers match those filters' : 'No suppliers yet'}
            description={
              hasFilters
                ? 'Try another search or status, or clear the filters.'
                : 'Add a supplier before raising your first purchase order.'
            }
            action={
              hasFilters ? (
                <SecondaryButton darkSurface onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <PrimaryButton darkSurface onClick={openCreate}>Add the first supplier</PrimaryButton>
              )
            }
            darkSurface
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3 sm:px-6">
              <h2 className="text-sm font-semibold text-slate-100">Supplier directory</h2>
              <p role={loading ? 'status' : undefined} className="text-xs text-slate-400">
                {loading ? 'Refreshing suppliers…' : `${formatCount(meta?.total ?? suppliers.length)} supplier${meta?.total === 1 ? '' : 's'}`}
              </p>
            </div>

            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-slate-800 bg-[#0b1220] text-xs tracking-wide text-slate-400 uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Supplier</th>
                    <th scope="col" className="px-4 py-3 font-medium">Contact</th>
                    <th scope="col" className="px-4 py-3 font-medium">Email</th>
                    <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {suppliers.map((supplier) => (
                    <tr key={supplier.id} className="transition-colors hover:bg-white/[0.025]">
                      <td className="px-5 py-4 font-medium text-slate-100">{supplier.name}</td>
                      <td className="px-4 py-4 text-slate-300">{supplier.contactName || <span className="text-slate-500">—</span>}</td>
                      <td className="px-4 py-4 text-slate-300">
                        {supplier.email ? (
                          <a className="break-all text-emerald-300 hover:text-emerald-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" href={`mailto:${supplier.email}`}>
                            {supplier.email}
                          </a>
                        ) : <span className="text-slate-500">—</span>}
                      </td>
                      <td className="px-4 py-4 text-slate-300">
                        {supplier.phone ? (
                          <a className="whitespace-nowrap text-emerald-300 hover:text-emerald-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" href={`tel:${supplier.phone}`}>
                            {supplier.phone}
                          </a>
                        ) : <span className="text-slate-500">—</span>}
                      </td>
                      <td className="px-4 py-4"><StatusBadge isActive={supplier.isActive} /></td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <SecondaryButton darkSurface onClick={() => setViewing(supplier)}>View</SecondaryButton>
                          <SecondaryButton darkSurface onClick={() => openEdit(supplier)}>Edit</SecondaryButton>
                          <SecondaryButton darkSurface onClick={() => requestStatusChange(supplier)}>
                            {supplier.isActive ? 'Deactivate' : 'Reactivate'}
                          </SecondaryButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-800 xl:hidden">
              {suppliers.map((supplier) => (
                <article key={supplier.id} className="space-y-3 p-4 sm:p-5">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <h3 className="break-words text-base font-semibold text-slate-100">{supplier.name}</h3>
                    <StatusBadge isActive={supplier.isActive} />
                  </div>

                  {supplier.contactName ? <p className="text-sm text-slate-300">Contact: {supplier.contactName}</p> : null}
                  {supplier.email ? <a className="block break-all text-sm text-emerald-300 hover:text-emerald-200 hover:underline" href={`mailto:${supplier.email}`}>{supplier.email}</a> : null}
                  {supplier.phone ? <a className="block text-sm text-emerald-300 hover:text-emerald-200 hover:underline" href={`tel:${supplier.phone}`}>{supplier.phone}</a> : null}
                  {supplier.address ? <p className="line-clamp-2 text-sm text-slate-400">{supplier.address}</p> : null}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <SecondaryButton darkSurface onClick={() => setViewing(supplier)}>View</SecondaryButton>
                    <SecondaryButton darkSurface onClick={() => openEdit(supplier)}>Edit</SecondaryButton>
                    <SecondaryButton darkSurface onClick={() => requestStatusChange(supplier)}>
                      {supplier.isActive ? 'Deactivate' : 'Reactivate'}
                    </SecondaryButton>
                  </div>
                </article>
              ))}
            </div>

            {meta && meta.totalPages > 1 ? (
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-400 sm:px-6">
                <span>
                  {formatCount(meta.total)} supplier{meta.total === 1 ? '' : 's'} · Page {meta.page} of {meta.totalPages}
                </span>
                <div className="flex gap-2">
                  <SecondaryButton darkSurface
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((currentPage) => currentPage - 1);
                      setError(null);
                      setLoading(true);
                    }}
                  >
                    Previous
                  </SecondaryButton>
                  <SecondaryButton darkSurface
                    disabled={page >= totalPages}
                    onClick={() => {
                      setPage((currentPage) => currentPage + 1);
                      setError(null);
                      setLoading(true);
                    }}
                  >
                    Next
                  </SecondaryButton>
                </div>
              </footer>
            ) : null}
          </>
        )}
      </Card>

      {creating || editing ? (
        <Modal
          title={editing ? 'Edit supplier' : 'Add supplier'}
          darkSurface
          onClose={closeForm}
          footer={
            <>
              <SecondaryButton darkSurface onClick={closeForm} disabled={saving}>Cancel</SecondaryButton>
              <PrimaryButton darkSurface type="submit" form="supplier-form" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add supplier'}
              </PrimaryButton>
            </>
          }
        >
          <form id="supplier-form" onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner darkSurface message={formError} />

            <Field
              label="Supplier name"
              value={form.name ?? ''}
              onChange={(name) => setForm((current) => ({ ...current, name }))}
              maxLength={150}
              placeholder="Acme Parts"
              disabled={saving}
              darkSurface
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Contact name"
                value={form.contactName ?? ''}
                onChange={(contactName) => setForm((current) => ({ ...current, contactName }))}
                required={false}
                maxLength={100}
                disabled={saving}
                darkSurface
              />
              <Field
                label="Phone"
                type="tel"
                value={form.phone ?? ''}
                onChange={(phone) => setForm((current) => ({ ...current, phone }))}
                required={false}
                minLength={5}
                maxLength={30}
                placeholder="+91 98765 43210"
                disabled={saving}
                darkSurface
              />
            </div>

            <Field
              label="Email"
              type="email"
              value={form.email ?? ''}
              onChange={(email) => setForm((current) => ({ ...current, email }))}
              required={false}
              maxLength={255}
              disabled={saving}
              darkSurface
            />

            <Field
              label="Address"
              value={form.address ?? ''}
              onChange={(address) => setForm((current) => ({ ...current, address }))}
              required={false}
              maxLength={255}
              disabled={saving}
              darkSurface
            />

            <Textarea
              label="Notes"
              value={form.notes ?? ''}
              onChange={(notes) => setForm((current) => ({ ...current, notes }))}
              required={false}
              maxLength={2000}
              rows={3}
              disabled={saving}
              darkSurface
            />
          </form>
        </Modal>
      ) : null}

      {viewing ? (
        <Modal
          title={viewing.name}
          darkSurface
          onClose={() => setViewing(null)}
          footer={
            <>
              <SecondaryButton darkSurface onClick={() => setViewing(null)}>Close</SecondaryButton>
              <PrimaryButton darkSurface onClick={() => openEdit(viewing)}>Edit supplier</PrimaryButton>
            </>
          }
        >
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-400">Supplier details</p>
              <StatusBadge isActive={viewing.isActive} />
            </div>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <DetailField label="Contact name" value={viewing.contactName} />
              <DetailField label="Email" value={viewing.email} />
              <DetailField label="Phone" value={viewing.phone} />
              <DetailField label="Address" value={viewing.address} />
              <DetailField label="Notes" value={viewing.notes} />
              <DetailField label="Added" value={formatDate(viewing.createdAt)} />
              <DetailField label="Last updated" value={formatDate(viewing.updatedAt)} />
            </dl>
          </div>
        </Modal>
      ) : null}

      {statusCandidate ? (
        <Modal
          title={statusCandidate.isActive ? 'Deactivate supplier?' : 'Reactivate supplier?'}
          darkSurface
          onClose={closeStatusDialog}
          footer={
            <>
              <SecondaryButton darkSurface onClick={closeStatusDialog} disabled={statusSaving}>Cancel</SecondaryButton>
              {statusCandidate.isActive ? (
                <DangerButton darkSurface onClick={() => void confirmStatusChange()} disabled={statusSaving}>
                  {statusSaving ? 'Deactivating…' : 'Deactivate supplier'}
                </DangerButton>
              ) : (
                <PrimaryButton darkSurface onClick={() => void confirmStatusChange()} disabled={statusSaving}>
                  {statusSaving ? 'Reactivating…' : 'Reactivate supplier'}
                </PrimaryButton>
              )}
            </>
          }
        >
          <div className="space-y-3">
            <ErrorBanner darkSurface message={statusError} />
            <p className="text-sm leading-6 text-slate-300">
              {statusCandidate.isActive
                ? 'Deactivation keeps supplier and purchase-order history intact, but prevents this supplier from being used on new purchase orders. You can reactivate it later.'
                : 'Reactivating makes this supplier available for new purchase orders again.'}
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
