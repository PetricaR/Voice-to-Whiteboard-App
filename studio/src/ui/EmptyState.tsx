import type { CreateDashboardRequest } from '../engine/dashboard';
import type { CreateMotionRequest } from '../engine/motion';
import { BLUEPRINTS, type Blueprint } from './blueprints';
import { Icon, useStudio } from './context';
import { STARTER_SAAS_DASHBOARD } from './dashboard/DashboardView';
import type { IconName } from './icons';

const ECOMMERCE_DASHBOARD: CreateDashboardRequest = {
  title: 'E-Commerce Funnel & Monthly GMV',
  subtitle: 'Live SQL over monthly orders, AOV, and storefront conversion stages',
  source: 'local',
  filters: [
    {
      id: 'f_channel',
      label: 'Channel',
      param: 'channel',
      kind: 'select',
      options: ['ALL', 'Organic Search', 'Paid Social', 'Direct', 'Lifecycle Email'],
      value: 'ALL',
    },
  ],
  widgets: [
    {
      id: 'total_gmv',
      title: 'Gross Merchandise Value',
      kind: 'kpi',
      sql: `SELECT ROUND(SUM(gross_revenue_usd), 0) AS gmv FROM daily_orders WHERE (:channel = 'ALL' OR channel = :channel)`,
      format: 'currency_usd',
      col_span: 4,
      color: 'blue',
      explanation: 'Total gross revenue across filtered acquisition channels.',
    },
    {
      id: 'total_orders',
      title: 'Completed Orders',
      kind: 'kpi',
      sql: `SELECT SUM(orders) AS total_orders FROM daily_orders WHERE (:channel = 'ALL' OR channel = :channel)`,
      format: 'number',
      col_span: 4,
      color: 'teal',
      explanation: 'Total completed orders over the 12-month window.',
    },
    {
      id: 'avg_order_val',
      title: 'Blended AOV',
      kind: 'kpi',
      sql: `SELECT ROUND(SUM(gross_revenue_usd) * 1.0 / NULLIF(SUM(orders), 0), 2) AS aov FROM daily_orders WHERE (:channel = 'ALL' OR channel = :channel)`,
      format: 'currency_usd',
      col_span: 4,
      color: 'green',
      explanation: 'Gross revenue divided by total completed orders.',
    },
    {
      id: 'funnel_stages',
      title: 'Checkout Conversion Funnel',
      subtitle: 'Session progression from landing to purchase',
      kind: 'funnel',
      sql: `SELECT stage, SUM(users) AS total_users FROM conversion_funnel GROUP BY stage_order, stage ORDER BY stage_order ASC`,
      format: 'number',
      col_span: 6,
      color: 'purple',
      explanation: 'Ordered user counts across storefront funnel steps.',
    },
    {
      id: 'daily_rev_bar',
      title: 'Monthly Revenue Trend',
      subtitle: 'GMV progression across months',
      kind: 'bar',
      sql: `SELECT month, ROUND(SUM(gross_revenue_usd), 0) AS revenue FROM daily_orders WHERE (:channel = 'ALL' OR channel = :channel) GROUP BY month ORDER BY month`,
      format: 'currency_usd',
      col_span: 6,
      color: 'blue',
      explanation: 'Monthly aggregated gross merchandise value.',
    },
  ],
};

const FINOPS_DASHBOARD: CreateDashboardRequest = {
  title: 'Cloud & AI FinOps Spend Monitor',
  subtitle: 'Monthly Google Cloud & Gemini Live API spend, latency, and environment breakdown',
  source: 'local',
  widgets: [
    {
      id: 'total_spend',
      title: '6-Month Cloud Spend',
      kind: 'kpi',
      sql: `SELECT ROUND(SUM(cost_usd), 0) AS total_spend FROM service_spend`,
      format: 'currency_usd',
      col_span: 4,
      color: 'orange',
      explanation: 'Cumulative cloud and AI service spend across environments.',
    },
    {
      id: 'avg_latency',
      title: 'Avg P95 Latency',
      kind: 'kpi',
      sql: `SELECT ROUND(AVG(p95_latency_ms), 0) AS p95_ms FROM service_spend WHERE environment = 'production'`,
      format: 'ms',
      col_span: 4,
      color: 'teal',
      explanation: 'Average production P95 latency across services.',
    },
    {
      id: 'gpu_tokens',
      title: 'Gemini Live API Spend',
      kind: 'kpi',
      sql: `SELECT ROUND(SUM(cost_usd), 0) AS ai_spend FROM service_spend WHERE service LIKE '%Gemini%'`,
      format: 'currency_usd',
      col_span: 4,
      color: 'purple',
      explanation: 'Spend dedicated to Gemini Live API workloads.',
    },
    {
      id: 'spend_by_service',
      title: 'Spend by Cloud Service',
      kind: 'horizontal_bar',
      sql: `SELECT service, ROUND(SUM(cost_usd), 0) AS cost_usd FROM service_spend GROUP BY service ORDER BY cost_usd DESC`,
      format: 'currency_usd',
      col_span: 7,
      color: 'blue',
      explanation: 'Ranks Google Cloud services by total spend.',
    },
    {
      id: 'spend_by_env',
      title: 'Production vs Staging Share',
      kind: 'donut',
      sql: `SELECT environment, ROUND(SUM(cost_usd), 0) AS cost_usd FROM service_spend GROUP BY environment ORDER BY cost_usd DESC`,
      format: 'currency_usd',
      col_span: 5,
      explanation: 'Cost distribution between production and staging environments.',
    },
  ],
};

