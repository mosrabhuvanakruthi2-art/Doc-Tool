const { FIELD_CONFIG } = require('./revisionDiff');

// Pulls the value a step lands on out of a recorded change.
// text/number carry a literal value; images/list carry the whole list; html and
// row sets are too large to copy, so those steps carry only their change detail.
function stepValue(change, side) {
  const kind = change.kind;
  if (kind === 'images' || kind === 'list') {
    return { items: Array.isArray(change[side]) ? change[side] : [] };
  }
  if (kind === 'html' || kind === 'rows') return {};
  return { value: change[side] };
}

function sameValue(kind, step, current) {
  if (kind === 'images' || kind === 'list') {
    const a = (step.items || []).map(String);
    const b = Array.isArray(current) ? current.map(String) : [];
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (kind === 'number') return Number(step.value || 0) === Number(current || 0);
  if (kind === 'html' || kind === 'rows') return true; // no literal value to compare
  return String(step.value ?? '') === String(current ?? '');
}

// Turns a record's revisions into one chain per field:
//
//   created: <original>  ->  updated to: <v2>  ->  ...  ->  current: <latest>
//
// Chronological order in, labelled steps out. When the oldest revision is an
// 'updated' one (the record predates history tracking), its `before` value seeds
// the chain so the chain still starts from a known original.
function buildFieldChains(entityType, revisions, liveDoc) {
  const config = FIELD_CONFIG[entityType] || {};
  const chains = new Map();

  const append = (field, step) => {
    if (!chains.has(field)) chains.set(field, []);
    chains.get(field).push(step);
  };

  revisions.forEach((revision) => {
    (revision.changes || []).forEach((change) => {
      if (!config[change.field]) return;

      if (revision.action === 'created') {
        append(change.field, {
          stage: 'created',
          at: revision.changedAt,
          by: revision.actorEmail || '',
          byName: revision.actorName || '',
          summary: change.summary,
          ...stepValue(change, 'after'),
        });
        return;
      }

      // Seed the origin from this change's "before" the first time we meet the field.
      if (!chains.has(change.field)) {
        append(change.field, {
          stage: 'created',
          at: null,
          ...stepValue(change, 'before'),
        });
      }

      append(change.field, {
        stage: 'updated',
        at: revision.changedAt,
        by: revision.actorEmail || '',
        byName: revision.actorName || '',
        summary: change.summary,
        added: change.added,
        removed: change.removed,
        changed: change.changed,
        renamed: change.renamed,
        truncated: change.truncated,
        ...stepValue(change, 'after'),
      });
    });
  });

  const fields = [];
  Object.keys(config).forEach((field) => {
    const steps = chains.get(field);
    if (!steps || !steps.length) return;
    const { label, kind, primary } = config[field];

    // A single "created" step on a bookkeeping field (display order, scope) is noise.
    // Keep it only for content columns, or when the field genuinely moved.
    if (steps.length === 1 && !primary) return;

    // Guarantee the chain ends at the record's real present value, even if some
    // write path bypassed history recording.
    if (liveDoc && !sameValue(kind, steps[steps.length - 1], liveDoc[field])) {
      const tail = { stage: 'updated', at: null, untracked: true };
      if (kind === 'images' || kind === 'list') {
        tail.items = Array.isArray(liveDoc[field]) ? liveDoc[field].map(String) : [];
      } else if (kind !== 'html' && kind !== 'rows') {
        tail.value = liveDoc[field];
      }
      steps.push(tail);
    }

    if (steps.length > 1) steps[steps.length - 1].stage = 'current';
    fields.push({ field, label, kind, steps });
  });

  return fields;
}

module.exports = { buildFieldChains };
