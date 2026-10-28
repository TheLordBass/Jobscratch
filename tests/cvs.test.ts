import { describe, expect, it } from "vitest";
import { candidateFor } from "@/lib/candidate";
import { MAIN_CV, cvVersions, cvsToMatch, pickCv, whyCv } from "@/lib/cvs";
import { EMPTY_PROFILE, type StoredCv } from "@/lib/store";

const text = (who: string) => `${who}. ${"Five years of reporting, stakeholder work and process improvement. ".repeat(2)}`;

const cv: StoredCv = {
  text: text("Main"),
  updatedAt: "2026-10-28T08:00:00.000Z",
  others: [
    { id: "data", name: "Data CV", text: text("Data"), titles: ["data", "BI"], updatedAt: "2026-10-28T08:00:00.000Z" },
    { id: "data-eng", name: "Engineering CV", text: text("Engineering"), titles: ["data engineer"], updatedAt: "2026-10-28T08:00:00.000Z" },
    { id: "empty", name: "Ops CV", text: "", titles: ["operations"], updatedAt: "2026-10-28T08:00:00.000Z" },
  ],
};

describe("more than one CV", () => {
  it("lists the main CV first, named once there are others", () => {
    expect(cvVersions(cv).map((v) => v.id)).toEqual([MAIN_CV, "data", "data-eng", "empty"]);
    expect(cvVersions({ ...cv, name: "Generalist" })[0].name).toBe("Generalist");
    expect(cvVersions(null)).toEqual([]);
  });

  it("picks a job's CV by its title: the longest words that fit, as whole words", () => {
    expect(pickCv(cv, { title: "Senior Data Analyst" })?.id).toBe("data");
    expect(pickCv(cv, { title: "Data Engineer (Python)" })?.id).toBe("data-eng");
    expect(pickCv(cv, { title: "BI Developer" })?.id).toBe("data");
    // "bi" inside another word doesn't count.
    expect(pickCv(cv, { title: "Mobile Engineer" })?.id).toBe(MAIN_CV);
    expect(pickCv(cv, { title: "Office Manager" })?.id).toBe(MAIN_CV);
  });

  it("uses the one picked on the job's page, but never an empty one", () => {
    expect(pickCv(cv, { title: "Data Analyst" }, "data-eng")?.id).toBe("data-eng");
    expect(pickCv(cv, { title: "Data Analyst" }, MAIN_CV)?.id).toBe(MAIN_CV);
    // An empty CV, or one since deleted, falls back to the title.
    expect(pickCv(cv, { title: "Operations Analyst" })?.id).toBe(MAIN_CV);
    expect(pickCv(cv, { title: "Data Analyst" }, "empty")?.id).toBe("data");
    expect(pickCv(cv, { title: "Data Analyst" }, "gone")?.id).toBe("data");
  });

  it("matches a job against every CV unless one is picked for it or its title decides", () => {
    const ids = (versions: { id: string }[]) => versions.map((v) => v.id);
    expect(ids(cvsToMatch(cv, { title: "Office Manager" }))).toEqual([MAIN_CV, "data", "data-eng"]);
    expect(ids(cvsToMatch(cv, { title: "Office Manager" }, "data"))).toEqual(["data"]);
    expect(ids(cvsToMatch(cv, { title: "Data Engineer" }))).toEqual(["data-eng"]);
    expect(ids(cvsToMatch({ text: text("Main"), updatedAt: "" }, { title: "Office Manager" }))).toEqual([MAIN_CV]);
    expect(cvsToMatch(null, { title: "Office Manager" })).toEqual([]);
  });

  it("tailors with the CV the match chose, after a pick or the title", () => {
    expect(pickCv(cv, { title: "Office Manager" }, undefined, "data-eng")?.id).toBe("data-eng");
    expect(pickCv(cv, { title: "Data Analyst" }, undefined, "data-eng")?.id).toBe("data");
    expect(pickCv(cv, { title: "Office Manager" }, MAIN_CV, "data-eng")?.id).toBe(MAIN_CV);
    expect(pickCv(cv, { title: "Office Manager" }, undefined, "empty")?.id).toBe(MAIN_CV);
  });

  it("says why a job uses its CV", () => {
    expect(whyCv(cv, { title: "Data Analyst" })).toBe("the job title has “data”");
    expect(whyCv(cv, { title: "Data Analyst" }, "data-eng")).toBe("picked for this job");
    expect(whyCv(cv, { title: "Office Manager" })).toBe("the main CV, until a match picks the best one");
    expect(whyCv(cv, { title: "Office Manager" }, undefined, "data-eng")).toBe("the match found it fits this job best");
    expect(whyCv({ text: text("Main"), updatedAt: "" }, { title: "Data Analyst" })).toBe("");
  });

  it("keeps the main CV's match scores: the same key as before there were others", () => {
    const before = candidateFor({ text: cv.text, updatedAt: cv.updatedAt }, EMPTY_PROFILE).key;
    expect(candidateFor(cvVersions(cv)[0], EMPTY_PROFILE).key).toBe(before);
    expect(candidateFor(cvVersions(cv)[1], EMPTY_PROFILE).key).not.toBe(before);
    // A list of one is that CV.
    expect(candidateFor(cvVersions(cv).slice(0, 1), EMPTY_PROFILE)).toEqual(candidateFor(cvVersions(cv)[0], EMPTY_PROFILE));
  });

  it("sends every CV with text to a match, keyed on them all", () => {
    const every = candidateFor(cvVersions(cv), EMPTY_PROFILE);
    expect(every.cvs?.map((v) => v.id)).toEqual([MAIN_CV, "data", "data-eng"]);
    expect(every.cv).toBe(cv.text);
    const edited = { ...cv, others: cv.others!.map((v) => (v.id === "data" ? { ...v, text: `${v.text} Tableau.` } : v)) };
    expect(candidateFor(cvVersions(edited), EMPTY_PROFILE).key).not.toBe(every.key);
    // Renaming one, or changing its title words, keeps the scores.
    const renamed = { ...cv, others: cv.others!.map((v) => ({ ...v, name: `${v.name}!`, titles: [] })) };
    expect(candidateFor(cvVersions(renamed), EMPTY_PROFILE).key).toBe(every.key);
  });
});
