# JobScratch browser extension

Sends the job you're viewing to JobScratch. It works on LinkedIn, Indeed and Glassdoor, which can't be searched through an API, and on any company careers page.

It reads only the tab you're on, and only when you click **Send job**. There's no background activity, crawling or automated browsing.

## Install (Chrome, Edge, Brave, Arc)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this `extension/` folder.
4. Pin the extension, open its popup, and set **JobScratch address** to where your app runs (default `http://localhost:3000`).

## Use

1. Open a job posting, for example `https://www.linkedin.com/jobs/view/…`, or a LinkedIn search page with a job selected.
2. Click the JobScratch icon, then **Send job**.
3. JobScratch opens with the job filled in. Check the details, then save it or tailor your CV to it.

If the description comes through incomplete (LinkedIn changes its page layout often), select the description text on the page and click **Send job** again. Selected text always takes priority.

`extractor.js` is a copy of `public/extractor.js`. After changing that file, run `npm run sync:extension`.
