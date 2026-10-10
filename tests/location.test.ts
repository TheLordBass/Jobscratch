import { describe, expect, it } from "vitest";
import { locationMatches, placeFor, PLACES, remoteOpenTo } from "@/lib/location";

const onsite = (location: string) => ({ location, remote: false });
const remote = (location: string) => ({ location, remote: true });
const uk = { country: "gb", includeRemoteAnywhere: true };

describe("remote jobs", () => {
  it("keeps remote jobs open to the searcher's country, region or anywhere", () => {
    for (const location of ["Remote", "Remote (worldwide)", "Anywhere", "Europe", "Remote - EMEA", "Remote (United Kingdom, Germany)", "UK only"]) {
      expect(locationMatches(remote(location), uk), location).toBe(true);
    }
  });

  it("drops remote jobs restricted to other countries", () => {
    for (const location of ["Remote (USA)", "USA Only", "Remote - US only", "Americas", "Remote (Canada)", "Berlin"]) {
      expect(locationMatches(remote(location), uk), location).toBe(false);
    }
  });

  it("uses the country of a typed city", () => {
    expect(locationMatches(remote("Remote (Germany)"), { ...uk, query: "Berlin" })).toBe(true);
    expect(locationMatches(remote("Remote - UK"), { ...uk, query: "Berlin" })).toBe(false);
  });

  it("can require the typed location for remote jobs too", () => {
    const strict = { ...uk, includeRemoteAnywhere: false };
    expect(locationMatches(remote("Remote (UK)"), { ...strict, query: "London" })).toBe(false);
    expect(locationMatches(remote("Remote, London"), { ...strict, query: "London" })).toBe(true);
    expect(locationMatches(remote("Remote (UK)"), { ...strict, query: "UK" })).toBe(true);
  });

  it("treats a plain region or worldwide label as open", () => {
    expect(remoteOpenTo("Worldwide", PLACES.us)).toBe(true);
    expect(remoteOpenTo("North America", PLACES.us)).toBe(true);
    expect(remoteOpenTo("North America", PLACES.gb)).toBe(false);
  });
});

describe("on-site jobs", () => {
  it("matches the selected country when no location is typed", () => {
    expect(locationMatches(onsite("London, UK"), uk)).toBe(true);
    expect(locationMatches(onsite("Manchester"), uk)).toBe(true);
    expect(locationMatches(onsite("New York"), uk)).toBe(false);
    expect(locationMatches(onsite("Austin, TX"), uk)).toBe(false);
    expect(locationMatches(onsite("Austin, TX"), { ...uk, country: "us" })).toBe(true);
    expect(locationMatches(onsite("Berlin, DE"), { ...uk, country: "us" })).toBe(false);
    expect(locationMatches(onsite(""), uk)).toBe(true);
  });

  it("isn't fooled by place names that contain another country's name", () => {
    expect(locationMatches(onsite("Sydney, New South Wales, Australia"), uk)).toBe(false);
    expect(locationMatches(onsite("Sydney, New South Wales, Australia"), { ...uk, country: "au" })).toBe(true);
    expect(locationMatches(onsite("Boston, New England"), uk)).toBe(false);
    expect(locationMatches(onsite("Albuquerque, New Mexico"), { ...uk, country: "mx" })).toBe(false);
    expect(locationMatches(onsite("Belfast, Northern Ireland"), { ...uk, country: "ie" })).toBe(false);
    expect(locationMatches(onsite("Belfast, Northern Ireland"), uk)).toBe(true);
    expect(locationMatches(remote("Remote - Latin America"), { ...uk, country: "us" })).toBe(false);
    expect(locationMatches(remote("Remote - Latin America"), { ...uk, country: "br" })).toBe(true);
  });

  it("goes by the named country when a city name exists in several", () => {
    expect(locationMatches(onsite("London, Ontario, Canada"), uk)).toBe(false);
    expect(locationMatches(onsite("London, Ontario, Canada"), { ...uk, country: "ca" })).toBe(true);
    expect(locationMatches(onsite("Cambridge, MA, United States"), uk)).toBe(false);
  });

  it("matches a typed city exactly and a typed country anywhere in it", () => {
    expect(locationMatches(onsite("London, England"), { ...uk, query: "london" })).toBe(true);
    expect(locationMatches(onsite("Manchester, England"), { ...uk, query: "London" })).toBe(false);
    expect(locationMatches(onsite("Manchester, England"), { ...uk, query: "UK" })).toBe(true);
    expect(locationMatches(onsite("Austin, TX, United States"), { ...uk, query: "usa" })).toBe(true);
    expect(locationMatches(onsite("Berlin"), { ...uk, query: "London" })).toBe(false);
  });
});

describe("placeFor", () => {
  it("prefers the place named in the query", () => {
    expect(placeFor("gb", "Lagos")).toBe(PLACES.ng);
    expect(placeFor("gb", "Somewhere")).toBe(PLACES.gb);
    expect(placeFor("gb", undefined)).toBe(PLACES.gb);
    expect(placeFor("au", "New South Wales")).toBe(PLACES.au);
  });
});
