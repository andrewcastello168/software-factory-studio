import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Ellipsis, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Dialog, Input } from './Controls';

export interface Command {
  id: string;
  title: string;
  icon: LucideIcon;
  run: () => void;
}

export function CommandPalette({ commands, close }: { commands: Command[]; close: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const listId = useId();
  const matches = commands.filter((command) => command.title.toLowerCase().includes(query.trim().toLowerCase()));
  const current = matches[selected];
  const optionId = (command: Command) => `${listId}-${command.id}`;

  useEffect(() => { input.current?.focus(); }, []);

  function select(command: Command) {
    close();
    command.run();
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !matches.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelected((index) => (index + step + matches.length) % matches.length);
    }
    if (event.key === 'Enter' && current) {
      event.preventDefault();
      select(current);
    }
  }

  return (
    <Dialog title="Command palette" hideHeader className="palette" onClose={close}>
      <div className="palette-input">
        <Search size={18} aria-hidden="true" />
        <label htmlFor={inputId} className="sr-only">Search commands</label>
        <Input
          ref={input}
          id={inputId}
          role="combobox"
          aria-controls={listId}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={current ? optionId(current) : undefined}
          placeholder="Type a command…"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={navigate}
        />
        <Button onClick={close} className="key-button" aria-label="Close command palette">Esc</Button>
      </div>
      <ul id={listId} role="listbox" aria-label="Commands">
        {matches.map((command, index) => (
          <li
            key={command.id}
            id={optionId(command)}
            role="option"
            aria-selected={index === selected}
            onPointerMove={() => setSelected(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => select(command)}
          >
            <command.icon size={16} aria-hidden="true" /><span>{command.title}</span>
          </li>
        ))}
      </ul>
      {!matches.length && <p className="palette-empty" role="status">No matching commands.</p>}
      <div className="palette-footer"><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Run command</div>
    </Dialog>
  );
}

export function WorkspaceMenu({ commands }: { commands: Command[] }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);

  function close(restore = false) {
    if (menu.current) menu.current.open = false;
    if (restore) trigger.current?.focus();
  }

  return (
    <details
      ref={menu}
      className="workspace-menu"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') close(true); }}
    >
      <summary ref={trigger} className="button button--icon" aria-label="Workspace actions">
        <Ellipsis size={16} aria-hidden="true" />
      </summary>
      <div className="menu-popover">
        {commands.map((command) => (
          <Button key={command.id} onClick={() => { close(true); command.run(); }}>
            <command.icon size={15} aria-hidden="true" />{command.title}
          </Button>
        ))}
      </div>
    </details>
  );
}
