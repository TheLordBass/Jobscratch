import { describe, expect, it } from "vitest";
import { unsupportedFigures } from "@/lib/figures";

const CV = `# Jane Doe
Manchester | 07700 900123 | [GitHub](https://github.com/jane/repo2024)

### Analyst, Globex | Apr 2023 – Present
- Met monthly sales targets of £60,000 to £150K across 20 to 25 cases a day
- Analysed 16,296 purchases; the top 10% of customers produced 64.5% of revenue
- Flagged claims paid up to 14 times the average across 1.55M paid
- Covered around 287 million vehicles

BSc (Hons), First Class | 2021`;

describe("unsupportedFigures", () => {
  it("passes figures that come from the materials, however they're written", () => {
    const tailored = `# Jane Doe
- Exceeded monthly targets of £60K–£150K, handling 20–25 cases a day since 2023
- Found the top 10% of 16,296 purchases' customers drove 64.5% of revenue
- Flagged claims paid up to 14 times the average in £1.55M of claims, and 287M vehicles
- Graduated 2021 with a First; worked across 3 teams`;
    expect(unsupportedFigures(tailored, [CV])).toEqual([]);
  });

  it("lists figures that aren't in the materials, once each, as written", () => {
    const tailored = `- Cut reporting time by 40%, saving £20K a year
- Led a team of 12 across 40% of the office, from 2019`;
    expect(unsupportedFigures(tailored, [CV])).toEqual(["40%", "£20K", "12", "2019"]);
  });

  it("ignores link addresses, ordinals and small counts", () => {
    const tailored = "[GitHub](https://github.com/jane/x9999) | Ranked 1st of 4 analysts in Q3 | 2 roles";
    expect(unsupportedFigures(tailored, [CV])).toEqual([]);
  });

  it("checks against every source given, such as notes or a job ad", () => {
    expect(unsupportedFigures("Joining your 450-strong team", [CV])).toEqual(["450"]);
    expect(unsupportedFigures("Joining your 450-strong team", [CV, "We are a team of 450 people"])).toEqual([]);
  });
});
