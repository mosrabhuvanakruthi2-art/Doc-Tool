const crypto = require('crypto');

// Caps that keep a revision document small no matter how large the edited field is.
const MAX_STORED_TEXT = 8000;   // literal before/after kept for text fields
const MAX_LIST_ENTRIES = 40;    // added/removed entries kept per change
const MAX_BLOCKS = 4000;        // block-diff bails out beyond this
// A removed image cannot be recovered from the document afterwards, so a copy is
// embedded in the revision — bounded per image and per revision to stay far below
// MongoDB's 16 MB document limit.
const MAX_IMAGE_PREVIEW_BYTES = 300 * 1024;
const MAX_IMAGE_PREVIEW_TOTAL = 2 * 1024 * 1024;

// Which fields are worth recording per entity, and how to render them.
// Derived fields (slug), bookkeeping (isDeleted, timestamps) are intentionally absent.
// `primary` marks the content columns a reader cares about. Non-primary fields are
// still recorded — a row moved to another combination is worth knowing — but they
// stay out of the history view unless they actually changed.
const FIELD_CONFIG = {
  feature: {
    name: { label: 'Name', kind: 'text', primary: true },
    description: { label: 'Description', kind: 'longtext', primary: true },
    family: { label: 'Family', kind: 'text', primary: true },
    screenshots: { label: 'Screenshots', kind: 'images', primary: true },
    scope: { label: 'Scope', kind: 'text' },
    combination: { label: 'Combination', kind: 'text' },
    productType: { label: 'Product Type', kind: 'text' },
    order: { label: 'Display Order', kind: 'number' },
  },
  compatibility: {
    name: { label: 'Name', kind: 'text', primary: true },
    columns: { label: 'Columns', kind: 'list', primary: true },
    rows: { label: 'Rows', kind: 'rows', primary: true },
    notes: { label: 'Notes', kind: 'longtext', primary: true },
    order: { label: 'Display Order', kind: 'number' },
  },
  cloudInfo: {
    name: { label: 'Name', kind: 'text', primary: true },
    content: { label: 'Content', kind: 'html', primary: true },
    order: { label: 'Display Order', kind: 'number' },
  },
  document: {
    name: { label: 'Name', kind: 'text', primary: true },
    content: { label: 'Content', kind: 'html', primary: true },
    fileType: { label: 'File Type', kind: 'text', primary: true },
    fileUrl: { label: 'Attached File', kind: 'text', primary: true },
    order: { label: 'Display Order', kind: 'number' },
  },
  productConfig: {
    name: { label: 'Name', kind: 'text', primary: true },
    combinations: { label: 'Combinations', kind: 'list', primary: true },
    featureListUrl: { label: 'Feature List URL', kind: 'text', primary: true },
    order: { label: 'Display Order', kind: 'number' },
  },
};

function truncate(value, limit = MAX_STORED_TEXT) {
  const str = value == null ? '' : String(value);
  return str.length > limit
    ? { text: str.slice(0, limit), truncated: true }
    : { text: str, truncated: false };
}

function capList(items) {
  if (items.length <= MAX_LIST_ENTRIES) return { items, overflow: 0 };
  return { items: items.slice(0, MAX_LIST_ENTRIES), overflow: items.length - MAX_LIST_ENTRIES };
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

// Reduce HTML to an ordered list of comparable blocks. Images become a hash +
// byte count so a 200 KB base64 payload costs ~30 bytes in the revision.
function htmlToBlocks(html) {
  if (!html) return [];
  let str = String(html);
  const images = [];

  str = str.replace(/<img\b[^>]*>/gi, (tag) => {
    const match = tag.match(/src\s*=\s*"([^"]*)"/i) || tag.match(/src\s*=\s*'([^']*)'/i);
    const src = match ? match[1] : '';
    const isData = /^data:/i.test(src);
    images.push({
      type: 'image',
      key: isData ? 'sha1:' + crypto.createHash('sha1').update(src).digest('hex').slice(0, 16) : src,
      bytes: Buffer.byteLength(src),
      src: isData ? '' : src,
      // Inline data kept aside so a diff can embed a preview: once an image is
      // removed from the document there is nowhere else to recover it from.
      dataUri: isData ? src : '',
    });
    return `\uE000IMG${images.length - 1}\uE000`;
  });

  str = str
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote|pre|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  str = decodeEntities(str);

  const blocks = [];
  str.split('\n').forEach((line) => {
    const segments = line.split(/\uE000IMG(\d+)\uE000/);
    segments.forEach((segment, idx) => {
      if (idx % 2 === 1) {
        const image = images[Number(segment)];
        if (image) blocks.push(image);
      } else {
        const text = segment.replace(/\s+/g, ' ').trim();
        if (text) blocks.push({ type: 'text', text });
      }
    });
  });
  return blocks;
}

