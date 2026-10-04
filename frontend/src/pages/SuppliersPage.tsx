/**
 * Suppliers page — list, create, edit, and activate/deactivate.
 *
 * There is no delete action: a supplier with purchase orders cannot be removed,
 * so deactivation is the way to retire one.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  Card,
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
import { supplierApi, type ListMeta, type Supplier, type SupplierInput } from '../lib/purchasing';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'true' | 'false';

const EMPTY_FORM: SupplierInput = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
};

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

  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<SupplierInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    supplierApi
      .list({
        ...(appliedSearch ? { search: appliedSearch } : {}),
        isActive: status,
        page,
        limit: PAGE_SIZE,
      })
      .then(({ data, meta: listMeta }) => {
        if (cancelled) return;
        setSuppliers(data);
        setMeta(listMeta);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : 'Could not load suppliers.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedSearch, status, page, reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setCreating(true);
  }

  function openEdit(supplier: Supplier) {
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

  function closeDialog() {
    setCreating(false);
    setEditing(null);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setNotice(null);

    // Empty optional strings are omitted so the server stores NULL rather than
    // an empty value.
    const payload: SupplierInput = { name: form.name.trim() };
    for (const key of ['contactName', 'phone', 'email', 'address', 'notes'] as const) {
      const value = form[key]?.trim();
      if (value) Object.assign(payload, { [key]: value });
    }

    try {
      if (editing) {
        await supplierApi.update(editing.id, payload);
        setNotice('Supplier updated.');
      } else {
        await supplierApi.create(payload);
        setNotice('Supplier created.');
      }
      closeDialog();
      reload();
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : 'Could not save the supplier.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(supplier: Supplier) {
    setError(null);
    setNotice(null);

    try {
      await supplierApi.update(supplier.id, { isActive: !supplier.isActive });
      setNotice(`${supplier.name} ${supplier.isActive ? 'deactivated' : 'reactivated'}.`);
      reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not update the supplier.');
    }
  }

  function applySearch() {
    setAppliedSearch(search.trim());
    setPage(1);
    setLoading(true);
  }

  function clearFilters() {
    setSearch('');
    setAppliedSearch('');
    setStatus('all');
    setPage(1);
    setLoading(true);
  }

  const hasFilters = appliedSearch !== '' || status !== 'all';
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Who you buy from. Suppliers are deactivated rather than deleted, so order history stays intact."
        actions={<PrimaryButton onClick={openCreate}>New supplier</PrimaryButton>}
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      ) : null}

      <Card className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            applySearch();
          }}
          className="grid gap-4 sm:grid-cols-3"
        >
          <Field
            label="Search"
            value={search}
            onChange={setSearch}
            required={false}
            maxLength={150}
            placeholder="Name or contact"
          />

          <Select
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value as StatusFilter);
              setPage(1);
              setLoading(true);
            }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ]}
          />

          <div className="flex items-end gap-2">
            <PrimaryButton type="submit">Search</PrimaryButton>
            {hasFilters ? <SecondaryButton onClick={clearFilters}>Clear</SecondaryButton> : null}
          </div>
        </form>
      </Card>

      <Card>
        {loading ? (
          <Spinner label="Loading suppliers…" />
        ) : suppliers === null ? null : suppliers.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No suppliers match those filters' : 'No suppliers yet'}
            description={
              hasFilters
                ? 'Try a different search, or clear the filters.'
                : 'Add a supplier before raising your first purchase order.'
            }
            action={
              hasFilters ? (
                <SecondaryButton onClick={clearFilters}>Clear filters</SecondaryButton>
              ) : (
                <PrimaryButton onClick={openCreate}>Add the first supplier</PrimaryButton>
              )
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-6 py-3 font-medium">Supplier</th>
                    <th scope="col" className="px-6 py-3 font-medium">Contact</th>
                    <th scope="col" className="px-6 py-3 font-medium">Phone</th>
                    <th scope="col" className="px-6 py-3 font-medium">Status</th>
                    <th scope="col" className="px-6 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {suppliers.map((supplier) => (
                    <tr key={supplier.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-900">{supplier.name}</td>
                      <td className="px-6 py-4 text-slate-600">
                        {supplier.contactName ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {supplier.phone ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={
                            supplier.isActive
                              ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
                              : 'rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600'
                          }
                        >
                          {supplier.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <SecondaryButton onClick={() => openEdit(supplier)}>Edit</SecondaryButton>
                          <SecondaryButton onClick={() => void toggleActive(supplier)}>
                            {supplier.isActive ? 'Deactivate' : 'Reactivate'}
                          </SecondaryButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta && meta.totalPages > 1 ? (
              <footer className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-sm text-slate-600">
                <span>
                  {meta.total} supplier{meta.total === 1 ? '' : 's'}
                </span>
                <div className="flex gap-2">
                  <SecondaryButton
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((p) => p - 1);
                      setLoading(true);
                    }}
                  >
                    Previous
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={page >= totalPages}
                    onClick={() => {
                      setPage((p) => p + 1);
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
          title={editing ? 'Edit supplier' : 'New supplier'}
          onClose={closeDialog}
          footer={
            <>
              <SecondaryButton onClick={closeDialog} disabled={saving}>
                Cancel
              </SecondaryButton>
              <PrimaryButton type="submit" form="supplier-form" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </PrimaryButton>
            </>
          }
        >
          <form id="supplier-form" onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />

            <Field
              label="Name"
              value={form.name ?? ''}
              onChange={(name) => setForm((f) => ({ ...f, name }))}
              maxLength={150}
              placeholder="Acme Parts"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Contact name"
                value={form.contactName ?? ''}
                onChange={(contactName) => setForm((f) => ({ ...f, contactName }))}
                required={false}
                maxLength={100}
              />
              <Field
                label="Phone"
                value={form.phone ?? ''}
                onChange={(phone) => setForm((f) => ({ ...f, phone }))}
                required={false}
                maxLength={30}
                placeholder="+91 98765 43210"
              />
            </div>

            <Field
              label="Email"
              type="email"
              value={form.email ?? ''}
              onChange={(email) => setForm((f) => ({ ...f, email }))}
              required={false}
              maxLength={255}
            />

            <Field
              label="Address"
              value={form.address ?? ''}
              onChange={(address) => setForm((f) => ({ ...f, address }))}
              required={false}
              maxLength={255}
            />

            <Textarea
              label="Notes"
              value={form.notes ?? ''}
              onChange={(notes) => setForm((f) => ({ ...f, notes }))}
              required={false}
              maxLength={2000}
            />
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
