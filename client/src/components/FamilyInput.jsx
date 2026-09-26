import { useState, useRef, useEffect, useLayoutEffect } from 'react';

const MENU_MAX = 260;
const MENU_MIN = 120;
const GAP = 12;

// Family field: type freely, or pick one of the families that already exist.
// The list filters as you type; ↑/↓ move, Enter picks, Esc closes. A name that
// is not in the list is simply used as a new family.
export default function FamilyInput({ value, onChange, options = [], placeholder }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState({ up: false, maxH: MENU_MAX });
  const ref = useRef(null);
  const menuRef = useRef(null);

  const text = value || '';
  const q = text.trim().toLowerCase();
  const shown = options.filter((o) => !q || o.toLowerCase().includes(q));
  const isNew = !!q && !options.some((o) => o.toLowerCase() === q);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Open below, or above when there is more room there; never off screen.
  useLayoutEffect(() => {
    if (!open || !ref.current) return undefined;
    const measure = () => {
      const r = ref.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP;
      const above = r.top - GAP;
      const need = Math.min(MENU_MAX, menuRef.current ? menuRef.current.scrollHeight : MENU_MAX);
      const up = below < need && above > below;
      setPlace({ up, maxH: Math.max(MENU_MIN, Math.min(MENU_MAX, up ? above : below)) });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, shown.length]);

  useEffect(() => {
    if (!open || !menuRef.current) return;
    const el = menuRef.current.querySelector('.cselect-option-active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (name) => { onChange(name); setOpen(false); setActive(-1); };

  const onKeyDown = (e) => {
    if (!options.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && open && active >= 0 && shown[active]) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className={`cselect family-input${open ? ' cselect-open' : ''}`} ref={ref}>
      <input
        type="text"
        placeholder={placeholder}
        value={text}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {open && (shown.length > 0 || isNew) && (
        <ul className={`cselect-menu${place.up ? ' cselect-menu-up' : ''}`} ref={menuRef} style={{ maxHeight: place.maxH }}>
          {isNew && (
            <li className="cselect-option family-new-row" onClick={() => setOpen(false)}>
              <span className="family-new-plus">+</span> New family <strong>“{text.trim()}”</strong> will be created
            </li>
          )}
          {shown.map((name, idx) => (
            <li
              key={name}
              className={`cselect-option${name === text.trim() ? ' cselect-option-selected' : ''}${idx === active ? ' cselect-option-active' : ''}`}
              onClick={() => pick(name)}
              onMouseEnter={() => setActive(idx)}
            >
              <span>{name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