function blockKey(block) {
  return block.type === 'image' ? 'img:' + block.key : 'txt:' + block.text;
}

// Longest-common-subsequence diff over block keys, so unchanged blocks between
// edits are not reported as churn.
function diffSequences(beforeKeys, afterKeys) {
  const n = beforeKeys.length;
  const m = afterKeys.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = beforeKeys[i] === afterKeys[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const removedIdx = [];
  const addedIdx = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeKeys[i] === afterKeys[j]) { i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) { removedIdx.push(i++); }
    else { addedIdx.push(j++); }
  }
  while (i < n) removedIdx.push(i++);
  while (j < m) addedIdx.push(j++);

  return { removedIdx, addedIdx };
}

function summarizeBlocks(added, removed, edited) {
  const count = (list, type) => list.filter(b => b.type === type).length;
  const parts = [];
  const imgAdded = count(added, 'image');
  const imgRemoved = count(removed, 'image');
  const txtAdded = count(added, 'text');
  const txtRemoved = count(removed, 'text');

  if (edited) parts.push(`${edited} paragraph${edited > 1 ? 's' : ''} edited`);
  if (txtAdded) parts.push(`${txtAdded} paragraph${txtAdded > 1 ? 's' : ''} added`);
  if (txtRemoved) parts.push(`${txtRemoved} paragraph${txtRemoved > 1 ? 's' : ''} removed`);
  if (imgAdded) parts.push(`${imgAdded} image${imgAdded > 1 ? 's' : ''} added`);
  if (imgRemoved) parts.push(`${imgRemoved} image${imgRemoved > 1 ? 's' : ''} removed`);
  return parts.join(' · ');
}

function wordSet(text) {
  return new Set(String(text).toLowerCase().split(/\W+/).filter(Boolean));
}

// Jaccard overlap of word sets: how much two paragraphs have in common.
function similarity(a, b) {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  setA.forEach(word => { if (setB.has(word)) shared++; });
  return shared / (setA.size + setB.size - shared);
}

// A paragraph that had words added or reworded is ONE edit, not a delete plus an
// insert. Block keys are exact text, so LCS reports the old and new text as an
// unrelated removal and addition; pair them back up by word overlap so the client
// can render a word-level diff instead of two opaque blocks.
const SIMILARITY_THRESHOLD = 0.35;

function pairEditedBlocks(removed, added) {
  const takenAdded = new Set();
  const edited = [];

  removed.forEach((removedBlock, rIdx) => {
    if (removedBlock.type !== 'text') return;
    let bestIdx = -1;
    let bestScore = SIMILARITY_THRESHOLD;

    added.forEach((addedBlock, aIdx) => {
      if (takenAdded.has(aIdx) || addedBlock.type !== 'text') return;
      const score = similarity(removedBlock.text, addedBlock.text);
      if (score > bestScore) { bestScore = score; bestIdx = aIdx; }
    });

    if (bestIdx >= 0) {
      takenAdded.add(bestIdx);
      edited.push({ rIdx, aIdx: bestIdx, from: removedBlock.text, to: added[bestIdx].text });
    }
  });

  const pairedRemoved = new Set(edited.map(e => e.rIdx));
  return {
    edited: edited.map(e => ({ from: e.from, to: e.to })),
    removed: removed.filter((_, idx) => !pairedRemoved.has(idx)),
    added: added.filter((_, idx) => !takenAdded.has(idx)),
  };
}

function diffHtml(before, after) {
  const beforeBlocks = htmlToBlocks(before);
  const afterBlocks = htmlToBlocks(after);

  if (beforeBlocks.length + afterBlocks.length > MAX_BLOCKS) {
    return {
      kind: 'html',
      summary: `Content changed (too large for a block-level diff: ${beforeBlocks.length} → ${afterBlocks.length} blocks)`,
      truncated: true,
    };
  }

  const { removedIdx, addedIdx } = diffSequences(
    beforeBlocks.map(blockKey),
    afterBlocks.map(blockKey)
  );
  if (!removedIdx.length && !addedIdx.length) return null;

  // Embed a viewable copy of each changed image, within a budget, so "1 image
  // removed" can actually show which one. Anything over the caps degrades to a
  // placeholder rather than bloating the revision.
  let previewBudget = MAX_IMAGE_PREVIEW_TOTAL;
  const shrink = (block) => {
    if (block.type !== 'image') return { type: 'text', text: truncate(block.text, 400).text };
    let preview = block.src || '';
    if (!preview && block.dataUri
      && block.bytes <= MAX_IMAGE_PREVIEW_BYTES
      && block.bytes <= previewBudget) {
      preview = block.dataUri;
      previewBudget -= block.bytes;
    }
    return { type: 'image', bytes: block.bytes, src: preview };
  };

  const rawRemoved = removedIdx.map(i => shrink(beforeBlocks[i]));
  const rawAdded = addedIdx.map(i => shrink(afterBlocks[i]));
  const paired = pairEditedBlocks(rawRemoved, rawAdded);

  const cappedAdded = capList(paired.added);
  const cappedRemoved = capList(paired.removed);
  const cappedEdited = capList(paired.edited);

  return {
    kind: 'html',
    added: cappedAdded.items,
    removed: cappedRemoved.items,
    changed: cappedEdited.items,
    summary: summarizeBlocks(paired.added, paired.removed, paired.edited.length),
    truncated: cappedAdded.overflow > 0 || cappedRemoved.overflow > 0 || cappedEdited.overflow > 0,
  };
}

