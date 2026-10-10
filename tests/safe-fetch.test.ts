import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress } from "@/lib/safe-fetch";

describe("isPrivateAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["172.20.0.1", true],
    ["172.32.0.1", false],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["8.8.8.8", false],
    ["::1", true],
    ["fd00::1", true],
    ["fe80::1", true],
    ["::ffff:127.0.0.1", true],
    ["2606:4700::1111", false],
  ])("%s -> %s", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe("assertPublicUrl", () => {
  it("refuses sites that forbid automated access and points to the bookmarklet", async () => {
    await expect(assertPublicUrl("https://www.linkedin.com/jobs/view/123/")).rejects.toMatchObject({
      blockedSite: "LinkedIn",
      status: 422,
    });
    await expect(assertPublicUrl("https://uk.indeed.com/viewjob?jk=1")).rejects.toMatchObject({
      blockedSite: "Indeed",
    });
  });

  it.each([
    "ftp://example.com/job",
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data",
    "https://example.com:8443/job",
    "https://user:pass@example.com/",
    "not a url",
  ])("rejects %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });

  it("accepts a public IP literal", async () => {
    await expect(assertPublicUrl("https://1.1.1.1/careers")).resolves.toBeInstanceOf(URL);
  });
});
