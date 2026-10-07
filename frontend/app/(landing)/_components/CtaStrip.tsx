import Link from "next/link";
import { container, h2, lead, section } from "./styles";

export function CtaStrip() {
  return (
    <section
      className={`${section} relative text-center before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:sn-wash-cta`}
    >
      <div className={`${container} max-w-[640px]`}>
        <h2 className={`${h2} mx-auto mb-5`}>Start with a device check.</h2>
        <p className={`${lead} mx-auto mb-8`}>
          The full session takes about twenty minutes, setup included.
        </p>
        <Link
          href="/signup"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-sn-fg bg-sn-fg px-6 py-3 text-[15px] font-medium tracking-[-0.005em] text-sn-surface transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:border-[color-mix(in_oklch,var(--color-sn-fg)_88%,black)] hover:bg-[color-mix(in_oklch,var(--color-sn-fg)_88%,black)] active:translate-y-0 active:duration-75"
        >
          Start your assessment
        </Link>
      </div>
    </section>
  );
}