function diffStringList(before, after) {
  const beforeList = Array.isArray(before) ? before.map(String) : [];
  const afterList = Array.isArray(after) ? after.map(String) : [];
  const beforeSet = new Set(beforeList);
  const afterSet = new Set(afterList);
  const added = afterList.filter(v => !beforeSet.has(v));
  const removed = beforeList.filter(v => !afterSet.has(v));

  const reordered = !added.length && !removed.length
    && beforeList.join('\uE000') !== afterList.join('\uE000');
  if (!added.length && !removed.length && !reordered) return null;

  const parts = [];
  if (added.length) parts.push(`${added.length} added`);
  if (removed.length) parts.push(`${removed.length} removed`);
  if (reordered) parts.push('reordered');

  return {
    // Full list on both sides, not just the delta: screenshot paths and
    // combination names are short, so every version can show its whole state.
    before: capList(beforeList).items,
    after: capList(afterList).items,
    added: capList(added).items,
    removed: capList(removed).items,
    summary: parts.join(' · '),
  };
}

// Rows are matched on their feature name, so an edited cell reads as a change
// rather than one removal plus one addition.
function diffRows(before, after, columns = []) {
  const beforeRows = Array.isArray(before) ? before : [];
  const afterRows = Array.isArray(after) ? after : [];
  const keyOf = (row) => String((row && row.feature) || '').trim().toLowerCase();
  const beforeMap = new Map(beforeRows.map(r => [keyOf(r), r]));
  const afterMap = new Map(afterRows.map(r => [keyOf(r), r]));

  // Column headings are captured at write time so history keeps reading correctly
  // even after the matrix columns are later renamed.
  const columnName = (index) => String(columns[index] || `Column ${index + 1}`);

  const cellsBetween = (beforeRow, afterRow) => {
    const cells = [];
    const width = Math.max((beforeRow.values || []).length, (afterRow.values || []).length);
    for (let i = 0; i < width; i++) {
      const from = String((beforeRow.values || [])[i] ?? '');
      const to = String((afterRow.values || [])[i] ?? '');
      if (from !== to) cells.push({ index: i, column: columnName(i), from, to });
    }
    return cells;
  };

  let added = afterRows.filter(r => !beforeMap.has(keyOf(r)))
    .map(r => ({ feature: r.feature, values: r.values || [] }));
  let removed = beforeRows.filter(r => !afterMap.has(keyOf(r)))
    .map(r => ({ feature: r.feature, values: r.values || [] }));

  const changed = [];
  afterRows.forEach((afterRow) => {
    const beforeRow = beforeMap.get(keyOf(afterRow));
    if (!beforeRow) return;
    const cells = cellsBetween(beforeRow, afterRow);
    const beforeDesc = String(beforeRow.description || '');
    const afterDesc = String(afterRow.description || '');
    const descChanged = beforeDesc !== afterDesc;
    if (cells.length || descChanged) {
      changed.push({
        feature: afterRow.feature,
        cells,
        ...(descChanged ? {
          descriptionFrom: truncate(beforeDesc, 400).text,
          descriptionTo: truncate(afterDesc, 400).text,
        } : {}),
      });
    }
  });

  // Renaming a row's feature label looks like one row vanishing and another
  // appearing. Pair those back up so it reads as a rename.
  const renamed = [];
  const takenAdded = new Set();
  removed.forEach((removedRow, rIdx) => {
    let bestIdx = -1;
    let bestScore = 0.3;
    added.forEach((addedRow, aIdx) => {
      if (takenAdded.has(aIdx)) return;
      const sameValues = JSON.stringify(removedRow.values) === JSON.stringify(addedRow.values);
      const score = sameValues ? 1 : similarity(removedRow.feature, addedRow.feature);
      if (score > bestScore) { bestScore = score; bestIdx = aIdx; }
    });
    if (bestIdx >= 0) {
      takenAdded.add(bestIdx);
      const addedRow = added[bestIdx];
      renamed.push({
        from: removedRow.feature,
        to: addedRow.feature,
        cells: cellsBetween(removedRow, addedRow),
        _rIdx: rIdx,
      });
    }
  });
  const pairedRemoved = new Set(renamed.map(r => r._rIdx));
  renamed.forEach(r => { delete r._rIdx; });
  removed = removed.filter((_, idx) => !pairedRemoved.has(idx));
  added = added.filter((_, idx) => !takenAdded.has(idx));

  if (!added.length && !removed.length && !changed.length && !renamed.length) return null;

  const cellCount = changed.reduce((sum, row) => sum + row.cells.length, 0)
    + renamed.reduce((sum, row) => sum + row.cells.length, 0);
  const parts = [];
  if (cellCount) parts.push(`${cellCount} value${cellCount > 1 ? 's' : ''} changed`);
  if (renamed.length) parts.push(`${renamed.length} row${renamed.length > 1 ? 's' : ''} renamed`);
  if (added.length) parts.push(`${added.length} row${added.length > 1 ? 's' : ''} added`);
  if (removed.length) parts.push(`${removed.length} row${removed.length > 1 ? 's' : ''} removed`);

  return {
    added: capList(added).items,
    removed: capList(removed).items,
    changed: capList(changed).items,
    renamed: capList(renamed).items,
    summary: parts.join(' · '),
  };
}

