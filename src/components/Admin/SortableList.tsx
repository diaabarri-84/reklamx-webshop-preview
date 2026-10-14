import React, { useMemo } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * DRAG AND DROP, ONCE, FOR EVERY ORDERED LIST IN THE DASHBOARD.
 *
 * "هو اللي يتحكم في ترتيب العناصر ويحركهم براحته" — the owner wants to take a
 * row and put it where he wants it, not press an arrow twenty times. Every list
 * whose order reaches the customer uses this one component: the properties on a
 * product, the options inside a property, the questions inside an option, the
 * library, the images, the products in a category, the categories.
 *
 * How it behaves:
 *  - Only the GRIP starts a drag. A row is full of inputs, switches and buttons;
 *    a drag that could start anywhere would fight every one of them, and on a
 *    phone it would fight scrolling. The grip has `touch-action: none`, so a
 *    finger on it drags and a finger anywhere else scrolls.
 *  - The keyboard works: focus the grip, Space to lift, arrows to move, Space to
 *    drop, Escape to cancel. That is dnd-kit's keyboard sensor, not ours.
 *  - Long lists scroll by themselves while a row is dragged near the edge — the
 *    library has 178 properties.
 *  - Nothing is saved by dragging. The parent receives the new order of ids and
 *    decides, exactly as it did for the arrows; a product still saves with Save.
 *
 * Ids must be unique within one list. If they are not — old data can surprise —
 * the rows still render (same tree, so nothing remounts) but cannot be dragged,
 * rather than dragging the wrong row.
 */

export interface SortableHandle {
  ref: (element: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  /** False when this list cannot be dragged (duplicate ids, or disabled). */
  enabled: boolean;
}

interface SortableListProps {
  ids: string[];
  /** The full list of ids in its new order. Only called when something moved. */
  onReorder: (orderedIds: string[]) => void;
  renderItem: (id: string, ctx: { handle: SortableHandle; isDragging: boolean; index: number }) => React.ReactNode;
  /** 'list' for rows, 'grid' for tiles that wrap (images). */
  layout?: 'list' | 'grid';
  className?: string;
  disabled?: boolean;
  /**
   * What a screen reader calls a row while it is dragged. Without it dnd-kit
   * announces the raw id — "picked up draggable item __size__".
   */
  labelOf?: (id: string) => string;
}

export default function SortableList({
  ids,
  onReorder,
  renderItem,
  layout = 'list',
  className,
  disabled = false,
  labelOf,
}: SortableListProps) {
  const sensors = useSensors(
    // A few pixels of travel before it counts as a drag, so a click on the grip
    // (a focus, a tap) is not a reorder.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const unique = useMemo(() => new Set(ids).size === ids.length, [ids]);
  const canDrag = unique && !disabled && ids.length > 1;

  // THE SAME TREE whether or not the list can be dragged. It used to render a
  // plain list for one row (or duplicate ids) and the draggable one otherwise,
  // so adding a second option — or deleting down to one — remounted every row
  // and every editor inside it: focus, a half-typed price and an upload spinner
  // all lost. Now dragging is only switched off; duplicate ids get a private
  // suffix so the rows still have distinct keys.
  const sortableIds = useMemo(
    () => (unique ? ids : ids.map((id, i) => `${id}\u0000${i}`)),
    [ids, unique],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!canDrag) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  // The id a row carries may have the private duplicate suffix (above).
  const nameOf = (id: unknown) => (labelOf ? labelOf(String(id).split('\u0000')[0]) : String(id));
  const announcements = labelOf
    ? {
        onDragStart: ({ active }: { active: { id: unknown } }) => `Picked up ${nameOf(active.id)}.`,
        onDragOver: ({ active, over }: { active: { id: unknown }; over: { id: unknown } | null }) =>
          over ? `${nameOf(active.id)} is over ${nameOf(over.id)}.` : `${nameOf(active.id)} is no longer over a row.`,
        onDragEnd: ({ active, over }: { active: { id: unknown }; over: { id: unknown } | null }) =>
          over ? `${nameOf(active.id)} was dropped at the place of ${nameOf(over.id)}.` : `${nameOf(active.id)} was dropped.`,
        onDragCancel: ({ active }: { active: { id: unknown } }) => `Moving ${nameOf(active.id)} was cancelled.`,
      }
    : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={announcements ? { announcements } : undefined}
    >
      <SortableContext items={sortableIds} strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}>
        <div className={className}>
          {sortableIds.map((sortableId, index) => (
            <SortableRow
              key={sortableId}
              id={sortableId}
              itemId={ids[index]}
              index={index}
              enabled={canDrag}
              renderItem={renderItem}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  itemId,
  index,
  enabled,
  renderItem,
}: {
  id: string;
  itemId: string;
  index: number;
  enabled: boolean;
  renderItem: SortableListProps['renderItem'];
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !enabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 30 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-90 shadow-xl rounded-xl')}>
      {renderItem(itemId, {
        handle: { ref: setActivatorNodeRef, attributes, listeners, enabled },
        isDragging,
        index,
      })}
    </div>
  );
}

/** The grip a row is dragged by. Renders nothing when the list cannot drag. */
export function DragHandle({
  handle,
  label = 'Drag to reorder',
  className,
}: {
  handle: SortableHandle;
  label?: string;
  className?: string;
}) {
  if (!handle.enabled) return null;
  return (
    <button
      type="button"
      ref={handle.ref}
      {...handle.attributes}
      {...handle.listeners}
      aria-label={label}
      title={label}
      className={cn(
        'p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-grab active:cursor-grabbing touch-none shrink-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        className,
      )}
    >
      <GripVertical className="w-4 h-4" />
    </button>
  );
}

/** Re-exported for the screens that already import from here. */
export { reorderById } from '../../lib/reorder';
