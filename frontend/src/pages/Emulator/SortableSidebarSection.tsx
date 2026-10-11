import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SortableSidebarSectionProps {
  id: string;
  title: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
  className?: string;
  isLast?: boolean;
}

// A collapsible sidebar section (Players / Notes) whose header doubles as a
// drag handle, so the sections can be reordered by clicking and holding the bar.
const SortableSidebarSection: React.FC<SortableSidebarSectionProps> = ({
  id,
  title,
  collapsed,
  onToggleCollapsed,
  children,
  className,
  isLast,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 2 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sidebar-sortable-section${isLast && !collapsed ? ' grow' : ''}${collapsed ? ' collapsed' : ''}${isDragging ? ' dragging' : ''}${className ? ` ${className}` : ''}`}
    >
      <div
        ref={setActivatorNodeRef}
        className="sidebar-section-header"
        {...attributes}
        {...listeners}
      >
        <h3 className="sidebar-section-title">{title}</h3>
        <button
          type="button"
          className="sidebar-toggle"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onToggleCollapsed}
          title={collapsed ? `Expand ${title.toLowerCase()}` : `Collapse ${title.toLowerCase()}`}
          aria-expanded={!collapsed}
        >
          {collapsed ? '+' : '\u2212'}
        </button>
      </div>
      {!collapsed && children}
    </div>
  );
};

export default SortableSidebarSection;
