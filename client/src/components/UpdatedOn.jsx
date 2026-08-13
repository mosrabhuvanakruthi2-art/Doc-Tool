import { useState } from 'react';
import RevisionDiffModal from './RevisionDiffModal';

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

// Mongoose writes the same instant to createdAt and updatedAt on insert, so an
// untouched record has identical stamps. Allow a second of slack anyway rather
// than calling a few stray milliseconds an "update".
const EDIT_TOLERANCE_MS = 1000;

export function resolveActivity(createdAt, updatedAt) {
  const created = toDate(createdAt);
  const updated = toDate(updatedAt);
  const date = updated || created;
  if (!date) return null;

  const wasEdited = created && updated && updated.getTime() - created.getTime() > EDIT_TOLERANCE_MS;
  return { date, verb: wasEdited ? 'Updated' : 'Created' };
}

export function formatActivityDate(date) {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

// "Created on <date>" as plain text until the record is edited; after that,
// "Updated on <date>" becomes a button that opens the diff against the previous
// version. Renders nothing without a usable timestamp, so callers can drop it in
// unconditionally.
function UpdatedOn({ createdAt, updatedAt, entityType, entityId, entityName, scope, scopeTitle }) {
  const [showDiff, setShowDiff] = useState(false);
  const activity = resolveActivity(createdAt, updatedAt);
  if (!activity) return null;

  const label = `${activity.verb} on ${formatActivityDate(activity.date)}`;
  // In scope mode the page holds many records, so history is worth opening even when
  // the newest event was a row being added rather than edited.
  const canShowDiff = scope
    ? true
    : activity.verb === 'Updated' && entityType && entityId;

  if (!canShowDiff) {
    return (
      <span className="page-updated-on" title={`${activity.verb} ${activity.date.toLocaleString()}`}>
        <ClockIcon />
        {label}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="page-updated-on page-updated-on-btn"
        onClick={() => setShowDiff(true)}
        title="See what changed"
      >
        <ClockIcon />
        {label}
      </button>
      {showDiff && (
        <RevisionDiffModal
          entityType={entityType}
          entityId={entityId}
          entityName={entityName}
          scope={scope}
          title={scopeTitle}
          onClose={() => setShowDiff(false)}
        />
      )}
    </>
  );
}

export default UpdatedOn;
