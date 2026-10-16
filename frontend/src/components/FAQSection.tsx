import { useId, useState } from 'react';

type FAQItem = {
  question: string;
  answer: string;
};

const FAQ_ITEMS: FAQItem[] = [
  {
    question: 'What is StockPilot?',
    answer:
      'StockPilot is an inventory management experience designed to help businesses organize stock information, understand stock levels, and make more informed inventory decisions.',
  },
  {
    question: 'Who is StockPilot designed for?',
    answer:
      'It is intended for businesses that need a clearer view of their products, available stock, and inventory priorities.',
  },
  {
    question: 'How does StockPilot help with low-stock items?',
    answer:
      'Stock levels and reorder information can help you identify products that may need attention. You can review those items and decide what to replenish.',
  },
  {
    question: 'Can I see which products need attention?',
    answer:
      'StockPilot’s inventory views bring important stock information together so you can identify and review products that need attention.',
  },
  {
    question: 'Does StockPilot automatically place purchase orders?',
    answer:
      'No. StockPilot does not automatically place purchase orders. A reviewed recommendation can be turned into a draft purchase order; a user reviews it and handles the final ordering action.',
  },
  {
    question: 'Is the inventory preview on the landing page live data?',
    answer:
      'No. The landing-page inventory visuals are static illustrations with sample values. They are examples, not live inventory data.',
  },
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const accordionId = useId().replace(/:/g, '');

  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="relative isolate overflow-hidden bg-navy-800/20 py-20 font-landing sm:py-24 lg:py-28"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 top-8 h-80 w-80 rounded-full bg-accent-500/[0.035] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-5xl min-w-0 px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent-400">
            <span aria-hidden="true" className="h-px w-6 bg-accent-400/80" />
            FAQ
          </p>
          <h2
            id="faq-heading"
            className="mt-4 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl"
          >
            Frequently Asked Questions
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
            Straightforward answers about StockPilot, its inventory views, and the examples shown
            on this page.
          </p>
        </header>

        <div className="mt-10 border-y border-slate-700/70 sm:mt-12">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndex === index;
            const questionId = `faq-question-${accordionId}-${index + 1}`;
            const answerId = `faq-answer-${accordionId}-${index + 1}`;

            return (
              <article key={item.question} className="border-b border-slate-700/60 last:border-b-0">
                <h3>
                  <button
                    id={questionId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => setOpenIndex((current) => (current === index ? null : index))}
                    className="group flex min-h-16 w-full min-w-0 items-center justify-between gap-5 py-5 text-left sm:min-h-[4.75rem] sm:py-6"
                  >
                    <span className="min-w-0 text-base font-semibold leading-snug tracking-tight text-slate-100 transition-colors group-hover:text-white sm:text-lg motion-reduce:transition-none">
                      {item.question}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors duration-200 motion-reduce:transition-none ${
                        isOpen
                          ? 'border-accent-400/35 bg-accent-500/[0.08] text-accent-400'
                          : 'border-slate-700 bg-navy-900/50 text-slate-400 group-hover:border-slate-500 group-hover:text-slate-200'
                      }`}
                    >
                      <svg
                        viewBox="0 0 20 20"
                        className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m5 7.5 5 5 5-5" />
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
                    isOpen ? 'grid-rows-[1fr] pb-5 opacity-100 sm:pb-6' : 'grid-rows-[0fr] pb-0 opacity-0'
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    <p className="max-w-3xl pr-12 text-sm leading-relaxed text-slate-400 sm:pl-1 sm:text-[15px] sm:leading-7">
                      {item.answer}
                    </p>
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
