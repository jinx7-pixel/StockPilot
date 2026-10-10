/**
 * Component tests for the shared UI primitives.
 *
 * These exist because the accessibility defects this milestone fixed were all
 * invisible to the compiler and to the existing transport tests: a missing focus
 * trap, an id derived from label text, a `role="status"` that was not there.
 * They can only be caught by asserting on rendered, accessible behaviour.
 *
 * The environment is `jsdom` (see `vitest.config.ts`); the transport suites stay
 * in `node`.
 */

import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  Badge,
  Breadcrumbs,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  PageHeader,
  Select,
  Spinner,
  SubmitButton,
  type DataTableColumn,
} from './ui';

// ---------------------------------------------------------------------------
// Field — labels, ids, error association
// ---------------------------------------------------------------------------

describe('Field', () => {
  it('associates its label with the input', () => {
    render(<Field label="Quantity" value="10" onChange={() => undefined} />);

    const input = screen.getByLabelText('Quantity');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('10');
  });

  it('gives two fields with the same label unique ids', async () => {
    // The old implementation derived the id from the label text, so two
    // "Quantity" fields on one page produced duplicate DOM ids and the second
    // label pointed at the first input.
    render(
      <>
        <Field label="Quantity" value="10" onChange={() => undefined} />
        <Field label="Quantity" value="20" onChange={() => undefined} />
      </>,
    );

    const inputs = screen.getAllByLabelText('Quantity');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.id).not.toBe(inputs[1]!.id);
    expect(inputs[0]).toHaveValue('10');
    expect(inputs[1]).toHaveValue('20');
  });

  it('marks an invalid field and links the message through aria-describedby', () => {
    render(
      <Field
        label="Quantity"
        value="0"
        onChange={() => undefined}
        error="Quantity must be greater than zero."
      />,
    );

    const input = screen.getByLabelText('Quantity');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const message = screen.getByRole('alert');
    expect(message).toHaveTextContent('Quantity must be greater than zero.');

    // The describedby must actually reference the rendered nodes. Checked by
    // splitting on whitespace and resolving each id — the previous version
    // concatenated the ids and fell back to `input`, so it could never fail.
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toContain(message.id);

    const referenced = describedBy!.split(/\s+/).filter(Boolean);
    expect(referenced).toHaveLength(1);
    for (const id of referenced) {
      const node = document.getElementById(id);
      expect(node).not.toBeNull();
      expect(node).toHaveTextContent('Quantity must be greater than zero.');
    }
  });

  it('links both hint and error when both are present', () => {
    render(
      <Field
        label="Quantity"
        value="0"
        onChange={() => undefined}
        hint="The engine suggested 25."
        error="Quantity must be greater than zero."
      />,
    );

    const input = screen.getByLabelText('Quantity');
    const ids = input.getAttribute('aria-describedby')!.split(/\s+/).filter(Boolean);

    // Error first so it is announced before the advisory hint.
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0]!)).toHaveTextContent('Quantity must be greater than zero.');
    expect(document.getElementById(ids[1]!)).toHaveTextContent('The engine suggested 25.');
  });

  it('does not mark the field invalid when there is no error', () => {
    render(<Field label="Quantity" value="10" onChange={() => undefined} />);

    expect(screen.getByLabelText('Quantity')).not.toHaveAttribute('aria-invalid');
  });

  it('links a hint through aria-describedby without marking it invalid', () => {
    render(
      <Field
        label="Quantity"
        value="10"
        onChange={() => undefined}
        hint="The engine suggested 25."
      />,
    );

    const input = screen.getByLabelText('Quantity');
    expect(input).toHaveAccessibleDescription('The engine suggested 25.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('reports typing through onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Field label="Quantity" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText('Quantity'), '7');

    expect(onChange).toHaveBeenCalledWith('7');
  });

  it('marks optional fields without a required attribute', () => {
    render(<Field label="Notes" value="" onChange={() => undefined} required={false} />);

    const input = screen.getByLabelText(/Notes/);
    expect(input).not.toBeRequired();
  });
});

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

