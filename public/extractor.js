/*
 * JobScratch page extractor.
 *
 * Reads the job you are looking at from the current page. Shared by the
 * bookmarklet, the browser extension (extension/extractor.js is a copy, kept in
 * sync by `npm run sync:extension`) and the "import from URL" tool.
 *
 * It only reads the page it is given, once, when you ask it to. It does not
 * crawl, log in, or send anything anywhere by itself.
 *
 * Written as plain ES2019 with block comments and explicit semicolons so it
 * still works when inlined into a javascript: bookmarklet URL.
 */
(function (root) {
  "use strict";

  var VERSION = 1;
  var MAX_DESCRIPTION = 20000;
  var BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|OL|P|PRE|SECTION|TABLE|TBODY|TR|UL)$/;
  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|BUTTON|IFRAME|SELECT|OPTION)$/;
  var HIDDEN_CLASS = /(^|\s)(visually-hidden|sr-only|a11y-text)(\s|$)/;

  function clean(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v ​]+/g, " ")
      .split("\n")
      .map(function (line) { return line.trim(); })
      .join("\n")
      .replace(/\n• (?=\n)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /* Text of an element with paragraph breaks and bullets; works on inert (DOMParser) documents too. */
  function textOf(node) {
    if (!node) return "";
    var out = [];
    function walk(n) {
      if (n.nodeType === 3) { out.push(n.nodeValue.replace(/\s+/g, " ")); return; }
      if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
      var tag = n.tagName ? n.tagName.toUpperCase() : "";
      if (SKIP.test(tag)) return;
      if (typeof n.className === "string" && HIDDEN_CLASS.test(n.className)) return;
      if (n.hidden) return;
      var block = BLOCK.test(tag);
      if (tag === "LI") out.push("\n• ");
      else if (block) out.push("\n");
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (block && tag !== "LI") out.push("\n");
    }
    walk(node);
    return clean(out.join(""));
  }

  function query(doc, selector) {
    try { return doc.querySelector(selector); } catch { return null; }
  }

  function queryAll(doc, selector) {
    try { return doc.querySelectorAll(selector); } catch { return []; }
  }

  function firstText(doc, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = query(doc, selectors[i]);
      var text = el ? textOf(el) : "";
      if (text) return text;
    }
    return "";
  }

  function meta(doc, names) {
    for (var i = 0; i < names.length; i++) {
      var el = query(doc, 'meta[property="' + names[i] + '"]') || query(doc, 'meta[name="' + names[i] + '"]');
      var content = el && el.getAttribute("content");
      if (content && content.trim()) return content.trim();
    }
    return "";
  }

  /* Convert an HTML string to text without executing anything (DOMParser documents are inert). */
  function htmlToText(html) {
    if (!html) return "";
    var value = String(html);
    if (typeof DOMParser === "undefined") return clean(value.replace(/<[^>]+>/g, " "));
    for (var pass = 0; pass < 2; pass++) {
      var parsed = new DOMParser().parseFromString(value, "text/html");
      var text = textOf(parsed.body);
      if (pass === 0 && /<\/?[a-z][^>]*>/i.test(text)) { value = text; continue; }
      return text;
    }
    return "";
  }

  /* ---------- schema.org JobPosting (JSON-LD) ---------- */

  function findJobPosting(node, depth) {
    if (!node || typeof node !== "object" || depth > 6) return null;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var found = findJobPosting(node[i], depth + 1);
        if (found) return found;
      }
      return null;
    }
    var type = node["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.indexOf("JobPosting") >= 0)) return node;
    if (node["@graph"]) return findJobPosting(node["@graph"], depth + 1);
    if (node.mainEntity) return findJobPosting(node.mainEntity, depth + 1);
    return null;
  }

  function nameOf(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return nameOf(value[0]);
    return value.name || "";
  }

  function placeText(place) {
    if (!place) return "";
    if (typeof place === "string") return place;
    var address = place.address || place;
    if (typeof address === "string") return address;
    var parts = [address.addressLocality, address.addressRegion, nameOf(address.addressCountry)];
    return parts.filter(function (part, index) { return part && parts.indexOf(part) === index; }).join(", ");
  }

  function salaryText(base) {
    if (!base || typeof base !== "object") return "";
    var value = base.value || {};
    var currency = base.currency || value.currency || "";
    var min = value.minValue, max = value.maxValue, single = value.value;
    var unit = value.unitText ? " per " + String(value.unitText).toLowerCase() : "";
    if (typeof value === "number") single = value;
    if (min && max) return (currency + " " + min + "–" + max + unit).trim();
    if (min || max || single) return (currency + " " + (min || max || single) + unit).trim();
    return "";
  }

  function fromJsonLd(doc) {
    var scripts = queryAll(doc, 'script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var job = null;
      try { job = findJobPosting(JSON.parse(scripts[i].textContent), 0); } catch { job = null; }
      if (!job) continue;
      var places = Array.isArray(job.jobLocation) ? job.jobLocation : job.jobLocation ? [job.jobLocation] : [];
      var location = places.map(placeText).filter(Boolean).join(" / ");
      var remote = job.jobLocationType === "TELECOMMUTE";
      if (remote) {
        var region = nameOf(job.applicantLocationRequirements);
        location = location || (region ? "Remote (" + region + ")" : "Remote");
      }
      var types = Array.isArray(job.employmentType) ? job.employmentType : job.employmentType ? [job.employmentType] : [];
      return {
        title: clean(job.title || job.name || ""),
        company: clean(nameOf(job.hiringOrganization)),
        location: clean(location),
        description: htmlToText(job.description),
        url: typeof job.url === "string" ? job.url : "",
        postedAt: job.datePosted || "",
        employmentType: types.join(", ").replace(/_/g, " ").toLowerCase(),
        salaryText: salaryText(job.baseSalary),
        remote: remote
      };
    }
    return null;
  }

  /* ---------- Job sites that can't be searched through an API ---------- */

  var SITES = [
    {
      name: "LinkedIn",
      host: /(^|\.)linkedin\.com$/i,
      title: [
        ".job-details-jobs-unified-top-card__job-title h1",
        ".job-details-jobs-unified-top-card__job-title",
        ".jobs-unified-top-card__job-title",
        ".top-card-layout__title",
        "h1.topcard__title"
      ],
      company: [
        ".job-details-jobs-unified-top-card__company-name a",
        ".job-details-jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name a",
        ".jobs-unified-top-card__company-name",
        ".topcard__org-name-link",
        ".top-card-layout__second-subline .topcard__flavor"
      ],
      location: [
        ".job-details-jobs-unified-top-card__tertiary-description-container .tvm__text",
        ".job-details-jobs-unified-top-card__primary-description-container .tvm__text",
        ".job-details-jobs-unified-top-card__bullet",
        ".jobs-unified-top-card__bullet",
        ".topcard__flavor--bullet"
      ],
      description: [
        "#job-details",
        ".jobs-description__content .jobs-box__html-content",
        ".jobs-description-content__text",
        ".jobs-description__content",
        ".show-more-less-html__markup",
        ".description__text"
      ],
      canonicalUrl: function (url) {
        var id = url.searchParams.get("currentJobId") || (/\/jobs\/view\/(?:[^/]*?-)?(\d+)/.exec(url.pathname) || [])[1];
        return id ? "https://www.linkedin.com/jobs/view/" + id + "/" : url.href;
      },
      fromTitle: function (doc, url) {
        /* Job pages are titled "Role | Company | LinkedIn". */
        if (!/\/jobs\/view\//.test(url.pathname)) return null;
        var parts = String(doc.title || "").replace(/^\(\d+\)\s*/, "").split(" | ");
        return parts.length >= 3 ? { title: parts[0], company: parts[1] } : null;
      }
    },
    {
      name: "Indeed",
      host: /(^|\.)indeed\.[a-z.]+$/i,
      title: ['[data-testid="jobsearch-JobInfoHeader-title"]', ".jobsearch-JobInfoHeader-title", "h2.jobsearch-JobInfoHeader-title"],
      company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]', ".jobsearch-CompanyInfoContainer a"],
      location: ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]', '[data-testid="jobsearch-JobInfoHeader-companyLocation"]'],
      description: ["#jobDescriptionText", ".jobsearch-jobDescriptionText"],
      canonicalUrl: function (url) {
        var id = url.searchParams.get("jk") || url.searchParams.get("vjk");
        return id ? url.protocol + "//" + url.host + "/viewjob?jk=" + id : url.href;
      }
    },
    {
      name: "Glassdoor",
      host: /(^|\.)glassdoor\.[a-z.]+$/i,
      title: ['[data-test="job-title"]', '[data-test="jobTitle"]'],
      company: ['[data-test="employer-name"]', '[data-test="employerName"]'],
      location: ['[data-test="location"]', '[data-test="emp-location"]'],
      description: ['[class*="JobDetails_jobDescription"]', ".jobDescriptionContent", "#JobDescriptionContainer"],
      canonicalUrl: function (url) { return url.href; }
    },
    {
      /* Its description sections are marked by empty anchors, so the general description finder reads it. */
      name: "NHS Jobs",
      host: /(^|\.)jobs\.nhs\.uk$/i,
      title: ["h1#heading"],
      company: ["#employer_name"],
      location: ["#employer_town"],
      description: [],
      canonicalUrl: function (url) { return url.protocol + "//" + url.host + url.pathname; }
    }
  ];

  var DESCRIPTION_HEADINGS = /^(about the job|about this job|job description|description|about the role|the role|role description|job details)$/i;

  function descriptionByHeading(doc) {
    var headings = queryAll(doc, "h1, h2, h3, strong");
    for (var i = 0; i < headings.length; i++) {
      if (!DESCRIPTION_HEADINGS.test(textOf(headings[i]))) continue;
      var container = headings[i].parentElement;
      for (var hops = 0; container && hops < 3; hops++) {
        var text = textOf(container);
        if (text.length > 300) return text.replace(/^[^\n]*\n+/, "");
        container = container.parentElement;
      }
    }
    return "";
  }

  function largestBlock(doc) {
    var candidates = queryAll(doc, 'article, main, [class*="description" i], [id*="description" i], [class*="job-details" i]');
    var best = "";
    for (var i = 0; i < candidates.length; i++) {
      var text = textOf(candidates[i]);
      if (text.length > best.length && text.length < 60000) best = text;
    }
    return best;
  }

  function selectedText(doc) {
    var view = doc.defaultView;
    try {
      var selection = view && view.getSelection ? String(view.getSelection()) : "";
      return clean(selection);
    } catch { return ""; }
  }

  function firstOf() {
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) return arguments[i];
    return "";
  }

  function extract(doc, href) {
    var url;
    try { url = new URL(href || (doc.location && doc.location.href) || ""); } catch { url = null; }
    var site = null;
    for (var i = 0; url && i < SITES.length; i++) if (SITES[i].host.test(url.hostname)) site = SITES[i];

    var ld = fromJsonLd(doc) || {};
    var page = { title: "", company: "", location: "", description: "" };
    if (site) {
      page.title = firstText(doc, site.title).replace(/\s*-\s*job post$/i, "");
      page.company = firstText(doc, site.company);
      page.location = firstText(doc, site.location);
      page.description = firstText(doc, site.description);
      var titled = site.fromTitle ? site.fromTitle(doc, url) : null;
      if (titled) {
        page.title = page.title || titled.title;
        page.company = page.company || titled.company;
      }
    }

    var selection = selectedText(doc);
    var description = selection.length >= 200 ? selection : firstOf(
      ld.description && page.description
        ? (ld.description.length >= page.description.length ? ld.description : page.description)
        : ld.description || page.description,
      descriptionByHeading(doc),
      largestBlock(doc),
      meta(doc, ["og:description", "description"])
    );

    description = description.replace(/^(about the job|about this job|job description)\s*\n+/i, "");

    var title = firstOf(ld.title, page.title, meta(doc, ["og:title", "twitter:title"]), firstText(doc, ["h1"]), clean(doc.title));
    var location = firstOf(ld.location, page.location);
    var canonical = site && url ? site.canonicalUrl(url) : "";
    var jobUrl = firstOf(canonical, ld.url, meta(doc, ["og:url"]), url ? url.href : "");

    return {
      v: VERSION,
      title: clean(title).slice(0, 300),
      company: clean(firstOf(ld.company, page.company, meta(doc, ["og:site_name"]))).slice(0, 200),
      location: clean(location).slice(0, 200),
      description: description.slice(0, MAX_DESCRIPTION),
      url: jobUrl,
      sourceName: site ? site.name : url ? url.hostname.replace(/^www\./, "") : "",
      postedAt: ld.postedAt || "",
      employmentType: ld.employmentType || "",
      salaryText: ld.salaryText || "",
      remote: Boolean(ld.remote) || /\bremote\b/i.test(location),
      extractedFrom: selection.length >= 200 ? "selection" : ld.title ? "structured-data" : site ? "page" : "generic"
    };
  }

  root.jobscratchExtract = extract;
})(typeof window !== "undefined" ? window : globalThis);
