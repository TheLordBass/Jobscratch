import { checkHelperToken, helperTokenConfigured } from "@/lib/jobspy-runs";
import { dataBackend, storageAvailability, type DataBackend } from "@/lib/server-data";

/**
 * For the routes the scheduled JobSpy run calls (/api/helper/*): the storage to use, or a response
 * saying why the request can't go ahead. They need Authorization: Bearer JOBSCRATCH_HELPER_TOKEN,
 * whether or not sign-in is on.
 */
export function openForHelper(request: Request): DataBackend | Response {
  const env = process.env;
  if (!helperTokenConfigured(env)) {
    return Response.json({ error: "Set JOBSCRATCH_HELPER_TOKEN on the server first (see the README)." }, { status: 503 });
  }
  if (!checkHelperToken(env, request.headers.get("authorization"))) {
    return Response.json({ error: "That helper token isn't right. Check JOBSCRATCH_HELPER_TOKEN." }, { status: 401 });
  }
  const backend = dataBackend(env);
  if (!backend || storageAvailability(env, backend)) {
    return Response.json({ error: "Server storage isn't on, so there's nowhere to keep the run (see the README)." }, { status: 503 });
  }
  return backend;
}
