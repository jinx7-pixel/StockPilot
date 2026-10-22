/** Category management using the authenticated business-scoped catalog API. */

import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { useAuth } from '../auth/authContext';
import {
  ConfirmDialog,
  ErrorBanner,
  Field,
  Modal,
  SecondaryButton,
  Textarea,
} from '../components/ui';
import { catalogApi, type Category } from '../lib/catalog';
import { ApiError } from '../lib/request';

interface FormState {
  name: string;
  description: string;
}

const EMPTY_FORM: FormState = { name: '', description: '' };

const primaryActionClass =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-[#06251a] shadow-sm transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]';
const secondaryActionClass =
  'inline-flex h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm font-medium text-slate-200 shadow-sm transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1120]';
const rowActionClass =
  'rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-emerald-400/[0.08] hover:text-emerald-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-1 focus-visible:ring-offset-[#101a2a]';

function displayError(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function CategoriesPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<Category | null>(null);
  const [viewing, setViewing] = useState<Category | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    catalogApi
      .listCategories()
      .then((result) => {
        if (cancelled) return;
        setCategories(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(displayError(cause, 'Could not load categories.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const filteredCategories = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return categories ?? [];
    return (categories ?? []).filter((category) =>
      category.name.toLocaleLowerCase().includes(needle),
    );
  }, [categories, search]);

  function beginReload() {
    setLoading(true);
    setError(null);
    setReloadToken((token) => token + 1);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setCreating(true);
  }

  function openEdit(category: Category) {
    setForm({ name: category.name, description: category.description ?? '' });
    setFormError(null);
    setEditing(category);
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
      setFormError('Enter a category name.');
      return;
    }

    setSaving(true);
    setFormError(null);
    setError(null);
    setNotice(null);

    const trimmedDescription = form.description.trim();
    const description = trimmedDescription === '' ? null : trimmedDescription;

    try {
      if (editing) {
        await catalogApi.updateCategory(editing.id, { name, description });
        setNotice('Category updated.');
      } else {
        await catalogApi.createCategory({
          name,
          ...(description ? { description } : {}),
        });
        setNotice('Category created.');
      }

      setCreating(false);
      setEditing(null);
      setFormError(null);
      beginReload();
    } catch (cause) {
      setFormError(displayError(cause, 'Could not save the category.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteCandidate || deleting) return;

    const category = deleteCandidate;
    setDeleting(true);
    setError(null);
    setNotice(null);

    try {
      await catalogApi.deleteCategory(category.id);
      setNotice(`Deleted “${category.name}”.`);
      setDeleteCandidate(null);
      beginReload();
    } catch (cause) {
      setError(displayError(cause, 'Could not delete the category.'));
      setDeleteCandidate(null);
    } finally {
      setDeleting(false);
    }
  }

  const hasSearch = search.trim().length > 0;
  const hasCategories = (categories?.length ?? 0) > 0;

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-emerald-300 uppercase">
            Catalogue management
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-100">Categories</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">
            Organize your inventory into clear groups so products are easier to find and manage.
          </p>
        </div>
        <button type="button" onClick={openCreate} className={primaryActionClass}>
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M10 4v12M4 10h12" />
          </svg>
          Add Category
        </button>
      </header>

      {error ? <ErrorBanner message={error} darkSurface /> : null}
      {notice ? (
        <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      <section aria-label="Category summary" className="grid grid-cols-1 gap-4 sm:max-w-sm">
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-800/90 bg-[#101a2a] p-5 shadow-[0_18px_45px_-32px_rgba(0,0,0,0.9)]">
          <div>
            <p className="text-sm font-medium text-slate-300">Total categories</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-100">
              {categories === null ? '—' : categories.length.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {loading && categories === null ? 'Loading your catalogue' : categories === null ? 'Category total unavailable' : 'In your product catalogue'}
            </p>
          </div>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-300">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
            </svg>
          </span>
        </div>
      </section>

      <section aria-label="Search categories">
        <div className="rounded-2xl border border-slate-800/90 bg-[#101a2a] p-4 shadow-[0_18px_45px_-32px_rgba(0,0,0,0.9)] sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full max-w-xl">
              <Field
                label="Search categories"
                value={search}
                onChange={setSearch}
                required={false}
                maxLength={100}
                placeholder="e.g. Fasteners"
                darkSurface
              />
            </div>
            {hasSearch ? (
              <button type="button" onClick={() => setSearch('')} className={secondaryActionClass}>
                Clear search
              </button>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-slate-500">Search by category name.</p>
        </div>
      </section>

      <section aria-label="Categories list" className="min-w-0">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-800/90 bg-[#101a2a] shadow-[0_18px_45px_-32px_rgba(0,0,0,0.9)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Category list</h2>
              <p className="mt-1 text-xs text-slate-500">Names and descriptions for your inventory groups.</p>
            </div>
            {categories ? (
              <div className="flex flex-wrap items-center gap-3">
                <span role={loading ? 'status' : undefined} className="text-xs font-medium text-slate-400">
                  {loading
                    ? 'Refreshing categories…'
                    : hasSearch
                      ? `${filteredCategories.length} of ${categories.length} categories`
                      : `${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`}
                </span>
                <button type="button" onClick={beginReload} disabled={loading} className={secondaryActionClass}>
                  Refresh
                </button>
              </div>
            ) : null}
          </div>

          {loading && categories === null ? (
            <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-14 text-sm text-slate-400">
              <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400 motion-reduce:animate-none" />
              Loading categories…
            </div>
          ) : categories === null ? (
            <div className="px-5 py-10 text-center sm:px-6">
              <p className="text-sm font-medium text-slate-200">Categories could not be loaded.</p>
              <button type="button" onClick={beginReload} className={`${secondaryActionClass} mt-4`}>
                Try again
              </button>
            </div>
          ) : !hasCategories ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <h3 className="text-base font-semibold text-slate-100">No categories yet</h3>
              <p className="max-w-sm text-sm text-slate-400">Create a category when it helps you organize and find products in your catalogue.</p>
              <button type="button" onClick={openCreate} className={primaryActionClass}>Add the first category</button>
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <h3 className="text-base font-semibold text-slate-100">No matching categories</h3>
              <p className="max-w-sm text-sm text-slate-400">Try another name or clear your search to see all categories.</p>
              <button type="button" onClick={() => setSearch('')} className={secondaryActionClass}>Clear search</button>
            </div>
          ) : (
            <>
              <div className="space-y-3 p-3 lg:hidden">
                {filteredCategories.map((category) => (
                  <article key={category.id} className="rounded-xl border border-slate-800 bg-[#0c1523] p-4">
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-semibold text-slate-100">{category.name}</h3>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-5 text-slate-300">
                        {category.description || 'No description provided.'}
                      </p>
                      <p className="mt-3 text-xs text-slate-500">Updated {formatDate(category.updatedAt)}</p>
                    </div>
                    <CategoryActions
                      category={category}
                      isOwner={isOwner}
                      onView={setViewing}
                      onEdit={openEdit}
                      onDelete={setDeleteCandidate}
                    />
                  </article>
                ))}
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <caption className="sr-only">Categories in your product catalogue</caption>
                  <thead className="bg-[#0c1523] text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    <tr>
                      <th scope="col" className="px-5 py-3 sm:px-6">Category</th>
                      <th scope="col" className="px-4 py-3">Description</th>
                      <th scope="col" className="px-4 py-3">Last updated</th>
                      <th scope="col" className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {filteredCategories.map((category) => (
                      <tr key={category.id} className="transition-colors hover:bg-white/[0.025]">
                        <th scope="row" className="max-w-56 px-5 py-4 font-semibold text-slate-100 sm:px-6">
                          <span className="break-words">{category.name}</span>
                        </th>
                        <td className="max-w-lg whitespace-pre-wrap break-words px-4 py-4 text-slate-300">
                          {category.description || <span className="text-slate-500">No description</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-slate-400">{formatDate(category.updatedAt)}</td>
                        <td className="px-4 py-4">
                          <CategoryActions
                            category={category}
                            isOwner={isOwner}
                            onView={setViewing}
                            onEdit={openEdit}
                            onDelete={setDeleteCandidate}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>

      {creating || editing ? (
        <Modal
          title={editing ? 'Edit category' : 'Add category'}
          onClose={closeForm}
          darkSurface
          footer={
            <>
              <SecondaryButton onClick={closeForm} disabled={saving} darkSurface>Cancel</SecondaryButton>
              <button type="submit" form="category-form" disabled={saving} aria-busy={saving} className={primaryActionClass}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
              </button>
            </>
          }
        >
          <form id="category-form" onSubmit={handleSubmit}>
            <fieldset disabled={saving} className="space-y-4">
              <ErrorBanner message={formError} darkSurface />
              <Field
                label="Category name"
                value={form.name}
                onChange={(name) => setForm((current) => ({ ...current, name }))}
                maxLength={100}
                placeholder="Fasteners"
                darkSurface
              />
              <Textarea
                label="Description"
                value={form.description}
                onChange={(description) => setForm((current) => ({ ...current, description }))}
                required={false}
                maxLength={2000}
                placeholder="Nuts, bolts, screws and fixings"
                darkSurface
              />
              <p className="text-xs text-slate-400">Names must be unique within your business.</p>
            </fieldset>
          </form>
        </Modal>
      ) : null}

      {viewing ? (
        <Modal title="Category details" onClose={() => setViewing(null)} darkSurface>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Name</dt>
              <dd className="mt-1 break-words text-base font-semibold text-slate-100">{viewing.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Description</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                {viewing.description || 'No description provided.'}
              </dd>
            </div>
            <div className="grid grid-cols-1 gap-4 border-t border-slate-800 pt-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Created</dt>
                <dd className="mt-1 text-sm text-slate-300">{formatDate(viewing.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Last updated</dt>
                <dd className="mt-1 text-sm text-slate-300">{formatDate(viewing.updatedAt)}</dd>
              </div>
            </div>
          </dl>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={deleteCandidate !== null}
        title="Delete category?"
        description={deleteCandidate
          ? `Delete “${deleteCandidate.name}”? Categories with products assigned to them cannot be deleted.`
          : ''}
        confirmLabel="Delete category"
        tone="danger"
        pending={deleting}
        darkSurface
        onConfirm={() => void handleDelete()}
        onCancel={() => { if (!deleting) setDeleteCandidate(null); }}
      />
    </div>
  );
}

function CategoryActions({
  category,
  isOwner,
  onView,
  onEdit,
  onDelete,
}: {
  category: Category;
  isOwner: boolean;
  onView: (category: Category) => void;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-1 border-t border-slate-800 pt-2 lg:mt-0 lg:justify-end lg:border-0 lg:pt-0">
      <button type="button" onClick={() => onView(category)} className={rowActionClass}>View</button>
      <button type="button" onClick={() => onEdit(category)} className={rowActionClass}>Edit</button>
      {isOwner ? (
        <button
          type="button"
          onClick={() => onDelete(category)}
          className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-400/[0.08] hover:text-rose-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-1 focus-visible:ring-offset-[#101a2a]"
        >
          Delete
        </button>
      ) : null}
    </div>
  );
}
