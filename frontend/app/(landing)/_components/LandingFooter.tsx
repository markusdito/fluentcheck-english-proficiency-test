import { container, meta } from "./styles";

export function LandingFooter() {
  return (
    <footer className="border-t border-sn-border py-14 text-[13px] text-sn-muted">
      <div className={`${container} flex flex-wrap items-center justify-between gap-5`}>
        <span>© {new Date().getFullYear()} SpeakNusa · English speaking assessment</span>
        <span className={meta}>IDR 150,000 · paid with iPaymu</span>
      </div>
    </footer>
  );
}
