import { describe, expect, it } from "vitest";
import { candidateFor } from "@/lib/candidate";
import { MAIN_CV, cvVersions } from "@/lib/cvs";
import { EMPTY_PROFILE, type StoredCv } from "@/lib/store";

const text = (who: string) => `${who}. ${"Five years of reporting, stakeholder work and process improvement. ".repeat(2)}`;

const cv: StoredCv = {
  text: text("Main"),
  updatedAt: "2026-10-28T08:00:00.000Z",
  others: [
    { id: "data", name: "Data CV", text: text("Data"), updatedAt: "2026-10-28T08:00:00.000Z" },
    { id: "ops", name: "Ops CV", text: text("Ops"), updatedAt: "2026-10-28T08:00:00.000Z" },
    { id: "empty", name: "New CV", text: "", updatedAt: "2026-10-28T08:00:00.000Z" },
  ],
};

describe("more than one CV", () => {
  it("lists the main CV first, named once there are others", () => {
    expect(cvVersions(cv).map((v) => v.id)).toEqual([MAIN_CV, "data", "ops", "empty"]);
    expect(cvVersions({ ...cv, name: "Generalist" })[0].name).toBe("Generalist");
    expect(cvVersions(null)).toEqual([]);
  });

  it("sends every CV with text, the main one first, for every job", () => {
    const candidate = candidateFor(cv, EMPTY_PROFILE);
    expect(candidate.cvs?.map((v) => v.name)).toEqual(["Main CV", "Data CV", "Ops CV"]);
    expect(candidate.cv).toBe(cv.text);
  });

  it("keeps the match scores made with one CV: the same key as before there could be others", () => {
    const one: StoredCv = { text: cv.text, updatedAt: cv.updatedAt };
    const before = candidateFor(one, EMPTY_PROFILE);
    expect(before.cvs).toBeUndefined();
    // An empty one alongside it isn't sent, so changes nothing.
    expect(candidateFor({ ...one, others: [cv.others![2]] }, EMPTY_PROFILE)).toEqual(before);
    expect(candidateFor(cv, EMPTY_PROFILE).key).not.toBe(before.key);
  });

  it("gives new scores when any CV's text changes, but not when one is renamed", () => {
    const key = candidateFor(cv, EMPTY_PROFILE).key;
    const edited = { ...cv, others: cv.others!.map((v) => (v.id === "data" ? { ...v, text: `${v.text} Tableau.` } : v)) };
    expect(candidateFor(edited, EMPTY_PROFILE).key).not.toBe(key);
    const renamed = { ...cv, name: "Generalist", others: cv.others!.map((v) => ({ ...v, name: `${v.name}!` })) };
    expect(candidateFor(renamed, EMPTY_PROFILE).key).toBe(key);
  });
});
