// One request per URL while it is in flight.
//
// The sidebar and the dashboard mount together and both ask for the same lists at
// the same moment. Callers that request an identical GET while one is already on
// its way share that response's parsed JSON instead of firing a second request.
// Nothing is kept once it settles, so every later call fetches fresh data.
const inflight = new Map();

export function getJsonShared(url) {
  if (!inflight.has(url)) {
    const request = fetch(url)
      .then((res) => res.json())
      .finally(() => inflight.delete(url));
    inflight.set(url, request);
  }
  return inflight.get(url);
}
