import { useState } from 'react';
import {
  CHART_CATEGORIES,
  CHART_CATALOG,
  getChartMeta,
} from '../../engine/chartCatalog';
import {
  AXIS_SCALES,
  CARD_BACKGROUNDS,
  CARD_BORDERS,
  CARD_PADDINGS,
  CHART_ORIENTATIONS,
  CHART_PALETTES,
  COL_SPANS,
  CURVE_TYPES,
  DATA_LABEL_CONTENTS,
  DATA_LABEL_POSITIONS,
  FONT_FAMILIES,
  LEGEND_POSITIONS,
  LINE_STYLES,
  MAP_SCOPES,
  MARKER_SHAPES,
  SORT_MODES,
  STACK_MODES,
  TITLE_SIZES,
  VALUE_FORMATS,
  type ChartAnnotation,
  type ChartElementConfig,
  type ChartReferenceBand,
  type ChartReferenceLine,
  type DashboardWidget,
  type ValueFormat,
  type WidgetKind,
} from '../../engine/dashboard';
import { COLORS, type ColorName } from '../../engine/types';
import { Icon, useStudio } from '../context';
import { PALETTE_SWATCHES } from './chartLayouts';

export type InspectorControlTab = 'type' | 'axes' | 'style' | 'overlays';

export function ChartControlsPanel({
  widget,
  tab,
  availableColumns,
}: {
  widget: DashboardWidget;
  tab: InspectorControlTab;
  availableColumns: string[];
}) {
  const { store, notify } = useStudio();
  const [kindFilter, setKindFilter] = useState('');
  const [showSpecialFields, setShowSpecialFields] = useState(false);

  // Drafts for adding reference lines, bands, and annotations
  const [newRefVal, setNewRefVal] = useState('100');
  const [newRefLabel, setNewRefLabel] = useState('Target');
  const [newBandFrom, setNewBandFrom] = useState('0');
  const [newBandTo, setNewBandTo] = useState('100');
  const [newBandLabel, setNewBandLabel] = useState('SLA Zone');
  const [newAnnText, setNewAnnText] = useState('Key milestone');
  const [newAnnTarget, setNewAnnTarget] = useState('');

  const cfg: ChartElementConfig = widget.chartConfig ?? {};
  const activeMeta = getChartMeta(widget.kind);

  const patchWidget = (patch: Record<string, unknown>, label = `Updated ${widget.title}`) => {
    store.editDashboard(
      {
        summary: label,
        update_widgets: [{ id: widget.id, ...patch }],
      },
      { source: 'manual', label },
    );
  };

  const patchConfig = (cfgPatch: Partial<ChartElementConfig>, label = `Styled ${widget.title}`) => {
    patchWidget({ chart_config: cfgPatch }, label);
  };

  const resetAllConfig = () => {
    patchWidget({ reset_chart_config: true }, `Reset chart styling on “${widget.title}”`);
    notify(`Reset all chart element customizations on “${widget.title}”`);
  };

  const renderColSelect = (
    label: string,
    fieldKey: string,
    currentVal: string | undefined,
    placeholder = 'Auto-detect',
  ) => (
    <label className="ctrl-field">
      <span>{label}</span>
      <select
        className="ctrl-select"
        value={currentVal ?? ''}
        onChange={(e) => patchWidget({ [fieldKey]: e.target.value })}
      >
        <option value="">{placeholder}</option>
        {availableColumns.map((col) => (
          <option key={col} value={col}>
            {col}
          </option>
        ))}
      </select>
    </label>
  );

  // =========================================================================
  // TAB 1: CHART TYPE, DATA BINDINGS & SHAPING
  // =========================================================================
  if (tab === 'type') {
    const q = kindFilter.trim().toLowerCase();
    return (
      <div className="chart-controls-stack">
        {/* Active Chart Storytelling Guidance Card */}
        <div className="ctrl-guidance-card">
          <div className="ctrl-guidance-head">
            <Icon name={activeMeta.icon} size={18} />
            <strong>{activeMeta.label}</strong>
            <span className="ctrl-cat-tag">{activeMeta.category}</span>
          </div>
          <p className="ctrl-guidance-summary">{activeMeta.summary}</p>
          <div className="ctrl-guidance-tips">
            <span><strong>Best when:</strong> {activeMeta.whenToUse}</span>
            <span><strong>Avoid when:</strong> {activeMeta.avoidWhen}</span>
          </div>
        </div>

        {/* Searchable 48-Chart Type Selector */}
        <section className="ctrl-section">
          <div className="ctrl-section-head">
            <h3>48 Chart Types (Holistics Taxonomy)</h3>
            <input
              type="search"
              className="ctrl-input compact"
              placeholder="Filter 48 chart types…"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
            />
          </div>
          <div className="ctrl-kind-groups">
            {CHART_CATEGORIES.map((cat) => {
              const kinds = CHART_CATALOG.filter(
                (m) =>
                  m.category === cat.id &&
                  (!q ||
                    m.label.toLowerCase().includes(q) ||
                    m.kind.includes(q) ||
                    m.summary.toLowerCase().includes(q)),
              );
              if (kinds.length === 0) return null;
              return (
                <div key={cat.id} className="ctrl-kind-cat">
                  <span className="ctrl-kind-cat-title">{cat.label}</span>
                  <div className="ctrl-kind-grid">
                    {kinds.map((m) => (
                      <button
                        key={m.kind}
                        type="button"
                        className={`ctrl-kind-chip${widget.kind === m.kind ? ' active' : ''}`}
                        onClick={() => patchWidget({ kind: m.kind as WidgetKind }, `Changed ${widget.title} to ${m.label}`)}
                        title={m.summary}
                      >
                        <Icon name={m.icon} size={15} />
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Widget Titles & Grid Width */}
        <section className="ctrl-section">
          <h3>Header &amp; Grid Span</h3>
          <div className="ctrl-grid-2">
            <label className="ctrl-field full">
              <span>Chart Title</span>
              <input
                type="text"
                className="ctrl-input"
                value={widget.title}
                onChange={(e) => patchWidget({ title: e.target.value })}
              />
            </label>
            <label className="ctrl-field full">
              <span>Subtitle</span>
              <input
                type="text"
                className="ctrl-input"
                value={widget.subtitle ?? ''}
                placeholder="Context or timeframe…"
                onChange={(e) => patchWidget({ subtitle: e.target.value })}
              />
            </label>
            <label className="ctrl-field">
              <span>Grid Width (12-col)</span>
              <select
                className="ctrl-select"
                value={widget.colSpan}
                onChange={(e) => patchWidget({ col_span: Number(e.target.value) })}
              >
                {COL_SPANS.map((sp) => (
                  <option key={sp} value={sp}>
                    {sp} columns ({Math.round((sp / 12) * 100)}%)
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* SQL Column Bindings */}
        <section className="ctrl-section">
          <div className="ctrl-section-head">
            <h3>Column Bindings</h3>
            <span className="ctrl-hint">SQL shape: {activeMeta.sqlShapeHint}</span>
          </div>
          <div className="ctrl-grid-2">
            {renderColSelect('X / Category / Stage', 'x_field', widget.xField)}
            {renderColSelect('Series / Group / Target', 'series_field', widget.seriesField, 'None')}
            {renderColSelect('Comparison / Goal Col', 'comparison_field', widget.comparisonField, 'None')}
          </div>

          {availableColumns.length > 0 && (
            <div className="ctrl-field">
              <span>Y Metric Columns (toggle one or multiple)</span>
              <div className="ctrl-chip-wrap">
                {availableColumns.map((col) => {
                  const selected = widget.yFields?.includes(col) ?? false;
                  return (
                    <button
                      key={col}
                      type="button"
                      className={`ctrl-mini-chip${selected ? ' active' : ''}`}
                      onClick={() => {
                        const cur = widget.yFields ?? [];
                        const next = selected ? cur.filter((c) => c !== col) : [...cur, col];
                        patchWidget({ y_fields: next });
                      }}
                    >
                      {col}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            className="text-btn small"
            onClick={() => setShowSpecialFields((v) => !v)}
          >
            <Icon name={showSpecialFields ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={16} />
            {showSpecialFields ? 'Hide' : 'Show'} specialized bindings (OHLC, Gantt, Geo, Hierarchy, Bubble)
          </button>

          {showSpecialFields && (
            <div className="ctrl-grid-2">
              {renderColSelect('Bubble Size Col', 'size_field', widget.sizeField, 'Auto')}
              {renderColSelect('Parent / Hierarchy Col', 'parent_field', widget.parentField, 'Auto')}
              {renderColSelect('Candlestick Open', 'open_field', widget.openField, 'Auto')}
              {renderColSelect('Candlestick High', 'high_field', widget.highField, 'Auto')}
              {renderColSelect('Candlestick Low', 'low_field', widget.lowField, 'Auto')}
              {renderColSelect('Candlestick Close', 'close_field', widget.closeField, 'Auto')}
              {renderColSelect('Gantt Start Col', 'start_field', widget.startField, 'Auto')}
              {renderColSelect('Gantt End Col', 'end_field', widget.endField, 'Auto')}
              {renderColSelect('Gantt Progress %', 'progress_field', widget.progressField, 'Auto')}
              {renderColSelect('Origin Latitude', 'lat_field', widget.latField, 'Auto')}
              {renderColSelect('Origin Longitude', 'lon_field', widget.lonField, 'Auto')}
              {renderColSelect('Dest Latitude', 'dest_lat_field', widget.destLatField, 'Auto')}
              {renderColSelect('Dest Longitude', 'dest_lon_field', widget.destLonField, 'Auto')}
            </div>
          )}
        </section>

        {/* Data Shaping & Orientation */}
        <section className="ctrl-section">
          <h3>Data Shaping &amp; Orientation</h3>
          <div className="ctrl-grid-2">
            <label className="ctrl-field">
              <span>Orientation</span>
              <select
                className="ctrl-select"
                value={cfg.orientation ?? 'auto'}
                onChange={(e) => patchConfig({ orientation: e.target.value as ChartElementConfig['orientation'] })}
              >
                {CHART_ORIENTATIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Stacking Mode</span>
              <select
                className="ctrl-select"
                value={cfg.stackMode ?? 'none'}
                onChange={(e) => patchConfig({ stackMode: e.target.value as ChartElementConfig['stackMode'] })}
              >
                {STACK_MODES.map((s) => (
                  <option key={s} value={s}>
                    {s === 'percent_100' ? '100% Stacked' : s}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Sort Order</span>
              <select
                className="ctrl-select"
                value={cfg.sortBy ?? 'none'}
                onChange={(e) => patchConfig({ sortBy: e.target.value as ChartElementConfig['sortBy'] })}
              >
                {SORT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Max Items / Top-N</span>
              <input
                type="number"
                min={1}
                max={200}
                className="ctrl-input"
                placeholder="Default"
                value={cfg.limitItems ?? ''}
                onChange={(e) =>
                  patchConfig({
                    limitItems: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)),
                  })
                }
              />
            </label>
          </div>
          <label className="ctrl-check">
            <input
              type="checkbox"
              checked={Boolean(cfg.groupTailAsOther)}
              onChange={(e) => patchConfig({ groupTailAsOther: e.target.checked })}
            />
            <span>Aggregate overflow items into an “Other” bucket (Holistics Top-N rule)</span>
          </label>
        </section>
      </div>
    );
  }

  // =========================================================================
  // TAB 2: AXES, SCALES, GRIDLINES & PLOT MARGINS
  // =========================================================================
  if (tab === 'axes') {
    return (
      <div className="chart-controls-stack">
        {/* X-Axis */}
        <section className="ctrl-section">
          <h3>X-Axis (Horizontal / Domain)</h3>
          <div className="ctrl-row-checks">
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.showXAxis !== false}
                onChange={(e) => patchConfig({ showXAxis: e.target.checked })}
              />
              <span>Show X-Axis</span>
            </label>
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.showXTicks !== false}
                onChange={(e) => patchConfig({ showXTicks: e.target.checked })}
              />
              <span>Show X Ticks</span>
            </label>
          </div>
          <div className="ctrl-grid-2">
            <label className="ctrl-field full">
              <span>X-Axis Title</span>
              <input
                type="text"
                className="ctrl-input"
                placeholder="e.g. Billing Month"
                value={cfg.xAxisTitle ?? ''}
                onChange={(e) => patchConfig({ xAxisTitle: e.target.value })}
              />
            </label>
            <label className="ctrl-field">
              <span>X Scale</span>
              <select
                className="ctrl-select"
                value={cfg.xAxisScale ?? 'auto'}
                onChange={(e) => patchConfig({ xAxisScale: e.target.value as ChartElementConfig['xAxisScale'] })}
              >
                {AXIS_SCALES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Tick Label Rotation</span>
              <select
                className="ctrl-select"
                value={cfg.xTickRotation ?? 0}
                onChange={(e) =>
                  patchConfig({ xTickRotation: Number(e.target.value) as ChartElementConfig['xTickRotation'] })
                }
              >
                <option value={0}>0° (Horizontal)</option>
                <option value={-30}>-30° Angled</option>
                <option value={-45}>-45° Diagonal</option>
                <option value={-90}>-90° Vertical</option>
                <option value={45}>+45° Diagonal</option>
              </select>
            </label>
            <label className="ctrl-field">
              <span>Max X Ticks</span>
              <input
                type="number"
                min={2}
                max={24}
                className="ctrl-input"
                placeholder="Auto"
                value={cfg.xTickMaxCount ?? ''}
                onChange={(e) =>
                  patchConfig({ xTickMaxCount: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </label>
            <label className="ctrl-field">
              <span>Label Truncate (chars)</span>
              <input
                type="number"
                min={3}
                max={40}
                className="ctrl-input"
                placeholder="11"
                value={cfg.xTickTruncate ?? ''}
                onChange={(e) =>
                  patchConfig({ xTickTruncate: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </label>
          </div>
        </section>

        {/* Y-Axis */}
        <section className="ctrl-section">
          <h3>Y-Axis (Vertical / Metric Scale)</h3>
          <div className="ctrl-row-checks">
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.showYAxis !== false}
                onChange={(e) => patchConfig({ showYAxis: e.target.checked })}
              />
              <span>Show Y-Axis</span>
            </label>
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.showYTicks !== false}
                onChange={(e) => patchConfig({ showYTicks: e.target.checked })}
              />
              <span>Show Y Ticks</span>
            </label>
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.startFromZero ?? (widget.kind !== 'line' && widget.kind !== 'scatter')}
                onChange={(e) => patchConfig({ startFromZero: e.target.checked })}
              />
              <span>Zero Baseline</span>
            </label>
          </div>
          <div className="ctrl-grid-2">
            <label className="ctrl-field full">
              <span>Y-Axis Title</span>
              <input
                type="text"
                className="ctrl-input"
                placeholder="e.g. Revenue (USD)"
                value={cfg.yAxisTitle ?? ''}
                onChange={(e) => patchConfig({ yAxisTitle: e.target.value })}
              />
            </label>
            <label className="ctrl-field">
              <span>Y Position</span>
              <select
                className="ctrl-select"
                value={cfg.yAxisPosition ?? 'left'}
                onChange={(e) => patchConfig({ yAxisPosition: e.target.value as 'left' | 'right' })}
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="ctrl-field">
              <span>Y Scale</span>
              <select
                className="ctrl-select"
                value={cfg.yAxisScale ?? 'linear'}
                onChange={(e) => patchConfig({ yAxisScale: e.target.value as 'linear' | 'log' | 'sqrt' })}
              >
                <option value="linear">Linear</option>
                <option value="log">Logarithmic (log10)</option>
                <option value="sqrt">Square Root (sqrt)</option>
              </select>
            </label>
            <label className="ctrl-field">
              <span>Y Min Override</span>
              <input
                type="number"
                className="ctrl-input"
                placeholder="Auto"
                value={cfg.yMin ?? ''}
                onChange={(e) =>
                  patchConfig({ yMin: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </label>
            <label className="ctrl-field">
              <span>Y Max Override</span>
              <input
                type="number"
                className="ctrl-input"
                placeholder="Auto"
                value={cfg.yMax ?? ''}
                onChange={(e) =>
                  patchConfig({ yMax: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </label>
            <label className="ctrl-field">
              <span>Y Tick Count</span>
              <input
                type="number"
                min={2}
                max={12}
                className="ctrl-input"
                value={cfg.yTickCount ?? 3}
                onChange={(e) => patchConfig({ yTickCount: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Y Tick Format</span>
              <select
                className="ctrl-select"
                value={cfg.yAxisFormat ?? 'compact'}
                onChange={(e) => patchConfig({ yAxisFormat: e.target.value as ValueFormat })}
              >
                {VALUE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* Gridlines & Plot Margins */}
        <section className="ctrl-section">
          <h3>Gridlines &amp; Plot Margins</h3>
          <div className="ctrl-row-checks">
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.showHorizontalGrid !== false}
                onChange={(e) => patchConfig({ showHorizontalGrid: e.target.checked })}
              />
              <span>Horizontal Grid</span>
            </label>
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={Boolean(cfg.showVerticalGrid)}
                onChange={(e) => patchConfig({ showVerticalGrid: e.target.checked })}
              />
              <span>Vertical Grid</span>
            </label>
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={Boolean(cfg.showPlotBorder)}
                onChange={(e) => patchConfig({ showPlotBorder: e.target.checked })}
              />
              <span>Plot Frame Border</span>
            </label>
          </div>
          <div className="ctrl-grid-2">
            <label className="ctrl-field">
              <span>Grid Line Style</span>
              <select
                className="ctrl-select"
                value={cfg.gridStyle ?? 'dashed'}
                onChange={(e) => patchConfig({ gridStyle: e.target.value as ChartElementConfig['gridStyle'] })}
              >
                {LINE_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Grid Opacity ({Math.round((cfg.gridOpacity ?? 0.5) * 100)}%)</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={cfg.gridOpacity ?? 0.5}
                onChange={(e) => patchConfig({ gridOpacity: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Top Margin (px)</span>
              <input
                type="number"
                min={0}
                max={140}
                className="ctrl-input"
                placeholder="Auto"
                value={cfg.plotPaddingTop ?? ''}
                onChange={(e) =>
                  patchConfig({ plotPaddingTop: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </label>
            <label className="ctrl-field">
              <span>Right Margin (px)</span>
              <input
                type="number"
                min={0}
                max={160}
                className="ctrl-input"
                placeholder="Auto"
                value={cfg.plotPaddingRight ?? ''}
                onChange={(e) =>
                  patchConfig({ plotPaddingRight: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </label>
            <label className="ctrl-field">
              <span>Bottom Margin (px)</span>
              <input
                type="number"
                min={0}
                max={140}
                className="ctrl-input"
                placeholder="Auto"
                value={cfg.plotPaddingBottom ?? ''}
                onChange={(e) =>
                  patchConfig({ plotPaddingBottom: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </label>
            <label className="ctrl-field">
              <span>Left Margin (px)</span>
              <input
                type="number"
                min={0}
                max={180}
                className="ctrl-input"
                placeholder="Auto"
                value={cfg.plotPaddingLeft ?? ''}
                onChange={(e) =>
                  patchConfig({ plotPaddingLeft: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </label>
          </div>
        </section>
      </div>
    );
  }

  // =========================================================================
  // TAB 3: COLORS, SERIES GEOMETRY & CARD TYPOGRAPHY / FRAME
  // =========================================================================
  if (tab === 'style') {
    return (
      <div className="chart-controls-stack">
        {/* Palettes & Color Encoding */}
        <section className="ctrl-section">
          <div className="ctrl-section-head">
            <h3>Color Palette &amp; Fills</h3>
            <button type="button" className="text-btn small" onClick={resetAllConfig}>
              <Icon name="restart_alt" size={15} /> Reset Styling
            </button>
          </div>

          <div className="ctrl-palette-grid">
            {CHART_PALETTES.map((pal) => {
              const swatches = PALETTE_SWATCHES[pal];
              return (
                <button
                  key={pal}
                  type="button"
                  className={`ctrl-palette-btn${(cfg.palette ?? 'brand') === pal ? ' active' : ''}`}
                  onClick={() => patchConfig({ palette: pal })}
                >
                  <span className="palette-dots">
                    {swatches.slice(0, 5).map((sw, i) => (
                      <i key={i} style={{ background: sw }} />
                    ))}
                  </span>
                  <span>{pal.replace('_', ' ')}</span>
                </button>
              );
            })}
          </div>

          <div className="ctrl-grid-2">
            <label className="ctrl-field">
              <span>Primary Accent Tone</span>
              <select
                className="ctrl-select"
                value={widget.color ?? ''}
                onChange={(e) =>
                  patchWidget({ color: (e.target.value || undefined) as ColorName | undefined })
                }
              >
                <option value="">Palette Default</option>
                {COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Color Encoding Mode</span>
              <select
                className="ctrl-select"
                value={cfg.colorBy ?? 'series'}
                onChange={(e) => patchConfig({ colorBy: e.target.value as 'series' | 'category' | 'value' })}
              >
                <option value="series">By Series (Clean single-hue bars)</option>
                <option value="category">By Category (Multi-color bars)</option>
                <option value="value">By Value Intensity</option>
              </select>
            </label>
            <label className="ctrl-field full">
              <span>Custom Hex / CSS Colors (comma-separated)</span>
              <input
                type="text"
                className="ctrl-input"
                placeholder="#2563eb, #0d9488, #f59e0b"
                value={(cfg.customColors ?? []).join(', ')}
                onChange={(e) => {
                  const arr = e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  patchConfig({ customColors: arr });
                }}
              />
            </label>
            <label className="ctrl-field">
              <span>Fill Opacity ({Math.round((cfg.fillOpacity ?? 0.9) * 100)}%)</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={cfg.fillOpacity ?? 0.9}
                onChange={(e) => patchConfig({ fillOpacity: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-check" style={{ alignSelf: 'end', paddingBottom: 6 }}>
              <input
                type="checkbox"
                checked={cfg.gradientFill ?? widget.kind === 'area'}
                onChange={(e) => patchConfig({ gradientFill: e.target.checked })}
              />
              <span>Gradient Fill</span>
            </label>
          </div>
        </section>

        {/* Series Geometry: Lines & Markers */}
        <section className="ctrl-section">
          <h3>Lines, Curves &amp; Point Markers</h3>
          <div className="ctrl-grid-2">
            <label className="ctrl-field">
              <span>Curve Interpolation</span>
              <select
                className="ctrl-select"
                value={cfg.curveType ?? 'linear'}
                onChange={(e) => patchConfig({ curveType: e.target.value as ChartElementConfig['curveType'] })}
              >
                {CURVE_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Stroke Style</span>
              <select
                className="ctrl-select"
                value={cfg.lineStyle ?? 'solid'}
                onChange={(e) => patchConfig({ lineStyle: e.target.value as ChartElementConfig['lineStyle'] })}
              >
                {LINE_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Stroke Width ({cfg.strokeWidth ?? 2.5}px)</span>
              <input
                type="range"
                min={0.5}
                max={8}
                step={0.5}
                value={cfg.strokeWidth ?? 2.5}
                onChange={(e) => patchConfig({ strokeWidth: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Marker Shape</span>
              <select
                className="ctrl-select"
                value={cfg.markerShape ?? 'circle'}
                onChange={(e) => patchConfig({ markerShape: e.target.value as ChartElementConfig['markerShape'] })}
              >
                {MARKER_SHAPES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Marker Size ({cfg.markerSize ?? 4.5}px)</span>
              <input
                type="range"
                min={1}
                max={16}
                step={0.5}
                value={cfg.markerSize ?? 4.5}
                onChange={(e) => patchConfig({ markerSize: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="ctrl-row-checks">
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.showMarkers !== false}
                onChange={(e) => patchConfig({ showMarkers: e.target.checked })}
              />
              <span>Show Point Markers</span>
            </label>
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={Boolean(cfg.directLineLabels)}
                onChange={(e) => patchConfig({ directLineLabels: e.target.checked })}
              />
              <span>Direct End-of-Line Labels</span>
            </label>
          </div>
        </section>

        {/* Series Geometry: Bars, Polar, Maps & Specialized */}
        <section className="ctrl-section">
          <h3>Bars,Slices, Maps &amp; Specialized Geometry</h3>
          <div className="ctrl-grid-2">
            <label className="ctrl-field">
              <span>Bar Corner Radius ({cfg.barRadius ?? 5}px)</span>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={cfg.barRadius ?? 5}
                onChange={(e) => patchConfig({ barRadius: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Bar Gap Ratio ({Math.round((cfg.barGap ?? 0.24) * 100)}%)</span>
              <input
                type="range"
                min={0}
                max={0.75}
                step={0.04}
                value={cfg.barGap ?? 0.24}
                onChange={(e) => patchConfig({ barGap: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Max Bar Width (px)</span>
              <input
                type="number"
                min={8}
                max={140}
                className="ctrl-input"
                value={cfg.barMaxWidth ?? 56}
                onChange={(e) => patchConfig({ barMaxWidth: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Donut Inner Hole ({Math.round((cfg.innerRadiusRatio ?? (widget.kind === 'donut' ? 0.58 : 0)) * 100)}%)</span>
              <input
                type="range"
                min={0}
                max={0.86}
                step={0.04}
                value={cfg.innerRadiusRatio ?? (widget.kind === 'donut' ? 0.58 : 0)}
                onChange={(e) => patchConfig({ innerRadiusRatio: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Slice Pad Angle ({cfg.padAngle ?? 1.2}°)</span>
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={cfg.padAngle ?? 1.2}
                onChange={(e) => patchConfig({ padAngle: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Start Angle ({cfg.startAngle ?? -90}°)</span>
              <input
                type="number"
                min={-360}
                max={360}
                className="ctrl-input"
                value={cfg.startAngle ?? -90}
                onChange={(e) => patchConfig({ startAngle: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Donut Center Label</span>
              <input
                type="text"
                className="ctrl-input"
                placeholder="Auto total"
                value={cfg.donutCenterLabel ?? ''}
                onChange={(e) => patchConfig({ donutCenterLabel: e.target.value })}
              />
            </label>
            <label className="ctrl-field">
              <span>Donut / Gauge Subtext</span>
              <input
                type="text"
                className="ctrl-input"
                placeholder="e.g. Q4 Quota"
                value={cfg.donutCenterSubtext ?? ''}
                onChange={(e) => patchConfig({ donutCenterSubtext: e.target.value })}
              />
            </label>
            <label className="ctrl-field">
              <span>Histogram Bins</span>
              <input
                type="number"
                min={3}
                max={40}
                className="ctrl-input"
                value={cfg.binCount ?? 8}
                onChange={(e) => patchConfig({ binCount: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Goal / Target Value</span>
              <input
                type="number"
                className="ctrl-input"
                placeholder="Optional goal"
                value={cfg.targetValue ?? ''}
                onChange={(e) =>
                  patchConfig({ targetValue: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </label>
            <label className="ctrl-field">
              <span>Trellis Columns</span>
              <select
                className="ctrl-select"
                value={cfg.trellisColumns ?? 2}
                onChange={(e) => patchConfig({ trellisColumns: Number(e.target.value) })}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} col{n > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Trellis Sub-Chart</span>
              <select
                className="ctrl-select"
                value={cfg.trellisSubKind ?? 'area'}
                onChange={(e) =>
                  patchConfig({ trellisSubKind: e.target.value as ChartElementConfig['trellisSubKind'] })
                }
              >
                <option value="area">Area</option>
                <option value="line">Line</option>
                <option value="bar">Bar</option>
                <option value="column">Column</option>
              </select>
            </label>
            <label className="ctrl-field">
              <span>Map Viewport Scope</span>
              <select
                className="ctrl-select"
                value={cfg.mapScope ?? 'world'}
                onChange={(e) => patchConfig({ mapScope: e.target.value as ChartElementConfig['mapScope'] })}
              >
                {MAP_SCOPES.map((ms) => (
                  <option key={ms} value={ms}>
                    {ms.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Node / Hub Size ({cfg.nodeSize ?? 8}px)</span>
              <input
                type="range"
                min={3}
                max={32}
                step={1}
                value={cfg.nodeSize ?? 8}
                onChange={(e) => patchConfig({ nodeSize: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Flow / Arc Curvature ({cfg.linkCurvature ?? 0.5})</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={cfg.linkCurvature ?? 0.5}
                onChange={(e) => patchConfig({ linkCurvature: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="ctrl-row-checks">
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.showMean !== false}
                onChange={(e) => patchConfig({ showMean: e.target.checked })}
              />
              <span>Box/Hist Mean</span>
            </label>
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.showOutliers !== false}
                onChange={(e) => patchConfig({ showOutliers: e.target.checked })}
              />
              <span>Box Outliers</span>
            </label>
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.showMapGraticule !== false}
                onChange={(e) => patchConfig({ showMapGraticule: e.target.checked })}
              />
              <span>Map Graticule</span>
            </label>
            <label className="ctrl-check">
              <input
                type="checkbox"
                checked={cfg.showMapLabels !== false}
                onChange={(e) => patchConfig({ showMapLabels: e.target.checked })}
              />
              <span>Map Labels</span>
            </label>
          </div>
        </section>

        {/* Typography & Card Frame */}
        <section className="ctrl-section">
          <h3>Typography &amp; Card Frame</h3>
          <div className="ctrl-grid-2">
            <label className="ctrl-field">
              <span>Chart Stage Height ({cfg.chartHeight ?? 216}px)</span>
              <input
                type="range"
                min={140}
                max={520}
                step={8}
                value={cfg.chartHeight ?? 216}
                onChange={(e) => patchConfig({ chartHeight: Number(e.target.value) })}
              />
            </label>
            <label className="ctrl-field">
              <span>Font Family</span>
              <select
                className="ctrl-select"
                value={cfg.fontFamily ?? 'sans'}
                onChange={(e) => patchConfig({ fontFamily: e.target.value as ChartElementConfig['fontFamily'] })}
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Title Size</span>
              <select
                className="ctrl-select"
                value={cfg.titleSize ?? 'md'}
                onChange={(e) => patchConfig({ titleSize: e.target.value as ChartElementConfig['titleSize'] })}
              >
                {TITLE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Title Alignment</span>
              <select
                className="ctrl-select"
                value={cfg.titleAlign ?? 'left'}
                onChange={(e) => patchConfig({ titleAlign: e.target.value as 'left' | 'center' })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
              </select>
            </label>
            <label className="ctrl-field">
              <span>Card Surface</span>
              <select
                className="ctrl-select"
                value={cfg.cardBackground ?? 'default'}
                onChange={(e) =>
                  patchConfig({ cardBackground: e.target.value as ChartElementConfig['cardBackground'] })
                }
              >
                {CARD_BACKGROUNDS.map((b) => (
                  <option key={b} value={b}>
                    {b.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Card Border</span>
              <select
                className="ctrl-select"
                value={cfg.cardBorder ?? 'subtle'}
                onChange={(e) => patchConfig({ cardBorder: e.target.value as ChartElementConfig['cardBorder'] })}
              >
                {CARD_BORDERS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Card Padding</span>
              <select
                className="ctrl-select"
                value={cfg.cardPadding ?? 'normal'}
                onChange={(e) => patchConfig({ cardPadding: e.target.value as ChartElementConfig['cardPadding'] })}
              >
                {CARD_PADDINGS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctrl-field">
              <span>Header Badge Pill</span>
              <input
                type="text"
                className="ctrl-input"
                placeholder="e.g. LIVE · Q4"
                value={cfg.badgeText ?? ''}
                onChange={(e) => patchConfig({ badgeText: e.target.value })}
              />
            </label>
            <label className="ctrl-field full">
              <span>Footnote / Methodology Caption</span>
              <input
                type="text"
                className="ctrl-input"
                placeholder="Source note or caveat shown beneath chart…"
                value={cfg.footnote ?? ''}
                onChange={(e) => patchConfig({ footnote: e.target.value })}
              />
            </label>
          </div>
        </section>
      </div>
    );
  }

  // =========================================================================
  // TAB 4: DATA LABELS, FORMATS, LEGEND, OVERLAYS & INTERACTIVITY
  // =========================================================================
  const refLines: ChartReferenceLine[] = cfg.referenceLines ?? [];
  const refBands: ChartReferenceBand[] = cfg.referenceBands ?? [];
  const annotations: ChartAnnotation[] = cfg.annotations ?? [];

  return (
    <div className="chart-controls-stack">
      {/* Number Formatting & Data Labels */}
      <section className="ctrl-section">
        <h3>Number Formatting &amp; Data Labels</h3>
        <div className="ctrl-grid-2">
          <label className="ctrl-field">
            <span>Value Format</span>
            <select
              className="ctrl-select"
              value={widget.format ?? 'compact'}
              onChange={(e) => patchWidget({ format: e.target.value as ValueFormat })}
            >
              {VALUE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="ctrl-field">
            <span>Decimal Places</span>
            <input
              type="number"
              min={0}
              max={6}
              className="ctrl-input"
              placeholder="Auto"
              value={cfg.decimals ?? ''}
              onChange={(e) =>
                patchConfig({ decimals: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </label>
          <label className="ctrl-field">
            <span>Custom Prefix</span>
            <input
              type="text"
              className="ctrl-input"
              placeholder="e.g. $, ~"
              value={cfg.prefix ?? ''}
              onChange={(e) => patchConfig({ prefix: e.target.value })}
            />
          </label>
          <label className="ctrl-field">
            <span>Custom Suffix / Unit</span>
            <input
              type="text"
              className="ctrl-input"
              placeholder="e.g. ms, seats"
              value={cfg.suffix ?? widget.unit ?? ''}
              onChange={(e) => patchConfig({ suffix: e.target.value })}
            />
          </label>
        </div>

        <label className="ctrl-check">
          <input
            type="checkbox"
            checked={Boolean(cfg.showDataLabels)}
            onChange={(e) => patchConfig({ showDataLabels: e.target.checked })}
          />
          <span>Show On-Chart Data Labels</span>
        </label>

        <div className="ctrl-grid-2">
          <label className="ctrl-field">
            <span>Label Placement</span>
            <select
              className="ctrl-select"
              value={cfg.dataLabelPosition ?? 'auto'}
              onChange={(e) =>
                patchConfig({ dataLabelPosition: e.target.value as ChartElementConfig['dataLabelPosition'] })
              }
            >
              {DATA_LABEL_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="ctrl-field">
            <span>Label Content</span>
            <select
              className="ctrl-select"
              value={cfg.dataLabelContent ?? 'value'}
              onChange={(e) =>
                patchConfig({ dataLabelContent: e.target.value as ChartElementConfig['dataLabelContent'] })
              }
            >
              {DATA_LABEL_CONTENTS.map((c) => (
                <option key={c} value={c}>
                  {c.replace('_', ' + ')}
                </option>
              ))}
            </select>
          </label>
          <label className="ctrl-field">
            <span>Label Font Size ({cfg.dataLabelFontSize ?? 10}px)</span>
            <input
              type="range"
              min={8}
              max={18}
              step={1}
              value={cfg.dataLabelFontSize ?? 10}
              onChange={(e) => patchConfig({ dataLabelFontSize: Number(e.target.value) })}
            />
          </label>
        </div>
      </section>

      {/* Legend Controls */}
      <section className="ctrl-section">
        <h3>Legend</h3>
        <div className="ctrl-grid-2">
          <label className="ctrl-field">
            <span>Legend Visibility</span>
            <select
              className="ctrl-select"
              value={cfg.showLegend === undefined ? 'auto' : cfg.showLegend ? 'show' : 'hide'}
              onChange={(e) => {
                const v = e.target.value;
                patchConfig({ showLegend: v === 'auto' ? undefined : v === 'show' });
              }}
            >
              <option value="auto">Auto (Smart)</option>
              <option value="show">Always Show</option>
              <option value="hide">Hide Legend</option>
            </select>
          </label>
          <label className="ctrl-field">
            <span>Legend Position</span>
            <select
              className="ctrl-select"
              value={cfg.legendPosition ?? 'bottom'}
              onChange={(e) =>
                patchConfig({ legendPosition: e.target.value as ChartElementConfig['legendPosition'] })
              }
            >
              {LEGEND_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="ctrl-check">
          <input
            type="checkbox"
            checked={Boolean(cfg.legendShowValues)}
            onChange={(e) => patchConfig({ legendShowValues: e.target.checked })}
          />
          <span>Display Series Totals Inside Legend Pills</span>
        </label>
      </section>

      {/* Statistical & Goal Overlays */}
      <section className="ctrl-section">
        <h3>Statistical Overlays &amp; Reference Lines</h3>
        <div className="ctrl-row-checks">
          <label className="ctrl-check">
            <input
              type="checkbox"
              checked={Boolean(cfg.showTrendline)}
              onChange={(e) => patchConfig({ showTrendline: e.target.checked })}
            />
            <span>OLS Trendline</span>
          </label>
          <label className="ctrl-check">
            <input
              type="checkbox"
              checked={Boolean(cfg.showAverageLine)}
              onChange={(e) => patchConfig({ showAverageLine: e.target.checked })}
            />
            <span>Average Line</span>
          </label>
          <label className="ctrl-check">
            <input
              type="checkbox"
              checked={Boolean(cfg.highlightMaxMin)}
              onChange={(e) => patchConfig({ highlightMaxMin: e.target.checked })}
            />
            <span>Highlight Peak/Min</span>
          </label>
        </div>

        {/* Reference Lines List & Adder */}
        <div className="ctrl-subbox">
          <span className="ctrl-subbox-title">Custom Threshold / Goal Lines</span>
          {refLines.map((rl) => (
            <div key={rl.id} className="ctrl-list-item">
              <span>
                <strong>{rl.label || 'Line'}</strong> @ {rl.value} ({rl.axis ?? 'y'})
              </span>
              <button
                type="button"
                className="text-btn small"
                onClick={() => patchConfig({ referenceLines: refLines.filter((x) => x.id !== rl.id) })}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="ctrl-inline-add">
            <input
              type="number"
              className="ctrl-input compact"
              placeholder="Value"
              value={newRefVal}
              onChange={(e) => setNewRefVal(e.target.value)}
            />
            <input
              type="text"
              className="ctrl-input compact"
              placeholder="Label"
              value={newRefLabel}
              onChange={(e) => setNewRefLabel(e.target.value)}
            />
            <button
              type="button"
              className="tonal-btn small"
              onClick={() => {
                const n = Number(newRefVal);
                if (!Number.isFinite(n)) return;
                patchConfig({
                  referenceLines: [
                    ...refLines,
                    { id: `rl_${Date.now()}`, value: n, label: newRefLabel.trim() || undefined, axis: 'y', style: 'dashed' },
                  ],
                });
              }}
            >
              + Line
            </button>
          </div>
        </div>

        {/* Reference Bands List & Adder */}
        <div className="ctrl-subbox">
          <span className="ctrl-subbox-title">Shaded Target / SLA Zones</span>
          {refBands.map((rb) => (
            <div key={rb.id} className="ctrl-list-item">
              <span>
                <strong>{rb.label || 'Band'}</strong>: {rb.from} → {rb.to}
              </span>
              <button
                type="button"
                className="text-btn small"
                onClick={() => patchConfig({ referenceBands: refBands.filter((x) => x.id !== rb.id) })}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="ctrl-inline-add">
            <input
              type="number"
              className="ctrl-input compact"
              placeholder="From"
              value={newBandFrom}
              onChange={(e) => setNewBandFrom(e.target.value)}
            />
            <input
              type="number"
              className="ctrl-input compact"
              placeholder="To"
              value={newBandTo}
              onChange={(e) => setNewBandTo(e.target.value)}
            />
            <input
              type="text"
              className="ctrl-input compact"
              placeholder="Zone label"
              value={newBandLabel}
              onChange={(e) => setNewBandLabel(e.target.value)}
            />
            <button
              type="button"
              className="tonal-btn small"
              onClick={() => {
                const f = Number(newBandFrom);
                const t = Number(newBandTo);
                if (!Number.isFinite(f) || !Number.isFinite(t)) return;
                patchConfig({
                  referenceBands: [
                    ...refBands,
                    { id: `rb_${Date.now()}`, from: f, to: t, label: newBandLabel.trim() || undefined, axis: 'y' },
                  ],
                });
              }}
            >
              + Band
            </button>
          </div>
        </div>

        {/* Callout Annotations */}
        <div className="ctrl-subbox">
          <span className="ctrl-subbox-title">Pinned Callout Annotations</span>
          {annotations.map((an) => (
            <div key={an.id} className="ctrl-list-item">
              <span>
                “{an.text}” {an.targetLabel ? `(@ ${an.targetLabel})` : ''}
              </span>
              <button
                type="button"
                className="text-btn small"
                onClick={() => patchConfig({ annotations: annotations.filter((x) => x.id !== an.id) })}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="ctrl-inline-add">
            <input
              type="text"
              className="ctrl-input compact"
              placeholder="Callout text…"
              value={newAnnText}
              onChange={(e) => setNewAnnText(e.target.value)}
            />
            <input
              type="text"
              className="ctrl-input compact"
              placeholder="X label (optional)"
              value={newAnnTarget}
              onChange={(e) => setNewAnnTarget(e.target.value)}
            />
            <button
              type="button"
              className="tonal-btn small"
              onClick={() => {
                if (!newAnnText.trim()) return;
                patchConfig({
                  annotations: [
                    ...annotations,
                    {
                      id: `ann_${Date.now()}`,
                      text: newAnnText.trim(),
                      targetLabel: newAnnTarget.trim() || undefined,
                    },
                  ],
                });
              }}
            >
              + Pin
            </button>
          </div>
        </div>
      </section>

      {/* Interactivity & Motion */}
      <section className="ctrl-section">
        <h3>Interactivity &amp; Motion</h3>
        <div className="ctrl-row-checks">
          <label className="ctrl-check">
            <input
              type="checkbox"
              checked={cfg.showTooltip !== false}
              onChange={(e) => patchConfig({ showTooltip: e.target.checked })}
            />
            <span>Hover Tooltip</span>
          </label>
          <label className="ctrl-check">
            <input
              type="checkbox"
              checked={Boolean(cfg.crossFilterOnClick)}
              onChange={(e) => patchConfig({ crossFilterOnClick: e.target.checked })}
            />
            <span>Click to Cross-Filter Dashboard</span>
          </label>
          <label className="ctrl-check">
            <input
              type="checkbox"
              checked={cfg.animate !== false}
              onChange={(e) => patchConfig({ animate: e.target.checked })}
            />
            <span>Entry Transitions</span>
          </label>
        </div>
      </section>
    </div>
  );
}