const STARTER_MOTION_REEL: CreateMotionRequest = {
  title: 'H1 2026 SaaS Growth Explainer',
  subtitle: 'Programmatic 60fps metrics & architecture walkthrough',
  aspect_ratio: '16:9',
  fps: 60,
  show_captions: true,
  scenes: [
    {
      id: 'intro_hook',
      title: 'Executive Hook',
      duration_ms: 3400,
      narration: 'H1 2026 recurring revenue accelerated past two hundred sixty thousand dollars per month with industry-leading retention.',
      transition: 'fade',
      layers: [
        { id: 'b1', kind: 'badge', text: 'LIVE DATA EXPLAINER · H1 2026', x: 50, y: 24, color: 'blue', enter_at_ms: 0 },
        { id: 't1', kind: 'kinetic_text', text: 'SaaS Revenue & Retention Momentum', x: 50, y: 46, size: 'xl', align: 'center', enter_at_ms: 160 },
        { id: 's1', kind: 'kinetic_text', text: 'Every metric verified directly against live SQLite-Wasm tables', x: 50, y: 64, size: 'sm', align: 'center', color: 'gray', enter_at_ms: 420 },
      ],
    },
    {
      id: 'kpi_callouts',
      title: 'Headline KPIs',
      duration_ms: 4200,
      narration: 'June MRR reached $266.5K while cohort net revenue retention climbed to 116.7 percent.',
      transition: 'slide_left',
      layers: [
        { id: 'b2', kind: 'badge', text: 'VERIFIED SQL METRICS', x: 50, y: 15, color: 'teal', enter_at_ms: 0 },
        { id: 'm1', kind: 'metric_counter', text: 'June 2026 MRR', value: 266500, prefix: '$', delta_text: '+34.6% H1', x: 28, y: 48, w: 34, color: 'blue', enter_at_ms: 140 },
        { id: 'm2', kind: 'metric_counter', text: 'Net Revenue Retention', value: 116.7, suffix: '%', decimals: 1, delta_text: '+4.7 pts', x: 72, y: 48, w: 34, color: 'green', enter_at_ms: 340 },
      ],
    },
    {
      id: 'regional_chart',
      title: 'Regional Trajectory',
      duration_ms: 4400,
      narration: 'North America leads total recurring revenue, while EMEA and APAC drive rapid expansion.',
      transition: 'zoom_through',
      layers: [
        { id: 't3', kind: 'kinetic_text', text: 'June 2026 MRR by Region ($USD)', x: 50, y: 15, size: 'md', align: 'center', enter_at_ms: 0 },
        {
          id: 'c3',
          kind: 'motion_chart',
          chart_type: 'bar',
          x: 50,
          y: 56,
          w: 76,
          h: 58,
          color: 'purple',
          enter_at_ms: 200,
          series: [
            { label: 'North America', value: 148000 },
            { label: 'EMEA', value: 76500 },
            { label: 'APAC', value: 42000 },
          ],
        },
      ],
    },
  ],
};

interface QuickStarter {
  id: string;
  title: string;
  category: string;
  icon: IconName;
  prompt: string;
  runLocal: () => void;
}