describe('Select', () => {
  it('associates its label and exposes the options', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Select
        label="Status"
        value="draft"
        onChange={onChange}
        options={[
          { value: 'draft', label: 'Draft' },
          { value: 'ordered', label: 'Ordered' },
        ]}
      />,
    );

    const select = screen.getByLabelText('Status');
    expect(within(select).getByRole('option', { name: 'Draft' })).toBeInTheDocument();

    await user.selectOptions(select, 'ordered');
    expect(onChange).toHaveBeenCalledWith('ordered');
  });

  it('carries an error the same way Field does', () => {
    render(
      <Select
        label="Status"
        value=""
        onChange={() => undefined}
        error="Choose a supplier."
        options={[]}
      />,
    );

    expect(screen.getByLabelText('Status')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a supplier.');
  });
});

// ---------------------------------------------------------------------------
// Modal — focus management
// ---------------------------------------------------------------------------

describe('Modal', () => {
  /** A trigger plus dialog, so focus restoration has something to return to. */
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        {open ? (
          <Modal title="Create draft purchase order" onClose={() => setOpen(false)}>
            <button type="button">First</button>
            <button type="button">Second</button>
          </Modal>
        ) : null}
      </>
    );
  }

  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveAccessibleName('Create draft purchase order');
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    const dialog = screen.getByRole('dialog');
    const trigger = screen.getByRole('button', { name: 'Open dialog' });

    // Focus must never escape to the page behind, however many times Tab is
    // pressed. The trigger sits *before* the dialog in the DOM, so reaching it
    // would mean the trap had failed.
    for (let step = 0; step < 8; step += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect(document.activeElement).not.toBe(trigger);
    }
  });

  it('wraps from the last control back to the first', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    const dialog = screen.getByRole('dialog');

    // `userEvent.tab()` performs its own focus navigation, so the wrap is driven
    // through the component's own keydown handler here. That is the behaviour a
    // browser's Tab key actually invokes.
    const last = within(dialog).getByRole('button', { name: 'Second' });
    const first = within(dialog).getByRole('button', { name: 'Close' });

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();

    // And backwards from the first, so neither direction leaks to the page behind.
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restores focus to the trigger when it closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveFocus();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

    expect(trigger).toHaveFocus();
  });

  it('locks background scroll while open and restores it afterwards', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(document.body.style.overflow).toBe('');

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('does not let a hidden control enter the focus trap', () => {
    // `hidden`, `aria-hidden` and inline `display:none` all remove an element
    // from the tab order. The trap must honour that, or Tab lands on a control
    // the user cannot see.
    //
    // The `[hidden]` **ancestor** case is placed last on purpose. The trap only
    // intervenes at the first and last entries of its focusable list, so a hidden
    // control sitting in the middle is unobservable — including it or excluding it
    // yields the same first/last pair, and the assertions below would pass either
    // way. Put last, exclusion becomes decisive: the filter working makes "Visible
    // two" the final entry, while a deleted filter lets the buried control claim it.
    render(
      <Modal title="Form" onClose={() => undefined}>
        <button type="button">Visible one</button>
        <button type="button" hidden>
          Hidden attribute
        </button>
        <button type="button" aria-hidden="true">
          Aria hidden
        </button>
        <button type="button" style={{ display: 'none' }}>
          Display none
        </button>
        <button type="button">Visible two</button>
        <div hidden>
          <button type="button">Hidden ancestor</button>
        </div>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');

    // Collect every button by DOM text rather than by role+name: a hidden
    // element is excluded from the accessibility tree, so `getByRole` cannot find
    // it at all. That exclusion is exactly what we want to *bypass* here — the
    // point is to assert the hidden nodes are present but unfocusable.
    const allButtons = Array.from(dialog.querySelectorAll('button'));
    const byText = (text: string) => {
      const found = allButtons.filter((button) => button.textContent === text);
      expect(found).toHaveLength(1);
      return found[0]!;
    };

    const visible = [byText('Visible one'), byText('Visible two')];
    const hidden = [
      byText('Hidden attribute'),
      byText('Aria hidden'),
      byText('Display none'),
      byText('Hidden ancestor'),
    ];
    // The dialog's own close control is the first focusable node.
    const close = byText('✕');
    const buried = hidden[3]!;

    // The buried control really is the final child and really carries no marker of
    // its own, so it can only be excluded by walking its ancestors.
    expect(buried.parentElement?.hasAttribute('hidden')).toBe(true);
    expect(buried.hasAttribute('hidden')).toBe(false);
    expect(buried.getAttribute('aria-hidden')).toBeNull();

    // Wrapping forward from the last visible control lands on Close. This is the
    // decisive assertion: remove the `[hidden]` ancestor filter and "Visible two"
    // stops being the last entry, so the trap does not intervene and focus stays
    // put — failing the expectation below.
    visible[1]!.focus();
    fireEvent.keyDown(visible[1]!, { key: 'Tab' });
    expect(close).toHaveFocus();

    // Backwards from the first: the last visible control, again not the buried one.
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(visible[1]).toHaveFocus();

    // None of the hidden controls is ever focused during that cycle.
    for (const element of hidden) {
      expect(dialog.contains(element)).toBe(true);
      expect(element).not.toHaveFocus();
    }
    expect(visible[0]!.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it('excludes a control whose ancestor, not itself, is aria-hidden', () => {
    // Regression guard.
    //
    // `aria-hidden` used to be checked on the element alone, so a control with no
    // hidden attribute of its own — sitting inside an `aria-hidden` wrapper —
    // still entered the focusable list.
    //
    // The wrapper is placed **last** deliberately. The trap only intervenes at the
    // first and last entries of its focusable list, so a hidden control in the
    // middle of the dialog is unobservable. Placed last, exclusion becomes
    // decisive: correct filtering makes "Last visible" the final entry, while a
    // missing filter makes the buried control claim that position.
    render(
      <Modal title="Form" onClose={() => undefined}>
        <button type="button">First visible</button>
        <button type="button">Last visible</button>
        <div aria-hidden="true">
          <button type="button">Buried control</button>
        </div>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    const buttons = Array.from(dialog.querySelectorAll('button'));
    const byText = (text: string) => {
      const found = buttons.filter((button) => button.textContent === text);
      expect(found).toHaveLength(1);
      return found[0]!;
    };

    const close = byText('✕');
    const last = byText('Last visible');
    const buried = byText('Buried control');

    // Sanity: the control is in the DOM and carries no marker of its own, so it can
    // only be excluded by walking its ancestors.
    expect(dialog.contains(buried)).toBe(true);
    expect(buried.hasAttribute('hidden')).toBe(false);
    expect(buried.getAttribute('aria-hidden')).toBeNull();
    expect(byText('First visible')).toBeInTheDocument();

    // Forward from the last *visible* control must wrap to Close. If the buried
    // control had been included, this control would not be the last entry, so the
    // trap would not intervene and focus would not move.
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();
    expect(buried).not.toHaveFocus();

    // Backwards from the first must land on the last visible control, not the
    // buried one — the second decisive assertion.
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    expect(buried).not.toHaveFocus();
  });

  it('keeps scroll locked until the last overlapping dialog closes', async () => {
    // Two overlapping dialogs: the inner one must neither unlock the body on its
    // own, nor leave it locked once both have closed.
    function Nested() {
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOuter(true)}>
            Open outer
          </button>
          {outer ? (
            <Modal title="Outer" onClose={() => setOuter(false)}>
              <button type="button" onClick={() => setInner(true)}>
                Open inner
              </button>
              {inner ? <Modal title="Inner" onClose={() => setInner(false)}>Inner body</Modal> : null}
            </Modal>
          ) : null}
        </>
      );
    }

    const user = userEvent.setup();
    render(<Nested />);
    expect(document.body.style.overflow).toBe('');

    await user.click(screen.getByRole('button', { name: 'Open outer' }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(screen.getByRole('button', { name: 'Open inner' }));
    expect(document.body.style.overflow).toBe('hidden');

    // Closing only the inner dialog must leave the outer one in charge of the lock.
    const innerDialog = screen.getByRole('dialog', { name: 'Inner' });
    await user.click(within(innerDialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Inner' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    // Once the outer closes too, the page must be usable again.
    const outerDialog = screen.getByRole('dialog', { name: 'Outer' });
    await user.click(within(outerDialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });
});

// ---------------------------------------------------------------------------
// ConfirmDialog
// ---------------------------------------------------------------------------

describe('ConfirmDialog', () => {
  it('asks the question and reports the answer', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Retire this product?"
        description="It stays in the catalog but is marked inactive."
        confirmLabel="Retire"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Retire this product?');

    await user.click(screen.getByRole('button', { name: 'Retire' }));
    expect(onConfirm).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Retire?"
        description="…"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses every dismissal route while pending', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        pending
        title="Retire this product?"
        description="It stays in the catalog but is marked inactive."
        confirmLabel="Retire"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole('dialog');

    // The component promises that a pending confirmation cannot be dismissed,
    // because the work it started may still complete. Escape is one route.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    // Both footer actions are frozen for the same reason.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Working…' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(within(dialog).getByRole('button', { name: 'Working…' }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the pending label and freezes actions, then restores them', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    const { rerender } = render(
      <ConfirmDialog
        open
        pending={false}
        title="Retire?"
        description="…"
        confirmLabel="Retire"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Retire' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();

    rerender(
      <ConfirmDialog
        open
        pending
        title="Retire?"
        description="…"
        confirmLabel="Retire"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // The busy label replaces the idle one, so the state is not conveyed by the
    // disabled styling alone.
    expect(within(dialog).queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();

    // Once the work settles, dismissal is permitted again.
    rerender(
      <ConfirmDialog
        open
        pending={false}
        title="Retire?"
        description="…"
        confirmLabel="Retire"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(within(dialog).getByRole('button', { name: 'Retire' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// DataTable — the four states
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  name: string;
  onHand: number;
}

const COLUMNS: Array<DataTableColumn<Row>> = [
  { key: 'name', header: 'Product', render: (row) => row.name },
  { key: 'onHand', header: 'On hand', align: 'right', render: (row) => row.onHand },
];

const ROWS: Row[] = [
  { id: '1', name: 'Cable', onHand: 10 },
  { id: '2', name: 'Mouse', onHand: 4 },
];

describe('DataTable', () => {
  it('renders rows with a caption and column headers', () => {
    render(<DataTable caption="Inventory on hand" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);

    expect(screen.getByRole('table', { name: 'Inventory on hand' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Product' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Cable' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '10' })).toBeInTheDocument();
  });

  it('announces the loading state', () => {
    render(<DataTable caption="x" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} loading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the empty state with no rows', () => {
    render(
      <DataTable
        caption="x"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        empty={{ title: 'No products match', description: 'Try clearing a filter.' }}
      />,
    );

    expect(screen.getByText('No products match')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the error state and offers a retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <DataTable
        caption="x"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        error="Could not load inventory."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load inventory.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('prefers loading over a stale error or stale rows', () => {
    render(
      <DataTable
        caption="x"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        loading
        error="old failure"
      />,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Feedback primitives
// ---------------------------------------------------------------------------

describe('feedback primitives', () => {
  it('announces errors with role="alert"', () => {
    render(<ErrorBanner message="Something went wrong" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
  });

  it('renders nothing when there is no error', () => {
    const { container } = render(<ErrorBanner message={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('announces loading politely', () => {
    render(<Spinner label="Loading intelligence…" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Loading intelligence…');
  });

  it('Badge always carries its meaning as text, never colour alone', () => {
    render(<Badge tone="danger">Out of stock</Badge>);

    // The label is the accessible content; the tone is decoration on top of it.
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
  });

  it('EmptyState presents a heading and supporting text', () => {
    render(<EmptyState title="Nothing here" description="Try adjusting filters." />);

    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByText('Try adjusting filters.')).toBeInTheDocument();
  });

  it('PageHeader renders an h1 for the page title', () => {
    render(<PageHeader title="Inventory" description="Current positions" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Inventory' })).toBeInTheDocument();
  });
});

describe('SubmitButton', () => {
  /** Renders inside a form and counts real submissions. */
  function FormHarness({ pending }: { pending: boolean }) {
    const [submitCount, setSubmitCount] = useState(0);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitCount((count) => count + 1);
        }}
      >
        <SubmitButton pending={pending} label="Create order" />
        <p>submitted: {submitCount}</p>
      </form>
    );
  }

  it('submits when idle', async () => {
    const user = userEvent.setup();
    render(<FormHarness pending={false} />);

    const button = screen.getByRole('button', { name: 'Create order' });
    expect(button).toBeEnabled();
    // aria-busy is a string-valued attribute, so "false" is the correct idle
    // state — it is explicitly not busy, rather than merely absent.
    expect(button).toHaveAttribute('aria-busy', 'false');

    await user.click(button);
    expect(screen.getByText('submitted: 1')).toBeInTheDocument();
  });

  it('submits nothing while pending, however hard it is clicked', async () => {
    const user = userEvent.setup();
    render(<FormHarness pending />);

    const button = screen.getByRole('button', { name: 'Please wait…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    // A disabled button is what stops a double-click becoming two submissions;
    // clicking must therefore produce no submission at all.
    await user.click(button);
    await user.dblClick(button);
    expect(screen.getByText('submitted: 0')).toBeInTheDocument();
  });

  it('relays the label only through text, not colour', async () => {
    // The pending state is announced by the label change and aria-busy, so it is
    // not communicated by the disabled styling alone.
    const { rerender } = render(<SubmitButton pending={false} label="Create order" />);
    expect(screen.getByRole('button', { name: 'Create order' })).toBeInTheDocument();

    rerender(<SubmitButton pending label="Create order" />);
    expect(
      screen.queryByRole('button', { name: 'Create order' }),
      'the busy label replaces the idle one',
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Breadcrumbs — naming, link targets, current-page semantics
// ---------------------------------------------------------------------------

describe('Breadcrumbs', () => {
  /**
   * `Breadcrumbs` links through React Router, so every render needs a router.
   */
  function renderCrumbs(items: Parameters<typeof Breadcrumbs>[0]['items']) {
    return render(
      <MemoryRouter>
        <Breadcrumbs items={items} />
      </MemoryRouter>,
    );
  }

  it('exposes a navigation landmark named "Breadcrumb"', () => {
    renderCrumbs([{ label: 'Inventory', to: '/app/inventory' }, { label: 'Cable' }]);

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toBeInTheDocument();
    // The name is what distinguishes this landmark from the workspace
    // navigation; without it a detail page has two anonymous landmarks.
    expect(nav.tagName).toBe('NAV');
  });

  it('links every ancestor to its own route', () => {
    renderCrumbs([{ label: 'Inventory', to: '/app/inventory' }, { label: 'Cable' }]);

    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveAttribute(
      'href',
      '/app/inventory',
    );
  });

  it('marks the final entry as the current page and does not link it', () => {
    renderCrumbs([{ label: 'Inventory', to: '/app/inventory' }, { label: 'Cable' }]);

    // `aria-current` is what distinguishes "you are here" from a trail that
    // simply stops.
    const current = screen.getByRole('navigation', { name: 'Breadcrumb' }).querySelector(
      '[aria-current="page"]',
    );
    expect(current).toHaveTextContent('Cable');
    // A link to the page you are already on is a no-op that still announces as
    // a destination.
    expect(screen.queryByRole('link', { name: 'Cable' })).not.toBeInTheDocument();
  });

  it('renders exactly one current-page entry, however long the trail', () => {
    renderCrumbs([
      { label: 'Operations', to: '/app' },
      { label: 'Inventory', to: '/app/inventory' },
      { label: 'Cable' },
    ]);

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    // Both ancestors stay navigable.
    expect(screen.getByRole('link', { name: 'Operations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
  });

  it('keeps the separator out of the accessibility tree', () => {
    const { container } = renderCrumbs([
      { label: 'Inventory', to: '/app/inventory' },
      { label: 'Cable' },
    ]);

    const separators = container.querySelectorAll('[aria-hidden="true"]');
    // One separator between two entries, and none trailing the last one.
    expect(separators).toHaveLength(1);

    // The ordered list is the structural contract of the pattern.
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(list.querySelectorAll(':scope > li')).toHaveLength(2);
  });

  it('renders inside PageHeader above the title', () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Cable"
          breadcrumbs={
            <Breadcrumbs items={[{ label: 'Inventory', to: '/app/inventory' }, { label: 'Cable' }]} />
          }
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    // The page still has exactly one h1; a breadcrumb must not become a heading.
    expect(screen.getByRole('heading', { level: 1, name: 'Cable' })).toBeInTheDocument();
  });

  it('leaves PageHeader untouched when no breadcrumbs are supplied', () => {
    render(<PageHeader title="Inventory" description="Current positions" />);

    // Regression guard: the slot is optional and must not render an empty nav.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Inventory' })).toBeInTheDocument();
  });
});