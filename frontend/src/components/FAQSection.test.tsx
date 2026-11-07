import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FAQSection } from './FAQSection';

const FAQ_CONTENT = [
  {
    question: 'What is StockPilot?',
    answer:
      'StockPilot helps you record stock movements, check what’s on hand, and decide when to replenish.',
  },
  {
    question: 'Who is StockPilot designed for?',
    answer:
      'It’s built for teams that manage product inventory and need a shared view of quantities, movements, and reorder priorities.',
  },
  {
    question: 'How does StockPilot help with low-stock items?',
    answer:
      'It compares what’s on hand with each product’s reorder point so you can see what needs replenishing.',
  },
  {
    question: 'Can I see which products need attention?',
    answer:
      'Yes. Use the stock risk view to review low-stock and out-of-stock products, then check the reorder view to decide what to replenish first.',
  },
  {
    question: 'Does StockPilot automatically place purchase orders?',
    answer:
      'No. You can turn a reviewed recommendation into a draft purchase order. Your team decides when to place it.',
  },
  {
    question: 'Is the inventory preview on the landing page live data?',
    answer:
      'The walkthrough and inventory previews use sample data. Your own stock figures appear in your workspace.',
  },
];

describe('FAQSection', () => {
  it('provides a section anchor and renders all requested questions and grounded answers', () => {
    const { container } = render(<FAQSection />);

    expect(container.querySelector('section#faq')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Frequently Asked Questions' }),
    ).toBeInTheDocument();

    for (const { question, answer } of FAQ_CONTENT) {
      expect(screen.getByRole('button', { name: question })).toBeInTheDocument();
      expect(container.textContent).toContain(answer);
    }
  });

  it('opens and closes answers with keyboard controls and exposes accordion state accessibly', async () => {
    const user = userEvent.setup();
    render(<FAQSection />);

    const { question, answer } = FAQ_CONTENT[0];
    const button = screen.getByRole('button', { name: question });
    const answerId = button.getAttribute('aria-controls');

    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(answerId).toBeTruthy();
    expect(document.getElementById(answerId!)).toHaveAttribute('aria-hidden', 'true');
    expect(document.getElementById(answerId!)).toHaveClass(
      'motion-reduce:transition-none',
    );

    button.focus();
    await user.keyboard('{Enter}');

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const answerRegion = screen.getByRole('region', { name: question });
    expect(answerRegion).toHaveAttribute('id', answerId);
    expect(answerRegion).toHaveAttribute('aria-hidden', 'false');
    expect(within(answerRegion).getByText(answer)).toBeInTheDocument();

    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(answerId!)).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens a new answer and closes the previously open one', async () => {
    const user = userEvent.setup();
    render(<FAQSection />);

    const first = screen.getByRole('button', { name: FAQ_CONTENT[0].question });
    const second = screen.getByRole('button', { name: FAQ_CONTENT[1].question });

    await user.click(first);
    await user.click(second);

    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: FAQ_CONTENT[1].question })).toBeInTheDocument();
  });
});
