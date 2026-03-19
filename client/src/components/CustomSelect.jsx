import { useState, useRef, useEffect } from 'react';

function CustomSelect({ value, onChange, options, placeholder = '-- Select --', disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selected = options.find(o => (typeof o === 'string' ? o : o.value) === value);
  const label = selected ? (typeof selected === 'string' ? selected : selected.label) : '';

  const handleSelect = (val) => {
    onChange({ target: { value: val } });
    setOpen(false);
  };

  return (
    <div className={`cselect ${open ? 'cselect-open' : ''} ${disabled ? 'cselect-disabled' : ''}`} ref={ref}>
      <button
        type="button"
        className="cselect-trigger"
        onClick={() => !disabled && setOpen(prev => !prev)}
        disabled={disabled}
      >
        <span className={`cselect-label ${!label ? 'cselect-placeholder' : ''}`}>
          {label || placeholder}
        </span>
        <svg className="cselect-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <ul className="cselect-menu">
          {placeholder && (
            <li
              className={`cselect-option cselect-option-placeholder ${value === '' ? 'cselect-option-selected' : ''}`}
              onClick={() => handleSelect('')}
            >
              {placeholder}
            </li>
          )}
          {options.map((opt, idx) => {
            const val = typeof opt === 'string' ? opt : opt.value;
            const lbl = typeof opt === 'string' ? opt : opt.label;
            const isActive = val === value;
            return (
              <li
                key={val + idx}
                className={`cselect-option ${isActive ? 'cselect-option-selected' : ''}`}
                onClick={() => handleSelect(val)}
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
        </ul>
      )}
    </div>
  );
}

export default CustomSelect;