// Compares two plain objects (lean docs) and returns the change list for a Revision.
function buildChanges(entityType, before, after) {
  const config = FIELD_CONFIG[entityType];
  if (!config || !before || !after) return [];

  const changes = [];
  Object.keys(config).forEach((field) => {
    // Only fields the write actually supplied are candidates.
    if (!(field in after)) return;
    const { label, kind } = config[field];
    const from = before[field];
    const to = after[field];

    if (kind === 'images') {
      const diff = diffStringList(from, to);
      if (diff) changes.push({ field, label, kind, ...diff });
      return;
    }
    if (kind === 'list') {
      const diff = diffStringList(from, to);
      if (diff) changes.push({ field, label, kind, ...diff });
      return;
    }
    if (kind === 'rows') {
      // Column headings come from the saved document so the labels are the ones
      // that were in force when the edit happened.
      const diff = diffRows(from, to, after.columns || before.columns || []);
      if (diff) changes.push({ field, label, kind, ...diff });
      return;
    }
    if (kind === 'html') {
      if (String(from || '') === String(to || '')) return;
      const diff = diffHtml(from, to);
      if (diff) changes.push({ field, label, ...diff });
      return;
    }
    if (kind === 'number') {
      if (Number(from || 0) === Number(to || 0)) return;
      changes.push({ field, label, kind, before: Number(from || 0), after: Number(to || 0) });
      return;
    }
    // text / longtext
    const fromStr = from == null ? '' : String(from);
    const toStr = to == null ? '' : String(to);
    if (fromStr === toStr) return;
    const a = truncate(fromStr);
    const b = truncate(toStr);
    changes.push({
      field, label, kind,
      before: a.text,
      after: b.text,
      truncated: a.truncated || b.truncated,
    });
  });

  return changes;
}

// The values a record starts life with, so a version chain can begin at "created".
// Oversized HTML and row sets are summarised instead of copied.
function buildInitialChanges(entityType, doc) {
  const config = FIELD_CONFIG[entityType];
  if (!config || !doc) return [];

  const changes = [];
  Object.keys(config).forEach((field) => {
    const { label, kind } = config[field];
    const value = doc[field];
    if (value === undefined || value === null) return;

    if (kind === 'images' || kind === 'list') {
      const list = Array.isArray(value) ? value.map(String) : [];
      if (!list.length) return;
      changes.push({ field, label, kind, after: capList(list).items });
      return;
    }
    if (kind === 'html') {
      const blocks = htmlToBlocks(value);
      if (!blocks.length) return;
      const texts = blocks.filter(b => b.type === 'text').length;
      const images = blocks.filter(b => b.type === 'image').length;
      changes.push({
        field, label, kind,
        summary: `${texts} paragraph${texts === 1 ? '' : 's'}`
          + (images ? `, ${images} image${images === 1 ? '' : 's'}` : ''),
      });
      return;
    }
    if (kind === 'rows') {
      const rows = Array.isArray(value) ? value : [];
      if (!rows.length) return;
      changes.push({ field, label, kind, summary: `${rows.length} row${rows.length === 1 ? '' : 's'}` });
      return;
    }
    if (kind === 'number') {
      changes.push({ field, label, kind, after: Number(value || 0) });
      return;
    }
    const str = String(value);
    if (!str) return;
    const capped = truncate(str);
    changes.push({ field, label, kind, after: capped.text, truncated: capped.truncated });
  });

  return changes;
}

module.exports = { buildChanges, buildInitialChanges, FIELD_CONFIG, htmlToBlocks };
