"use client";

import { useState } from "react";
import { h2, section, sectionStack, titleGrid } from "./styles";

const items = [
  {
    id: "devices",
    q: "What do I need before I start?",
    a: "A browser, a webcam, and a working microphone in a quiet room. The device check shows your camera preview and microphone level before any prompt opens. Nothing to install.",
  },
  {
    id: "time",
    q: "How long is a session?",
    a: "About fifteen to twenty minutes, setup included. Each answer comes with its own preparation time before a timed recording window.",
  },
  {
    id: "parts",
    q: "What are the three parts?",
    a: "Part 1 Interview, Part 2 Long turn, and Part 3 Discussion. One question from each part per submission, always from the same set. Prompt text, timing, and prompt audio are snapshotted at delivery, so later question bank edits never rewrite a past session.",
  },
  {
    id: "again",
    q: "Can I record an answer again?",
    a: "Yes. You can re-record a part while the session is open, and only the final take is kept. The server verifies size, duration, and type before an answer counts toward the submission.",
  },
  {
    id: "fee",
    q: "How much does it cost?",
    a: "IDR 150,000 per assessment, paid through iPaymu. You only pay once your answers are recorded and verified.",
  },
  {
    id: "score",
    q: "How is my speaking scored?",
    a: "Four criteria scored separately: pronunciation, fluency, vocabulary, and grammar. Each takes half band values from 1.0 to 6.0. The overall for one answer is the arithmetic mean of the four criteria.",
  },
  {
    id: "examiners",
    q: "Why are there two examiners?",
    a: "Both work independently and never see each other's scores. Your report shows the combined band alongside both examiners' comments. A completed scoring is final and cannot be edited.",
  },
  {
    id: "after",
    q: "What happens after I record?",
    a: "Verified recordings move to scoring once payment is settled or waived. Your submission moves from awaiting payment to paid, scoring, and scored, and your report and certificate open when scoring completes.",
  },
  {
    id: "access",
    q: "Who can see my recordings?",
    a: "Only your assigned examiners and administrators, through short-lived signed playback links. Retention holds and purge requests govern how long evidence is kept.",
  },
];

export function Faq() {
  const [openId, setOpenId] = useState<string | null>(items[0].id);
  return (
    <section className={section} id="faq">
      <div className={sectionStack}>
        <div className={titleGrid}>
          <h2 className={h2}>Questions, answered.</h2>
        </div>
        <div className="border-t border-sn-border">
          {items.map((it) => {
            const open = openId === it.id;
            return (
              <div key={it.id} className="border-b border-sn-border">
                <h3>
                  <button
                    className="flex min-h-16 w-full cursor-pointer items-center justify-between gap-5 px-1 py-5 text-left text-lg font-semibold tracking-[-0.005em] transition-colors hover:bg-sn-fg/6"
                    type="button"
                    id={`faq-btn-${it.id}`}
                    aria-expanded={open}
                    aria-controls={`faq-panel-${it.id}`}
                    onClick={() => setOpenId(open ? null : it.id)}
                  >
                    <span>{it.q}</span>
                    <svg className={`size-5 flex-none transition-transform duration-300 ease-spring ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 8l6 6 6-6" />
                    </svg>
                  </button>
                </h3>
                <div
                  className={`grid max-w-[68ch] transition-[grid-template-rows,visibility] duration-[420ms] ease-spring ${open ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr] delay-[0s,420ms]"}`}
                  id={`faq-panel-${it.id}`}
                  role="region"
                  aria-labelledby={`faq-btn-${it.id}`}
                >
                  <p
                    className={`min-h-0 overflow-hidden px-1 text-[15px] text-sn-muted transition-[opacity,transform] duration-300 ease-spring ${open ? "translate-y-0 pb-5.5 opacity-100 delay-60" : "-translate-y-1 pb-0 opacity-0"}`}
                  >
                    {it.a}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