export function EmptyState() {
  const { workspace, store, agent, liveKey, auth, toggleVoice } = useStudio();
  const canAskGemini = liveKey === 'configured' && (!auth.required || (auth.configured && auth.account != null));

  const starters: QuickStarter[] = [
    {
      id: 'dash-saas',
      title: 'SaaS Executive Revenue',
      category: 'Live SQL Dashboard',
      icon: 'dashboard',
      prompt: 'Build a live SaaS executive revenue & NRR dashboard from monthly_revenue and enterprise_accounts with a region filter.',
      runLocal: () => {
        store.createDashboard(STARTER_SAAS_DASHBOARD, {
          source: 'system',
          label: `Created “${STARTER_SAAS_DASHBOARD.title}”`,
        });
        workspace.showView('dashboard');
      },
    },
    {
      id: 'dash-ecom',
      title: 'E-Commerce Funnel & GMV',
      category: 'Live SQL Dashboard',
      icon: 'pie_chart',
      prompt: 'Create a live e-commerce dashboard querying daily_orders and conversion_funnel with a channel filter.',
      runLocal: () => {
        store.createDashboard(ECOMMERCE_DASHBOARD, {
          source: 'system',
          label: `Created “${ECOMMERCE_DASHBOARD.title}”`,
        });
        workspace.showView('dashboard');
      },
    },
    {
      id: 'dash-finops',
      title: 'Cloud & AI FinOps Spend',
      category: 'Live SQL Dashboard',
      icon: 'show_chart',
      prompt: 'Create a Cloud & AI FinOps spend dashboard from service_spend with budget utilization gauge and team breakdown.',
      runLocal: () => {
        store.createDashboard(FINOPS_DASHBOARD, {
          source: 'system',
          label: `Created “${FINOPS_DASHBOARD.title}”`,
        });
        workspace.showView('dashboard');
      },
    },
    {
      id: 'motion-saas',
      title: 'Animated SaaS Metrics Reel',
      category: 'Programmatic Motion · MP4',
      icon: 'movie',
      prompt: 'Query our H1 2026 SaaS metrics and build an animated motion explainer storyboard with kinetic callouts and charts.',
      runLocal: () => {
        store.createMotion(STARTER_MOTION_REEL, {
          source: 'system',
          label: `Created “${STARTER_MOTION_REEL.title}”`,
        });
        workspace.showView('motion');
      },
    },
  ];

  const launchStarter = (s: QuickStarter) => {
    if (canAskGemini) {
      agent.sendText(s.prompt).catch(() => undefined);
    } else {
      s.runLocal();
    }
  };

  const launchBlueprint = (b: Blueprint) => {
    if (canAskGemini) {
      agent.sendText(b.prompt).catch(() => undefined);
    } else {
      store.create(b.diagram, {
        source: 'system',
        label: `Created “${b.diagram.title}”`,
        request: b.prompt,
      }).catch(() => undefined);
    }
  };

  return (
    <div className="empty-state">
      <div className="empty-card">
        <div className="empty-icon"><Icon name="graphic_eq" size={32} /></div>
        <h1>Speak live dashboards, motion &amp; diagrams</h1>
        <p>
          Query live SQL tables into interactive dashboards, animate data-grounded motion explainers, or
          sketch cloud architectures — refined conversationally with Gemini Live.
        </p>
        <div className="empty-hero-actions">
          <button type="button" className="filled-btn" onClick={toggleVoice}>
            <Icon name="mic" size={20} /> Start talking
          </button>
          <button type="button" className="tonal-btn" onClick={() => starters[0].runLocal()}>
            <Icon name="dashboard" size={18} /> Open Live Dashboard
          </button>
          <button type="button" className="tonal-btn" onClick={() => starters[3].runLocal()}>
            <Icon name="movie" size={18} /> Open Motion Studio
          </button>
        </div>
        <div className="suggestions" role="group" aria-label="Dashboards, motion explainers, and architecture blueprints">
          {starters.map((s) => (
            <button key={s.id} type="button" className="suggestion-chip" onClick={() => launchStarter(s)}>
              <span className="suggestion-head">
                <Icon name={s.icon} size={18} />
                <span className="suggestion-title">{s.title}</span>
              </span>
              <span className="suggestion-meta">{s.category}</span>
            </button>
          ))}
          {BLUEPRINTS.slice(0, 4).map((b) => (
            <button key={b.id} type="button" className="suggestion-chip" onClick={() => launchBlueprint(b)}>
              <span className="suggestion-head">
                <Icon name={b.icon} size={18} />
                <span className="suggestion-title">{b.title}</span>
              </span>
              <span className="suggestion-meta">{b.category}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
