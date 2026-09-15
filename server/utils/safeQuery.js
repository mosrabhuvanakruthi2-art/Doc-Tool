// Guards against NoSQL operator injection through query strings.
//
// Express's default parser turns `?field[$ne]=1` into an object and `?f=a&f=b`
// into an array. Assigned straight into a Mongo filter, an object becomes an
// operator ($ne, $gt, $regex, …). These helpers force query-derived filter
// values to plain strings before they ever reach a query.

function qStr(v) {
  if (v == null) return undefined;
  if (Array.isArray(v)) v = v[0];          // ?x=a&x=b -> take the first
  if (v == null || typeof v === 'object') return undefined; // an injected operator
  const s = String(v).trim();
  return s.length ? s : undefined;
}

// Returns the value only when it is one of the allowed strings.
function qEnum(v, allowed) {
  const s = qStr(v);
  return allowed.includes(s) ? s : undefined;
}

// Escapes regex metacharacters so user text is matched literally (no ReDoS,
// no attacker-controlled pattern).
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { qStr, qEnum, escapeRegex };
