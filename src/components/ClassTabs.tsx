import { useEffect, useRef, useState } from 'react';
import { MAX_CLASSES, MAX_CLASS_NAME, type ClassList } from '../storage';
import { CheckIcon, EditIcon, PlusIcon, TrashIcon } from './Icons';
import './ClassTabs.css';

interface Props {
  classes: ClassList[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Saved classes ("Period 1", "Period 2", ...). Each keeps its own list of
 * names, group setting and last results. Click a tab to switch; the pencil
 * on the active tab renames or deletes it.
 */
export function ClassTabs({ classes, activeId, onSelect, onAdd, onRename, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  function startEditing(c: ClassList) {
    setEditingId(c.id);
    setDraft(c.name);
  }

  function commit() {
    if (!editingId) return;
    const name = draft.replace(/\s+/g, ' ').trim().slice(0, MAX_CLASS_NAME);
    if (name) onRename(editingId, name);
    setEditingId(null);
  }

  return (
    <nav className="class-tabs" aria-label="Saved classes">
      <div className="class-tabs-scroll" role="tablist">
        {classes.map((c) => {
          const active = c.id === activeId;
          const editing = editingId === c.id;
          return (
            <div key={c.id} className={`class-tab${active ? ' active' : ''}${editing ? ' editing' : ''}`}>
              {editing ? (
                <form
                  className="class-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    commit();
                  }}
                >
                  <input
                    ref={inputRef}
                    value={draft}
                    maxLength={MAX_CLASS_NAME}
                    aria-label="Class name"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    data-testid="class-name-input"
                  />
                  <button type="submit" className="class-tab-icon" aria-label="Save name">
                    <CheckIcon size={15} />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    role="tab"
                    aria-selected={active}
                    className="class-tab-main"
                    onClick={() => (active ? startEditing(c) : onSelect(c.id))}
                    onDoubleClick={() => startEditing(c)}
                    title={active ? 'Click to rename' : `Switch to ${c.name}`}
                    data-testid="class-tab"
                  >
                    <span className="class-tab-name">{c.name}</span>
                    <span className="class-tab-count">{c.participants.length}</span>
                  </button>
                  {active && (
                    <span className="class-tab-actions">
                      <button className="class-tab-icon" onClick={() => startEditing(c)} aria-label={`Rename ${c.name}`}>
                        <EditIcon size={14} />
                      </button>
                      {classes.length > 1 && (
                        <button
                          className="class-tab-icon danger"
                          onClick={() => onDelete(c.id)}
                          aria-label={`Delete ${c.name}`}
                          data-testid="delete-class"
                        >
                          <TrashIcon size={14} />
                        </button>
                      )}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
        {classes.length < MAX_CLASSES && (
          <button className="class-add" onClick={onAdd} data-testid="add-class">
            <PlusIcon size={15} /> New period
          </button>
        )}
      </div>
    </nav>
  );
}
