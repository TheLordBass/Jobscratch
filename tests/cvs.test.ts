import { describe, expect, it } from "vitest";
import { candidateFor } from "@/lib/candidate";
import { MAIN_CV, cvVersions, pickCv, whyCv } from "@/lib/cvs";
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

  it("says why a job uses its CV", () => {
    expect(whyCv(cv, { title: "Data Analyst" })).toBe("the job title has “data”");
    expect(whyCv(cv, { title: "Data Analyst" }, "data-eng")).toBe("picked for this job");
    expect(whyCv(cv, { title: "Office Manager" })).toBe("none of the others fit its title");
    expect(whyCv({ text: text("Main"), updatedAt: "" }, { title: "Data Analyst" })).toBe("");
  });

  it("keeps the main CV's match scores: the same key as before there were others", () => {
    const before = candidateFor({ text: cv.text, updatedAt: cv.updatedAt }, EMPTY_PROFILE).key;
    expect(candidateFor(cvVersions(cv)[0], EMPTY_PROFILE).key).toBe(before);
    expect(candidateFor(cvVersions(cv)[1], EMPTY_PROFILE).key).not.toBe(before);
  });
});
