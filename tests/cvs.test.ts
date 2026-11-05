import { describe, expect, it } from "vitest";
import { candidateFor, madeFromCurrent, stampMadeFrom } from "@/lib/candidate";
import { MAIN_CV, cvVersions } from "@/lib/cvs";
import { EMPTY_PROFILE, type StoredCv, type TailoredDocs } from "@/lib/store";

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

describe("documents made from an earlier CV", () => {
  const candidate = candidateFor(cv, EMPTY_PROFILE);
  const uploaded = candidateFor({ ...cv, text: text("New main"), updatedAt: "2026-11-05T09:00:00.000Z" }, EMPTY_PROFILE);

  it("sends each CV's date, so the newest wins where they disagree", () => {
    expect(candidate.cvs?.[0]).toMatchObject({ name: "Main CV", updated: "2026-10-28" });
  });

  it("goes by what each was made from, once that's recorded", () => {
    const docs: TailoredDocs = { cv: "# CV", cvFrom: candidate.key, coverLetter: "Dear", coverLetterFrom: "earlier", updatedAt: "2026-11-01T00:00:00.000Z" };
    expect(madeFromCurrent(docs, "cv", candidate)).toBe(true);
    expect(madeFromCurrent(docs, "cv", uploaded)).toBe(false);
    expect(madeFromCurrent(docs, "coverLetter", candidate)).toBe(false);
    expect(madeFromCurrent(docs, "analysis", candidate)).toBe(false);
  });

  it("goes by date for ones made before that, and records it", () => {
    const docs: TailoredDocs = { cv: "# CV", coverLetter: "Dear", coverLetterFrom: candidate.key, updatedAt: "2026-11-01T00:00:00.000Z" };
    expect(madeFromCurrent(docs, "cv", candidate)).toBe(true);
    expect(madeFromCurrent(docs, "cv", uploaded)).toBe(false);
    expect(stampMadeFrom(docs, uploaded)).toEqual({ cvFrom: "earlier" });
    expect(stampMadeFrom(docs, candidate)).toEqual({ cvFrom: candidate.key });
    expect(stampMadeFrom({ ...docs, cvFrom: "earlier" }, candidate)).toBeUndefined();
  });
});
