import { h2, section, sectionStack, titleGrid } from "./styles";

const criteria = ["Pronunciation", "Fluency", "Vocabulary", "Grammar"] as const;

const rubric: { band: string; cells: [string, string, string, string] }[] = [
  {
    band: "6 · Confident",
    cells: [
      "Easily understood. Natural stress and intonation. Accent never impedes.",
      "Sustained, natural pace. Hesitation only for content planning.",
      "Wide, precise range. Natural collocation and effective paraphrase.",
      "Full range of structures with consistent accuracy.",
    ],
  },
  {
    band: "5 · Competent",
    cells: [
      "Generally clear. Occasional misplaced stress. Minimal listener effort.",
      "Mostly smooth. Occasional repetition and self correction.",
      "Sufficient range for all parts. Some precise word choice.",
      "Mix of simple and complex structures. Frequent accuracy.",
    ],
  },
  {
    band: "4 · Functional",
    cells: [
      "Understandable with some listener effort. Recurring sound and stress patterns.",
      "Noticeable pausing. Turns sustained but unevenly.",
      "Adequate for familiar topics. Struggles with abstract topics in Parts 3 and 4.",
      "Limited complex structures. Errors occur but meaning is clear.",
    ],
  },
  {
    band: "3 · Developing",
    cells: [
      "Frequently unclear. Pronunciation often obscures meaning.",
      "Halting and fragmented. Long pauses. Hard to sustain a turn.",
      "Narrow range. Frequent wrong word choice. Reliance on simple lexis.",
      "Basic structures dominate. Frequent errors impede meaning at times.",
    ],
  },
  {
    band: "2 · Basic",
    cells: [
      "Very difficult to understand. Heavy first language interference.",
      "Very slow, with frequent breakdowns. Only short utterances.",
      "Isolated words and phrases. Cannot paraphrase. Constant repetition.",
      "Little control of basic forms. Meaning often obscured.",
    ],
  },
  {
    band: "1 · Minimal",
    cells: [
      "Unintelligible or near silence. No assessable speech.",
      "No connected speech beyond isolated words.",
      "No productive vocabulary demonstrated.",
      "No assessable grammatical control.",
    ],
  },
];

const cell =
  "border-b border-sn-border px-3.5 py-3.5 text-left align-top max-[760px]:block max-[760px]:w-full max-[760px]:border-b-0";

/* Desktop: a band x criterion table. <=760px: each band row stacks. <=640px: band name as title,
   the four criteria in a 2x2 grid, each labelled from data-label. */
export function Rubric() {
  return (
    <section className={section} id="rubric">
      <div className={sectionStack}>
        <div className={titleGrid}>
          <h2 className={h2}>One band from one to six.</h2>
        </div>
        <table className="w-full border-collapse text-sm max-[760px]:block">
          <thead className="max-[760px]:sr-only">
            <tr>
              {["Band", ...criteria].map((c, i) => (
                <th
                  key={c}
                  scope="col"
                  className={`${cell} text-[11px] font-medium tracking-[0.04em] text-sn-muted uppercase ${i === 0 ? "w-[1%] whitespace-nowrap" : ""}`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="max-[760px]:block">
            {rubric.map((r) => (
              <tr
                key={r.band}
                className="hover:bg-sn-fg/6 max-[760px]:block max-[760px]:border-b max-[760px]:border-sn-border max-[760px]:pt-2 max-[760px]:pb-4 max-[640px]:grid max-[640px]:grid-cols-2 max-[640px]:gap-x-5 max-[640px]:gap-y-3 max-[640px]:pb-6"
              >
                <th
                  scope="row"
                  className={`${cell} w-[1%] text-xs font-semibold tracking-[0.03em] whitespace-nowrap text-sn-fg max-[760px]:w-auto max-[760px]:px-0 max-[760px]:pt-3 max-[760px]:pb-2 max-[760px]:whitespace-normal max-[640px]:col-span-full max-[640px]:pb-1 max-[640px]:text-xl max-[640px]:font-bold max-[640px]:tracking-[-0.01em]`}
                >
                  {r.band}
                </th>
                {r.cells.map((text, i) => (
                  <td
                    key={criteria[i]}
                    data-label={criteria[i]}
                    className={`${cell} text-[13px] max-[760px]:px-0 max-[760px]:pt-2.5 max-[760px]:pb-0 max-[760px]:before:mb-0.5 max-[760px]:before:block max-[760px]:before:text-[11px] max-[760px]:before:tracking-[0.04em] max-[760px]:before:text-sn-muted max-[760px]:before:uppercase max-[760px]:before:content-[attr(data-label)] max-[640px]:w-auto max-[640px]:p-0 max-[640px]:leading-normal max-[640px]:text-sn-muted max-[640px]:before:mb-2 max-[640px]:before:border-b max-[640px]:before:border-sn-border max-[640px]:before:pb-1.5 max-[640px]:before:text-xs max-[640px]:before:font-bold max-[640px]:before:tracking-[0.06em] max-[640px]:before:text-sn-fg`}
                  >
                    {text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
