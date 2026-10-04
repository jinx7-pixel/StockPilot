/**
 * Category management.
 *
 * Deletion is owner-only (the API enforces this and returns 403 for staff); the
 * button is hidden for staff so the UI matches the server's rules rather than
 * letting a user discover them by clicking.
 */

import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '../auth/authContext';
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
  Spinner,
  Textarea,
} from '../components/ui';
import { catalogApi, type Category } from '../lib/catalog';
import { ApiError } from '../lib/request';

interface FormState {
  name: string;
  description: string;
}

const EMPTY_FORM: FormState = { name: '', description: '' };

export function CategoriesPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * Loading is kicked off by the interaction that caused it, never from inside
   * the effect: state updates in an effect body would cascade an extra render on
   * every mount. The effect itself only resolves a promise and sets state in its
   * callbacks, which is asynchronous.
   */
  useEffect(() => {
    let cancelled = false;

    catalogApi
      .listCategories()
      .then(({ data }) => {
        if (cancelled) return;
        setCategories(data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : 'Could not load categories.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = () => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  };

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

    // An empty description is sent as `null` so the API clears the field.
    const description = form.description.trim() === '' ? null : form.description.trim();

    try {
      if (editing) {
        await catalogApi.updateCategory(editing.id, {
          name: form.name.trim(),
          description: description ?? undefined,
        });
        setNotice('Category updated.');
      } else {
        await catalogApi.createCategory({
          name: form.name.trim(),
          ...(description ? { description } : {}),
        });
        setNotice('Category created.');
      }

      closeDialog();
      reload();
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : 'Could not save the category.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(category: Category) {
    const confirmed = window.confirm(
      `Delete the category "${category.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    setError(null);
    setNotice(null);

    try {
      await catalogApi.deleteCategory(category.id);
      setNotice(`Deleted "${category.name}".`);
      reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not delete the category.');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="Group your products so the catalog stays easy to scan."
        actions={<PrimaryButton onClick={openCreate}>New category</PrimaryButton>}
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      ) : null}

      <Card>
        {loading ? (
          <Spinner label="Loading categoriesâ€¦" />
        ) : categories === null ? null : categories.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description="Categories are optional â€” a product can exist without one. Create one only if it helps you organise a large catalog."
            action={<PrimaryButton onClick={openCreate}>Create the first category</PrimaryButton>}
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {categories.map((category) => (
              <li
                key={category.id}
                className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{category.name}</p>
                  {category.description ? (
                    <p className="mt-0.5 truncate text-sm text-slate-500">{category.description}</p>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  <SecondaryButton onClick={() => openEdit(category)}>Edit</SecondaryButton>
                  {isOwner ? (
                    <DangerButton onClick={() => void handleDelete(category)}>Delete</DangerButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!isOwner ? (
        <p className="text-xs text-slate-500">
          Staff can create and edit categories. Only an owner can delete one.
        </p>
      ) : null}

      {creating || editing ? (
        <Modal
          title={editing ? 'Edit category' : 'New category'}
          onClose={closeDialog}
          footer={
            <>
              <SecondaryButton onClick={closeDialog} disabled={saving}>
                Cancel
              </SecondaryButton>
              <PrimaryButton type="submit" form="category-form" disabled={saving}>
                {saving ? 'Savingâ€¦' : 'Save'}
              </PrimaryButton>
            </>
          }
        >
          <form id="category-form" onSubmit={handleSubmit} className="space-y-4">
            <ErrorBanner message={formError} />

            <Field
              label="Name"
              value={form.name}
              onChange={(name) => setForm((f) => ({ ...f, name }))}
              maxLength={100}
              placeholder="Fasteners"
            />

            <Textarea
              label="Description"
              value={form.description}
              onChange={(description) => setForm((f) => ({ ...f, description }))}
              maxLength={2000}
              placeholder="Nuts, bolts, screws and fixings"
            />
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

