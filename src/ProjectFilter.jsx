import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Folder, Layers3 } from 'lucide-react';
import { useI18n } from './i18n.jsx';
import './project-filter.css';

const EXIT_MS = 150;
const projectColor = color => /^#[\da-f]{6}$/i.test(color || '') ? color : '#7a8f73';

function ProjectMark({ option }) {
  return <span className={`project-filter-mark ${option.kind || 'project'}`} aria-hidden="true">
    {option.kind === 'all' ? <Layers3 size={14} /> : option.kind === 'general' ? <Folder size={14} /> : <span />}
  </span>;
}

// Selection stays with the parent; the open menu only holds a temporary keyboard highlight.
export default function ProjectFilter({ value, projects, onChange, counts, disabled = false }) {
  const { t } = useI18n();
  const options = [
    { id: 'all', name: t('全部项目', 'All projects'), kind: 'all', color: 'var(--green)' },
    { id: 'general', name: t('常规', 'General'), kind: 'general', color: 'var(--orange)' },
    ...projects.map(project => ({ ...project, color: projectColor(project.color) })),
  ];
  const selectedIndex = Math.max(0, options.findIndex(option => option.id === value));
  const selected = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const typeaheadRef = useRef({ text: '', time: 0 });
  const optionRefs = useRef([]);
  const menuId = useId();
  const titleId = useId();
  const optionsKey = options.map(option => option.id).join('|');
  const highlighted = Math.min(activeIndex, options.length - 1);

  const close = (restoreFocus = false) => {
    setOpen(false);
    typeaheadRef.current = { text: '', time: 0 };
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const show = (index = selectedIndex) => {
    if (disabled) return;
    triggerRef.current?.focus({ preventScroll: true });
    setActiveIndex(index);
    setPresent(true);
    setOpen(true);
  };
  const choose = index => {
    const option = options[index];
    if (!option) return;
    close(true);
    onChange(option.id);
  };

  useEffect(() => {
    if (open || !present) return;
    const timer = window.setTimeout(() => { setPresent(false); setPosition(null); }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [value, optionsKey]); // A removed or externally changed project must not leave an invalid active descendant.

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useLayoutEffect(() => {
    if (!present) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 12;
      const gap = 9;
      const width = Math.min(Math.max(264, anchor.width), window.innerWidth - margin * 2);
      const expectedHeight = Math.min(358, listRef.current
        ? listRef.current.scrollHeight + (panelRef.current?.firstElementChild?.offsetHeight || 34) + 18
        : 55 + options.length * 45);
      const below = window.innerHeight - anchor.bottom - gap - margin;
      const above = anchor.top - gap - margin;
      const upwards = below < expectedHeight && above > below;
      const maxHeight = Math.max(60, Math.min(358, upwards ? above : below));
      const actualHeight = Math.min(expectedHeight, maxHeight);
      const next = {
        width, maxHeight, left: Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin)),
        top: Math.max(margin, upwards ? anchor.top - gap - actualHeight : anchor.bottom + gap),
        '--project-menu-origin': upwards ? 'bottom right' : 'top right',
      };
      setPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    place();
    const observer = new ResizeObserver(place);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [present, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = event => {
      if (!triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted]);

  function onKeyDown(event) {
    if (disabled) return;
    const { key } = event;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      if (key === 'Home') show(0);
      else if (key === 'End') show(options.length - 1);
      else if (!open) show(selectedIndex);
      else setActiveIndex(index => (index + (key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (open) choose(highlighted);
      else show();
    } else if (key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (key === 'Tab') {
      close();
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const previous = now - typeaheadRef.current.time < 700 ? typeaheadRef.current.text : '';
      const text = previous + key.toLocaleLowerCase();
      typeaheadRef.current = { text, time: now };
      const query = [...text].every(character => character === text[0]) ? text[0] : text;
      const start = open ? highlighted : selectedIndex;
      const order = [...options.slice(start + 1), ...options.slice(0, start + 1)];
      const match = order.find(option => option.name.toLocaleLowerCase().startsWith(query));
      if (match) show(options.indexOf(match));
    }
  }

  function moveLight(event) {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--project-light-x', `${event.clientX - box.left}px`);
    event.currentTarget.style.setProperty('--project-light-y', `${event.clientY - box.top}px`);
  }

  return <div className="project-filter" style={{ '--project-accent': selected.color }}>
    <button ref={triggerRef} type="button" id="task-project-filter" className="project-filter-trigger"
      role="combobox" aria-label={t('按项目筛选', 'Filter by project')} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? menuId : undefined} aria-autocomplete="none"
      aria-activedescendant={open ? `${menuId}-${highlighted}` : undefined}
      value={value} disabled={disabled} data-open={open} data-filtered={selected.id !== 'all'}
      title={selected.name} onPointerMove={moveLight} onKeyDown={onKeyDown}
      onClick={() => open ? close() : show()}>
      <ProjectMark option={selected} />
      <span key={selected.id} className="project-filter-label">{selected.name}</span>
      {Number.isFinite(counts?.[selected.id]) && <span className="project-filter-count">{counts[selected.id]}</span>}
      <ChevronDown className="project-filter-chevron" size={14} aria-hidden="true" />
    </button>
    {present && createPortal(<div ref={panelRef} className="project-filter-popover" data-open={open}
      data-testid="project-filter-popover" aria-hidden={!open} inert={!open}
      style={{ ...position, visibility: position ? undefined : 'hidden', '--project-accent': selected.color }}>
      <div className="project-filter-menu-heading" id={titleId}>{t('按项目筛选', 'Filter by project')}</div>
      <div ref={listRef} className="project-filter-options" id={menuId} role="listbox" aria-labelledby={titleId}>
        {options.map((option, index) => <div key={option.id} ref={node => { optionRefs.current[index] = node; }}
          id={`${menuId}-${index}`} role="option" aria-selected={option.id === selected.id}
          data-project-option={option.id} data-highlighted={index === highlighted}
          className="project-filter-option" style={{ '--project-accent': option.color }}
          onPointerMove={event => { setActiveIndex(index); moveLight(event); }}
          onPointerDown={event => { if (event.button === 0) event.preventDefault(); }}
          onClick={() => choose(index)}>
          <ProjectMark option={option} />
          <span className="project-filter-option-name">{option.name}</span>
          {Number.isFinite(counts?.[option.id]) && <span className="project-filter-option-count">{counts[option.id]}</span>}
          <Check className="project-filter-check" size={15} aria-hidden="true" />
        </div>)}
      </div>
    </div>, document.body)}
  </div>;
}
