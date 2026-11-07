import { useId, useState } from 'react';
import './faq-showcase.css';

const FAQ_ITEMS = [
  {
    question: 'What is StockPilot?',
    answer: 'StockPilot helps you record stock movements, check what’s on hand, and decide when to replenish.',
  },
  {
    question: 'Who is StockPilot designed for?',
    answer: 'It’s built for teams that manage product inventory and need a shared view of quantities, movements, and reorder priorities.',
  },
  {
    question: 'How does StockPilot help with low-stock items?',
    answer: 'It compares what’s on hand with each product’s reorder point so you can see what needs replenishing.',
  },
  {
    question: 'Can I see which products need attention?',
    answer: 'Yes. Use the stock risk view to review low-stock and out-of-stock products, then check the reorder view to decide what to replenish first.',
  },
  {
    question: 'Does StockPilot automatically place purchase orders?',
    answer: 'No. You can turn a reviewed recommendation into a draft purchase order. Your team decides when to place it.',
  },
  {
    question: 'Is the inventory preview on the landing page live data?',
    answer: 'The walkthrough and inventory previews use sample data. Your own stock figures appear in your workspace.',
  },
] as const;

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const accordionId = useId();

  return (
    <section id="faq" aria-labelledby="faq-heading" className="landing-faq">
      <div className="landing-faq-layout">
        <header className="landing-faq-header">
          <p className="landing-faq-label"><span aria-hidden="true">04</span> FAQ</p>
          <h2 id="faq-heading">
            Frequently Asked <span>Questions</span>
          </h2>
          <p className="landing-faq-intro">
            How StockPilot handles stock levels, reorder alerts, and purchase orders.
          </p>
          <a href="#how-it-works" className="landing-faq-link">
            Explore the walkthrough <span aria-hidden="true">↗</span>
          </a>
        </header>

        <div className="landing-faq-accordion">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndex === index;
            const questionId = `${accordionId}-question-${index}`;
            const answerId = `${accordionId}-answer-${index}`;

            return (
              <article key={item.question} className="landing-faq-item" data-open={isOpen}>
                <h3>
                  <button
                    id={questionId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => setOpenIndex(current => current === index ? null : index)}
                    className="landing-faq-question"
                  >
                    {item.question}
                    <span className="landing-faq-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M4 8h8" />
                        <path d="M8 4v8" className="landing-faq-icon-vertical" />
                      </svg>
                    </span>
                  </button>
                </h3>

                <div
                  id={answerId}
                  role="region"
                  aria-labelledby={questionId}
                  aria-hidden={!isOpen}
                  className={`grid min-w-0 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    <p className="landing-faq-answer">{item.answer}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default FAQSection;
