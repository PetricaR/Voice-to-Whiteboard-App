import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CHART_CATEGORIES,
  CHART_CATALOG,
  HOLISTICS_DESIGN_PRINCIPLES,
  HOLISTICS_SHOWCASE_DASHBOARD,
  type ChartCategoryId,
  type ChartCatalogEntry,
} from '../../engine/chartCatalog';
import { Icon, IconButton, useStudio } from '../context';
import { closeTopLayerElement } from '../domTransitions';

export function ChartGalleryModal({
  open,
  onClose,
  onWidgetAdded,
}: {
  open: boolean;
  onClose: () => void;
  onWidgetAdded?: (widgetId: string) => void;
}) {
  const { store, notify } = useStudio();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedCategory, setSelectedCategory] = useState<'all' | ChartCategoryId>('all');
  const [search, setSearch] = useState('');
  const [showPrinciples, setShowPrinciples] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      el.removeAttribute('data-closing');
      if (!el.open) {
        try {
          el.showModal();
        } catch {
          el.setAttribute('open', '');
        }
      }
      return;
    }
    if (!el.open) return;
    let cancelled = false;
    void closeTopLayerElement(el, () => {
      if (!cancelled && el.open) el.close();
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredCharts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CHART_CATALOG.filter((c) => {
      if (selectedCategory !== 'all' && c.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.kind.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.whenToUse.toLowerCase().includes(q) ||
        c.sqlShapeHint.toLowerCase().includes(q)
      );
    });
  }, [selectedCategory, search]);

  const handleAddChart = (meta: ChartCatalogEntry) => {
    const sample = meta.sampleWidget;
    const newId = `${meta.kind}_${Date.now().toString(36).slice(-4)}`;
    const widgetPayload = {
      ...sample,
      id: newId,
    };

    if (store.scene.dashboard) {
      const res = store.editDashboard(
        {
          summary: `Added ${meta.label} chart`,
          add_widgets: [widgetPayload],
        },
        { source: 'manual', label: `Added ${meta.label}` },
      );
      if (res.ok) {
        notify(`Added “${sample.title}” (${meta.label}) to dashboard`);
        onClose();
        onWidgetAdded?.(res.changes.addedWidgets[0] ?? newId);
      }
    } else {
      const res = store.createDashboard(
        {
          title: `${meta.label} Studio`,
          subtitle: 'Interactive live SQLite-Wasm chart — customize every element in Chart Studio',
          source: 'local',
          widgets: [{ ...widgetPayload, colSpan: 12 }],
        },
        { source: 'manual', label: `Created ${meta.label} dashboard` },
      );
      if (res.ok) {
        notify(`Created dashboard with ${meta.label}`);
        onClose();
        onWidgetAdded?.(res.changes.addedWidgets[0] ?? newId);
      }
    }
  };

  const handleLoadShowcase = () => {
    store.createDashboard(HOLISTICS_SHOWCASE_DASHBOARD, {
      source: 'manual',
      label: 'Loaded Holistics 8-Family Showcase Dashboard',
    });
    notify('Loaded Holistics 8-Family Data Storytelling Showcase');
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog chart-gallery-dialog"
      aria-labelledby="chart-gallery-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <header className="gallery-header">
        <div>
          <span className="inspector-eyebrow">Holistics Data Storytelling Taxonomy</span>
          <h2 id="chart-gallery-title">48 Chart Types &amp; Element Builder</h2>
        </div>
        <div className="gallery-head-actions">
          <button
            type="button"
            className="tonal-btn small"
            onClick={() => setShowPrinciples((v) => !v)}
          >
            <Icon name="auto_awesome_mosaic" size={16} />
            <span>{showPrinciples ? 'Hide' : '6 Design Principles'}</span>
          </button>
          <button type="button" className="filled-btn compact" onClick={handleLoadShowcase}>
            <Icon name="dashboard" size={16} />
            <span>Load 8-Family Showcase</span>
          </button>
          <IconButton icon="close" label="Close chart gallery" onClick={onClose} />
        </div>
      </header>

      {showPrinciples && (
        <section className="principles-strip" aria-label="6 Dashboard Design Principles">
          {HOLISTICS_DESIGN_PRINCIPLES.map((p) => (
            <div key={p.id} className="principle-card">
              <strong>{p.title}</strong>
              <p>{p.detail}</p>
            </div>
          ))}
        </section>
      )}

      <div className="gallery-toolbar">
        <input
          type="search"
          className="ctrl-input gallery-search"
          placeholder="Search 48 chart types by name, data shape, or storytelling goal (e.g. waterfall, sankey, candlestick, violin, map)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="gallery-cat-pills" role="tablist" aria-label="Chart categories">
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === 'all'}
            className={`gallery-cat-btn${selectedCategory === 'all' ? ' active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            All ({CHART_CATALOG.length})
          </button>
          {CHART_CATEGORIES.map((cat) => {
            const cnt = CHART_CATALOG.filter((c) => c.category === cat.id).length;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={selectedCategory === cat.id}
                className={`gallery-cat-btn${selectedCategory === cat.id ? ' active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                <Icon name={cat.icon} size={15} />
                <span>{cat.label} ({cnt})</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="gallery-grid">
        {filteredCharts.map((meta) => (
          <article key={meta.kind} className="gallery-card">
            <div className="gallery-card-head">
              <span className="gallery-icon-badge">
                <Icon name={meta.icon} size={20} />
              </span>
              <div className="gallery-card-titles">
                <h3>{meta.label}</h3>
                <code>{meta.kind}</code>
              </div>
              <button
                type="button"
                className="tonal-btn compact"
                onClick={() => handleAddChart(meta)}
              >
                <Icon name="add" size={16} /> Add Chart
              </button>
            </div>
            <p className="gallery-card-summary">{meta.summary}</p>
            <div className="gallery-card-rules">
              <p><strong>When to use:</strong> {meta.whenToUse}</p>
              <p><strong>Watch out:</strong> {meta.avoidWhen}</p>
            </div>
            <div className="gallery-card-foot">
              <span className="gallery-sql-shape" title="Expected SQL column structure">
                SQL: <code>{meta.sqlShapeHint}</code>
              </span>
            </div>
          </article>
        ))}
        {filteredCharts.length === 0 && (
          <div className="widget-empty">No chart types matched “{search}”.</div>
        )}
      </div>
    </dialog>
  );
}
