import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Maximize, Minus, Move, Plus, Save } from 'lucide-react';
import type { DatabaseSchema, SchemaPoint, SchemaTable } from '@factory/contracts';
import { Button, IconButton } from '../Controls';

const width = 215;
const rowHeight = 25;
const titleHeight = 38;
const bottom = 8;
const aspect = .51;
const height = (table: SchemaTable) => titleHeight + Math.max(1, table.columns.length) * rowHeight + bottom;
const bounded = (number: number) => Math.max(0, Math.min(6000, Math.round(number)));
const label = (value: string, limit: number) => value.length > limit ? value.slice(0, limit - 1) + '…' : value;

function positions(schema: DatabaseSchema, points: SchemaPoint[]) {
  const outer = new Map(points.map((point) => [point.table, point]));
  let y = 45;
  const placed = schema.tables.map((table, index) => {
    if (index > 0 && index % 3 === 0) y += Math.max(...schema.tables.slice(index - 3, index).map(height)) + 60;
    return { table, point: outer.get(table.name) ?? { table: table.name, x: 40 + index % 3 * 282, y } };
  });
  return placed;
}

export function Diagram({ schema, selected, select, layout, onLayout, save, busy }: {
  schema: DatabaseSchema; selected: string; select: (name: string) => void;
  layout: SchemaPoint[]; onLayout: (layout: SchemaPoint[]) => void; save: () => void; busy: boolean;
}) {
  const marker = useId();
  const grid = useId();
  const [view, setView] = useState({ x: 0, y: 0, width: 920 });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointer: number; table?: string; x: number; y: number; left: number; top: number; scale: number } | null>(null);
  const cards = positions(schema, layout);
  const byName = new Map(cards.map(({ table, point }) => [table.name, { table, point }]));
  const zoom = Math.round(920 / view.width * 100);
  const count = schema.tables.reduce((sum, table) => sum + table.constraints.filter((key) => key.kind === 'foreign').length, 0);

  function position(table: string, x: number, y: number) {
    const next = layout.filter((point) => point.table !== table);
    onLayout([...next, { table, x: bounded(x), y: bounded(y) }]);
  }
  function moveZoom(multiplier: number) {
    setView((current) => {
      const w = Math.round(Math.max(300, Math.min(6400, current.width * multiplier)));
      return { x: current.x + (current.width - w) / 2, y: current.y + (current.width - w) * .3, width: w };
    });
  }
  function fit() {
    const left = Math.min(40, ...cards.map(({ point }) => point.x)) - 25;
    const top = Math.min(40, ...cards.map(({ point }) => point.y)) - 25;
    const right = Math.max(0, ...cards.map(({ point }) => point.x + width)) + 30;
    const bottom = Math.max(0, ...cards.map(({ point, table }) => point.y + height(table))) + 25;
    setView({ x: left, y: top, width: Math.max(350, right - left, (bottom - top) / aspect) });
  }
  function start(event: PointerEvent<SVGElement>, point?: SchemaPoint) {
    if (event.button !== 0 || !svg.current) return;
    if (point) { event.stopPropagation(); select(point.table); }
    const scale = svg.current.getScreenCTM()?.a;
    if (!scale) return;
    drag.current = {
      pointer: event.pointerId, ...(point ? { table: point.table } : {}), x: event.clientX, y: event.clientY,
      left: point?.x ?? view.x, top: point?.y ?? view.y, scale,
    };
    svg.current.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const started = drag.current;
    if (!started || event.pointerId !== started.pointer) return;
    const dx = (event.clientX - started.x) / started.scale;
    const dy = (event.clientY - started.y) / started.scale;
    if (started.table) {
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || layout.some(({ table }) => table === started.table)) {
        position(started.table, started.left + dx, started.top + dy);
      }
    } else {
      setView((current) => ({ ...current, x: started.left - dx, y: started.top - dy }));
    }
  }
  function key(event: KeyboardEvent<SVGElement>, point?: SchemaPoint) {
    if (point && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopPropagation(); select(point.table); return;
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = arrows[event.key];
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 48 : 12;
    const [x, y] = direction;
    if (point) position(point.table, point.x + x * step, point.y + y * step);
    else setView((current) => ({ ...current, x: current.x + x * step, y: current.y + y * step }));
  }

  return <section className="schema-diagram" aria-label="Entity relationship diagram">
    <div className="schema-diagram-toolbar">
      <div><h3>Relationships</h3><small>{schema.tables.length} tables · {count} foreign keys</small></div>
      <div className="schema-tool-actions">
        <IconButton label="Zoom out" onClick={() => moveZoom(1.2)}><Minus size={15} /></IconButton>
        <span className="schema-zoom" aria-live="polite">{zoom}%</span>
        <IconButton label="Zoom in" onClick={() => moveZoom(1 / 1.2)}><Plus size={15} /></IconButton>
        <IconButton label="Fit all tables" onClick={fit}><Maximize size={14} /></IconButton>
        <Button disabled={busy || !layout.length} onClick={save}><Save size={14} />Save Layout</Button>
      </div>
    </div>
    <svg ref={svg} className="schema-canvas" viewBox={view.x + ' ' + view.y + ' ' + view.width + ' ' + view.width * aspect}
      aria-label="Schema diagram canvas" tabIndex={0} onKeyDown={key} onPointerDown={start}
      onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <defs>
        <pattern id={grid} width={20} height={20} patternUnits="userSpaceOnUse"><circle cx={2} cy={2} r={1} className="schema-grid-dot" /></pattern>
        <marker id={marker} markerWidth={7} markerHeight={7} refX={6} refY={3.5} orient="auto"><path d="M0,0 L7,3.5 L0,7z" className="schema-edge-tip" /></marker>
      </defs>
      <rect x={view.x} y={view.y} width={view.width} height={view.width * aspect} fill={'url(#' + grid + ')'} />
      {cards.flatMap(({ table, point }) => table.constraints.flatMap((constraint) => {
        if (constraint.kind !== 'foreign') return [];
        const target = byName.get(constraint.table);
        if (!target) return [];
        const startRight = target.point.x >= point.x;
        const x1 = point.x + (startRight ? width : 0);
        const x2 = target.point.x + (startRight && target.table !== table ? 0 : width);
        const offset = startRight ? 40 : -40;
        return constraint.columns.map((column, index) => {
          const y1 = point.y + titleHeight + Math.max(0, table.columns.findIndex(({ name }) => name === column)) * rowHeight + rowHeight / 2;
          const y2 = target.point.y + titleHeight + Math.max(0, target.table.columns.findIndex(({ name }) => name === constraint.references[index])) * rowHeight + rowHeight / 2;
          const c2 = target.table === table ? x2 + offset : x2 - offset;
          return <path key={table.name + '.' + constraint.name + '.' + column}
            d={`M ${x1} ${y1} C ${x1 + offset} ${y1}, ${c2} ${y2}, ${x2} ${y2}`}
            className="schema-edge" markerEnd={'url(#' + marker + ')'}>
            <title>{table.name}.{column} references {constraint.table}.{constraint.references[index]}</title>
          </path>;
        });
      }))}
      {cards.map(({ table, point }) => <g key={table.name} transform={`translate(${point.x} ${point.y})`} className="schema-node"
        data-selected={table.name === selected} aria-label={'Select table ' + table.name} aria-pressed={table.name === selected}
        role="button" tabIndex={0} onKeyDown={(event) => key(event, point)} onPointerDown={(event) => start(event, point)}>
        <rect width={width} height={height(table)} rx={4} className="schema-node-bg" />
        <path d={`M 4 1 H ${width - 4} Q ${width - 1} 1 ${width - 1} 4 V ${titleHeight} H 1 V 4 Q 1 1 4 1`} className="schema-node-head" />
        <text x={11} y={24} className="schema-node-title">{label(table.name, 24)}<title>{table.name}</title></text>
        <line x1={0} y1={titleHeight} x2={width} y2={titleHeight} className="schema-node-rule" />
        {table.columns.map((column, index) => {
          const primary = table.constraints.some((item) => item.kind === 'primary' && item.columns.includes(column.name));
          const foreign = table.constraints.some((item) => item.kind === 'foreign' && item.columns.includes(column.name));
          const y = titleHeight + index * rowHeight + 17;
          return <g key={column.name}>
            {(primary || foreign) && <text x={10} y={y} className="schema-node-key">{primary && foreign ? 'P/F' : primary ? 'PK' : 'FK'}</text>}
            <text x={35} y={y} className="schema-node-col">{label(column.name, 15)}<title>{column.name}</title></text>
            <text x={width - 10} y={y} textAnchor="end" className="schema-node-type">{column.type}</text>
          </g>;
        })}
      </g>)}
      {!cards.length && <text x={view.x + 30} y={view.y + 60} className="schema-node-col">Add tables to see their relationships.</text>}
    </svg>
    <p className="schema-diagram-help"><Move size={13} aria-hidden="true" /> Drag the canvas to pan. Drag a table or use its arrow keys to reposition it.</p>
  </section>;
}
