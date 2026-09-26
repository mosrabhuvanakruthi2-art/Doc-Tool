import { useState, useRef, useEffect, useLayoutEffect } from 'react';

const MENU_MAX = 260;  // the list's normal max height
const MENU_MIN = 120;  // never squeeze it smaller than this
const GAP = 12;        // breathing room from the screen edge

// `searchable`: clicking the field turns it into a text box; typing filters the
// list, ↑/↓ move, Enter picks the highlighted option, Esc closes.
function CustomSelect({ value, onChange, options, placeholder = '-- Select --', disabled = false, searchable = false, searchPlaceholder = 'Type to search…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0); // highlighted option while searching
  const ref = useRef(null);
  const menuRef = useRef(null);
  // Where the list opens: below by default, above when there is more room there,
  // and never taller than the space on screen (it scrolls inside instead).
  const [place, setPlace] = useState({ up: false, maxH: MENU_MAX });

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useLayoutEffect(() => {
    if (!open || !ref.current) return undefined;
    const measure = () => {
      const r = ref.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP;
      const above = r.top - GAP;
      // The list's real height (capped), so a short list still opens below when it fits.
      const need = Math.min(MENU_MAX, menuRef.current ? menuRef.current.scrollHeight : MENU_MAX);
      const up = below < need && above > below;
      const room = up ? above : below;
      setPlace({ up, maxH: Math.max(MENU_MIN, Math.min(MENU_MAX, room)) });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true); // any scrolling container
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  // A fresh search every time the list opens.
  useEffect(() => { if (!open) { setQuery(''); setActive(0); } }, [open]);

  const selected = options.find(o => (typeof o === 'string' ? o : o.value) === value);
  const label = selected ? (typeof selected === 'string' ? selected : selected.label) : '';

  const norm = (opt) => ({ val: typeof opt === 'string' ? opt : opt.value, lbl: typeof opt === 'string' ? opt : opt.label });
  const q = query.trim().toLowerCase();
  const shown = searchable && q ? options.filter(o => String(norm(o).lbl).toLowerCase().includes(q)) : options;

  const handleSelect = (val) => {
    onChange({ target: { value: val } });
    setOpen(false);
  };

  // Keep the highlighted option in view while using the arrow keys.
  useEffect(() => {
    if (!open || !searchable || !menuRef.current) return;
    const el = menuRef.current.querySelector('.cselect-option-active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active, open, searchable]);

  const onSearchKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) handleSelect(norm(shown[active]).val); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  const arrow = (
    <svg className="cselect-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  return (
    <div className={`cselect ${open ? 'cselect-open' : ''} ${disabled ? 'cselect-disabled' : ''}`} ref={ref}>
      {searchable && open ? (
        <div className="cselect-trigger cselect-trigger-search">
          <input
            className="cselect-search-input"
            value={query}
            autoFocus
            placeholder={label || searchPlaceholder}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onSearchKey}
            aria-label={searchPlaceholder}
          />
          <button type="button" className="cselect-arrow-btn" onClick={() => setOpen(false)} aria-label="Close list">{arrow}</button>
        </div>
      ) : (
        <button
          type="button"
          className="cselect-trigger"
          onClick={() => !disabled && setOpen(prev => !prev)}
          disabled={disabled}
        >
          <span className={`cselect-label ${!label ? 'cselect-placeholder' : ''}`}>
            {label || placeholder}
          </span>
          {arrow}
        </button>
      )}
      {open && (
        <ul className={`cselect-menu${place.up ? ' cselect-menu-up' : ''}`} ref={menuRef} style={{ maxHeight: place.maxH }}>
          {/* The "-- Select --" row is left out of the searchable list (the field shows the hint). */}
          {placeholder && !searchable && (
            <li
              className={`cselect-option cselect-option-placeholder ${value === '' ? 'cselect-option-selected' : ''}`}
              onClick={() => handleSelect('')}
            >
              {placeholder}
            </li>
          )}
          {shown.map((opt, idx) => {
            const { val, lbl } = norm(opt);
            const isActive = val === value;
            const isHighlighted = searchable && q && idx === active;
            return (
              <li
                key={val + idx}
                className={`cselect-option ${isActive ? 'cselect-option-selected' : ''}${isHighlighted ? ' cselect-option-active' : ''}`}
                onClick={() => handleSelect(val)}
                onMouseEnter={() => { if (searchable) setActive(idx); }}
              >
                {isActive && (
                  <svg className="cselect-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span>{lbl}</span>
              </li>
            );
          })}
          {searchable && q && shown.length === 0 && (
            <li className="cselect-option cselect-option-empty">No match for “{query.trim()}”</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default CustomSelect;
