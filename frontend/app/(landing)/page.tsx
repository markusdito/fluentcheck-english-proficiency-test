import { LandingNav } from "./_components/LandingNav";
import { Hero } from "./_components/Hero";
import { HowItWorks } from "./_components/HowItWorks";
import { Rubric } from "./_components/Rubric";
import { Roles } from "./_components/Roles";
import { Examiners } from "./_components/Examiners";
import { Faq } from "./_components/Faq";
import { CtaStrip } from "./_components/CtaStrip";
import { LandingFooter } from "./_components/LandingFooter";

export default function Home() {
  return (
    // isolate: the hero / CTA washes sit at z-index -1 above this background
    <div className="relative isolate min-h-screen overflow-x-clip bg-sn-bg font-albert text-base leading-[1.55] text-sn-fg antialiased [text-rendering:optimizeLegibility] **:focus-visible:outline-offset-3! **:focus-visible:outline-sn-fg!">
      <LandingNav />
      <main id="content">
        <Hero />
        <HowItWorks />
        <Rubric />
        <Roles />
        <Examiners />
        <Faq />
        <CtaStrip />
      </main>
      <LandingFooter />
    </div>
  );
}
