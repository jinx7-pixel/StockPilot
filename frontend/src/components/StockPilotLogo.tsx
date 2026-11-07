import './stockpilot-logo.css';

export function StockPilotLogo({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`stockpilot-logo ${className}`}>
      <img
        className="stockpilot-logo-image"
        src="/images/stockpilot-bloom-640.webp"
        width={29}
        height={29}
        alt=""
        decoding="async"
        draggable={false}
      />
    </span>
  );
}
