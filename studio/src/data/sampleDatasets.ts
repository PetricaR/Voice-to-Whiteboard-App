/**
 * Curated multi-table enterprise sample datasets loaded automatically into the
 * local SQLite-Wasm engine so users can speak live SQL dashboards and motion
 * explainers into existence immediately with zero external setup.
 */

export interface SampleColumnSpec {
  name: string;
  type: 'TEXT' | 'REAL' | 'INTEGER';
  description: string;
}

export interface SampleTableSpec {
  name: string;
  dataset: string;
  datasetLabel: string;
  description: string;
  columns: SampleColumnSpec[];
  rows: (string | number | null)[][];
}

const MONTHS_12 = [
  { month: '2025-11', quarter: '2025-Q4' },
  { month: '2025-12', quarter: '2025-Q4' },
  { month: '2026-01', quarter: '2026-Q1' },
  { month: '2026-02', quarter: '2026-Q1' },
  { month: '2026-03', quarter: '2026-Q1' },
  { month: '2026-04', quarter: '2026-Q2' },
  { month: '2026-05', quarter: '2026-Q2' },
  { month: '2026-06', quarter: '2026-Q2' },
  { month: '2026-07', quarter: '2026-Q3' },
  { month: '2026-08', quarter: '2026-Q3' },
  { month: '2026-09', quarter: '2026-Q3' },
  { month: '2026-10', quarter: '2026-Q4' },
];

function buildMonthlyRevenueRows(): (string | number)[][] {
  const regions: { name: string; base: number; growth: number; ndr: number }[] = [
    { name: 'North America', base: 185_000, growth: 1.038, ndr: 118.4 },
    { name: 'EMEA', base: 122_000, growth: 1.046, ndr: 121.2 },
    { name: 'APAC', base: 68_000, growth: 1.052, ndr: 116.8 },
    { name: 'LATAM', base: 34_000, growth: 1.031, ndr: 109.5 },
  ];
  const plans: { name: string; share: number; arpu: number; churnRate: number }[] = [
    { name: 'Enterprise', share: 0.54, arpu: 4200, churnRate: 0.011 },
    { name: 'Pro', share: 0.33, arpu: 450, churnRate: 0.024 },
    { name: 'Starter', share: 0.13, arpu: 79, churnRate: 0.042 },
  ];

  const rows: (string | number)[][] = [];
  MONTHS_12.forEach(({ month, quarter }, idx) => {
    const seasonal = idx === 1 || idx === 8 || idx === 11 ? 1.045 : 1.0;
    for (const r of regions) {
      for (const p of plans) {
        const mrr = Math.round(r.base * p.share * Math.pow(r.growth, idx) * seasonal);
        const newMrr = Math.round(mrr * (0.065 + (idx % 3) * 0.008));
        const expansionMrr = Math.round(mrr * (p.name === 'Enterprise' ? 0.048 : 0.026));
        const churnedMrr = Math.round(mrr * p.churnRate);
        const customers = Math.max(4, Math.round(mrr / p.arpu));
        const ndr = Math.round((r.ndr + (p.name === 'Enterprise' ? 4.2 : p.name === 'Pro' ? -1.5 : -7.8) + idx * 0.25) * 10) / 10;
        rows.push([month, quarter, r.name, p.name, mrr, newMrr, expansionMrr, churnedMrr, customers, ndr]);
      }
    }
  });
  return rows;
}

const ENTERPRISE_ACCOUNTS_ROWS: (string | number)[][] = [
  ['ACC-101', 'Apex Cloud Systems', 'North America', 'Enterprise', 480_000, 420, 94, '2027-03-15', 'Low', 'Elena Vance'],
  ['ACC-102', 'NordicFin Group', 'EMEA', 'Enterprise', 415_000, 360, 91, '2027-01-31', 'Low', 'Marcus Weber'],
  ['ACC-103', 'Kaito Robotics', 'APAC', 'Enterprise', 360_000, 310, 88, '2027-02-28', 'Low', 'Sora Takahashi'],
  ['ACC-104', 'Helios BioLabs', 'North America', 'Enterprise', 325_000, 275, 62, '2026-12-15', 'Medium', 'Elena Vance'],
  ['ACC-105', 'Vanguard Logistics', 'EMEA', 'Enterprise', 295_000, 250, 44, '2026-11-30', 'High', 'Marcus Weber'],
  ['ACC-106', 'Solstice Media', 'North America', 'Enterprise', 270_000, 230, 86, '2027-04-10', 'Low', 'Devon Brooks'],
  ['ACC-107', 'Andes Payments', 'LATAM', 'Enterprise', 215_000, 190, 79, '2027-01-20', 'Low', 'Camila Reyes'],
  ['ACC-108', 'Boreal Energy', 'EMEA', 'Enterprise', 198_000, 175, 51, '2026-12-05', 'High', 'Marcus Weber'],
  ['ACC-109', 'Zenith Retail AI', 'APAC', 'Enterprise', 184_000, 160, 90, '2027-05-01', 'Low', 'Sora Takahashi'],
  ['ACC-110', 'Cobalt Cyber', 'North America', 'Enterprise', 172_000, 145, 74, '2027-02-14', 'Medium', 'Devon Brooks'],
  ['ACC-111', 'Stratos Freight', 'North America', 'Pro', 96_000, 110, 39, '2026-11-25', 'High', 'Devon Brooks'],
  ['ACC-112', 'Lumina Health', 'EMEA', 'Pro', 88_000, 95, 83, '2027-03-01', 'Low', 'Marcus Weber'],
  ['ACC-113', 'Pacific Harbor', 'APAC', 'Pro', 76_000, 84, 67, '2027-01-10', 'Medium', 'Sora Takahashi'],
  ['ACC-114', 'Verde AgTech', 'LATAM', 'Pro', 64_000, 72, 85, '2027-04-22', 'Low', 'Camila Reyes'],
];

function buildEcommerceRows(): (string | number)[][] {
  const categories = [
    { name: 'Electronics', aov: 198, baseOrders: 2400, returnPct: 6.4 },
    { name: 'Home & Studio', aov: 142, baseOrders: 1850, returnPct: 4.8 },
    { name: 'Apparel', aov: 86, baseOrders: 3100, returnPct: 11.2 },
    { name: 'Wellness', aov: 68, baseOrders: 2200, returnPct: 2.9 },
  ];
  const channels = [
    { name: 'Organic Search', weight: 0.36 },
    { name: 'Paid Social', weight: 0.28 },
    { name: 'Direct', weight: 0.22 },
    { name: 'Lifecycle Email', weight: 0.14 },
  ];
  const rows: (string | number)[][] = [];
  MONTHS_12.forEach(({ month, quarter }, idx) => {
    const holidayBoost = month.endsWith('-11') || month.endsWith('-12') ? 1.28 : 1.0 + idx * 0.025;
    for (const c of categories) {
      for (const ch of channels) {
        const orders = Math.round(c.baseOrders * ch.weight * holidayBoost);
        const gross = Math.round(orders * c.aov);
        const net = Math.round(gross * (1 - c.returnPct / 100));
        rows.push([month, quarter, c.name, ch.name, orders, gross, net, c.aov, c.returnPct]);
      }
    }
  });
  return rows;
}

const FUNNEL_ROWS: (string | number)[][] = [
  [1, 'Landing Session', 'Desktop', 184_000, 100.0],
  [2, 'Product Viewed', 'Desktop', 106_700, 58.0],
  [3, 'Added to Cart', 'Desktop', 42_300, 23.0],
  [4, 'Checkout Started', 'Desktop', 25_760, 14.0],
  [5, 'Order Completed', 'Desktop', 15_450, 8.4],
  [1, 'Landing Session', 'Mobile', 312_000, 100.0],
  [2, 'Product Viewed', 'Mobile', 168_480, 54.0],
  [3, 'Added to Cart', 'Mobile', 56_160, 18.0],
  [4, 'Checkout Started', 'Mobile', 28_080, 9.0],
  [5, 'Order Completed', 'Mobile', 14_350, 4.6],
];

function buildCloudFinopsRows(): (string | number)[][] {
  const services = [
    { name: 'Gemini Live API', provider: 'gcp', baseCost: 14_200, growth: 1.065, p95: 290, err: 0.12 },
    { name: 'BigQuery', provider: 'gcp', baseCost: 18_500, growth: 1.032, p95: 640, err: 0.04 },
    { name: 'Cloud Run', provider: 'gcp', baseCost: 11_800, growth: 1.028, p95: 84, err: 0.08 },
    { name: 'GKE Autopilot', provider: 'gcp', baseCost: 22_400, growth: 1.018, p95: 62, err: 0.05 },
    { name: 'Cloud SQL Postgres', provider: 'gcp', baseCost: 9_600, growth: 1.015, p95: 18, err: 0.02 },
    { name: 'Cloud Storage', provider: 'gcp', baseCost: 4_300, growth: 1.022, p95: 35, err: 0.01 },
  ];
  const rows: (string | number)[][] = [];
  MONTHS_12.slice(-6).forEach(({ month }, idx) => {
    for (const s of services) {
      const prodCost = Math.round(s.baseCost * Math.pow(s.growth, idx));
      const stagingCost = Math.round(prodCost * 0.22);
      const reqM = Math.round((prodCost / 320) * 10) / 10;
      rows.push([month, s.name, s.provider, 'production', prodCost, reqM, Math.round(s.p95 * (1 - idx * 0.015)), s.err]);
      rows.push([month, s.name, s.provider, 'staging', stagingCost, Math.round(reqM * 0.18 * 10) / 10, s.p95, s.err]);
    }
  });
  return rows;
}

const SALES_PIPELINE_ROWS: (string | number)[][] = [
  ['DL-501', 'GlobalBank Corp', '4. Proposal', 'North America', ' Maya Lin', 340_000, 75, 255_000, '2026-Q4'],
  ['DL-502', 'EuroRail Systems', '5. Closed Won', 'EMEA', 'Jonas Lind', 290_000, 100, 290_000, '2026-Q4'],
  ['DL-503', 'Sakura Telecom', '3. Security Review', 'APAC', 'Kenji Sato', 410_000, 60, 246_000, '2026-Q4'],
  ['DL-504', 'Atlas Pharma', '5. Closed Won', 'North America', 'Maya Lin', 225_000, 100, 225_000, '2026-Q4'],
  ['DL-505', 'Rhine Automotive', '2. Technical Eval', 'EMEA', 'Jonas Lind', 380_000, 40, 152_000, '2027-Q1'],
  ['DL-506', 'Solari Fintech', '4. Proposal', 'LATAM', 'Sofia Costa', 165_000, 70, 115_500, '2026-Q4'],
  ['DL-507', 'Hyperion Defense', '1. Discovery', 'North America', 'Liam Patel', 520_000, 25, 130_000, '2027-Q1'],
  ['DL-508', 'Aether Airlines', '5. Closed Won', 'EMEA', 'Jonas Lind', 195_000, 100, 195_000, '2026-Q3'],
  ['DL-509', 'Orion Semicon', '3. Security Review', 'APAC', 'Kenji Sato', 310_000, 55, 170_500, '2026-Q4'],
  ['DL-510', 'Crescent Retail', '6. Closed Lost', 'North America', 'Liam Patel', 140_000, 0, 0, '2026-Q3'],
  ['DL-511', 'Bavaria Cloud', '4. Proposal', 'EMEA', 'Jonas Lind', 245_000, 80, 196_000, '2026-Q4'],
  ['DL-512', 'Mercosur Retail', '5. Closed Won', 'LATAM', 'Sofia Costa', 138_000, 100, 138_000, '2026-Q4'],
];

const STOCK_OHLC_ROWS: (string | number)[][] = [
  ['2026-09-01', 'CLDX', 142.5, 148.2, 140.8, 146.9, 1840],
  ['2026-09-08', 'CLDX', 146.9, 151.4, 144.2, 145.1, 1620],
  ['2026-09-15', 'CLDX', 145.1, 154.8, 144.6, 153.2, 2310],
  ['2026-09-22', 'CLDX', 153.2, 156.0, 148.5, 149.8, 1950],
  ['2026-09-29', 'CLDX', 149.8, 158.6, 149.0, 157.4, 2480],
  ['2026-10-06', 'CLDX', 157.4, 163.5, 155.2, 161.8, 2740],
  ['2026-10-13', 'CLDX', 161.8, 162.9, 154.0, 156.2, 2190],
  ['2026-10-20', 'CLDX', 156.2, 166.4, 155.8, 164.9, 2890],
  ['2026-10-27', 'CLDX', 164.9, 171.2, 163.1, 169.5, 3120],
  ['2026-11-03', 'CLDX', 169.5, 174.8, 166.0, 172.6, 2980],
];

const PROJECT_ROADMAP_ROWS: (string | number)[][] = [
  ['PRJ-01', 'Warehouse Schema Audit', 'Data Platform', 'Elena Vance', 0, 14, 14, 100, 45_000],
  ['PRJ-02', 'SQLite-Wasm Engine v2', 'Data Platform', 'Marcus Weber', 10, 32, 22, 100, 82_000],
  ['PRJ-03', 'Gemini Live Voice Streaming', 'AI Runtime', 'Sora Takahashi', 18, 48, 30, 88, 120_000],
  ['PRJ-04', '40+ Holistics Chart Studio', 'Visualization', 'Devon Brooks', 28, 62, 34, 76, 95_000],
  ['PRJ-05', 'Enterprise SSO & IAM Guard', 'Security', 'Maya Lin', 40, 74, 34, 55, 78_000],
  ['PRJ-06', 'WebCodecs 60fps MP4 Export', 'Motion Studio', 'Jonas Lind', 52, 84, 32, 42, 68_000],
  ['PRJ-07', 'Global Edge GA Launch', 'Cloud Ops', 'Kenji Sato', 70, 96, 26, 20, 110_000],
];

const ORG_DIRECTORY_ROWS: (string | number | null)[][] = [
  ['ceo', 'Chief Executive Officer', null, 'Executive', 186, 28_500_000],
  ['vp_eng', 'VP Engineering', 'ceo', 'Engineering', 84, 13_400_000],
  ['vp_gtm', 'VP Revenue & GTM', 'ceo', 'Go-To-Market', 62, 9_200_000],
  ['vp_ops', 'VP Finance & Ops', 'ceo', 'Operations', 40, 5_900_000],
  ['dir_ai', 'AI & Voice Agents', 'vp_eng', 'Engineering', 32, 5_600_000],
  ['dir_data', 'SQL & Analytics Engine', 'vp_eng', 'Engineering', 28, 4_400_000],
  ['dir_infra', 'Cloud & Security SRE', 'vp_eng', 'Engineering', 24, 3_400_000],
  ['dir_ent', 'Enterprise Sales', 'vp_gtm', 'Go-To-Market', 36, 5_500_000],
  ['dir_cs', 'Customer Success', 'vp_gtm', 'Go-To-Market', 26, 3_700_000],
  ['dir_fin', 'FP&A & RevOps', 'vp_ops', 'Operations', 22, 3_200_000],
  ['dir_people', 'Talent & Workplace', 'vp_ops', 'Operations', 18, 2_700_000],
];

const GLOBAL_FLOWS_ROWS: (string | number)[][] = [
  ['New York', 'North America', 40.71, -74.01, 'London', 'EMEA', 51.51, -0.13, 420, 540_000, 68],
  ['San Francisco', 'North America', 37.77, -122.42, 'Tokyo', 'APAC', 35.68, 139.69, 365, 468_000, 112],
  ['New York', 'North America', 40.71, -74.01, 'Frankfurt', 'EMEA', 50.11, 8.68, 310, 392_000, 76],
  ['London', 'EMEA', 51.51, -0.13, 'Singapore', 'APAC', 1.35, 103.82, 275, 348_000, 148],
  ['San Francisco', 'North America', 37.77, -122.42, 'Sydney', 'APAC', -33.87, 151.21, 215, 276_000, 138],
  ['Miami', 'North America', 25.76, -80.19, 'Sao Paulo', 'LATAM', -23.55, -46.63, 190, 234_000, 94],
  ['Frankfurt', 'EMEA', 50.11, 8.68, 'Mumbai', 'APAC', 19.08, 72.88, 240, 295_000, 106],
  ['Tokyo', 'APAC', 35.68, 139.69, 'Singapore', 'APAC', 1.35, 103.82, 295, 362_000, 64],
  ['London', 'EMEA', 51.51, -0.13, 'Sao Paulo', 'LATAM', -23.55, -46.63, 145, 182_000, 132],
  ['Toronto', 'North America', 43.65, -79.38, 'Paris', 'EMEA', 48.86, 2.35, 175, 218_000, 79],
];

export const SAMPLE_TABLES: SampleTableSpec[] = [
  {
    name: 'monthly_revenue',
    dataset: 'saas_metrics',
    datasetLabel: 'SaaS Revenue & Retention',
    description: 'Monthly B2B SaaS recurring revenue (MRR), new/expansion/churned MRR, customer counts, and net dollar retention across 4 regions and 3 pricing tiers (2025-11 to 2026-10).',
    columns: [
      { name: 'month', type: 'TEXT', description: 'YYYY-MM month key (2025-11..2026-10)' },
      { name: 'quarter', type: 'TEXT', description: 'Fiscal quarter (e.g. 2026-Q3, 2026-Q4)' },
      { name: 'region', type: 'TEXT', description: 'North America, EMEA, APAC, LATAM' },
      { name: 'plan', type: 'TEXT', description: 'Enterprise, Pro, Starter' },
      { name: 'mrr_usd', type: 'INTEGER', description: 'Ending Monthly Recurring Revenue in USD' },
      { name: 'new_mrr_usd', type: 'INTEGER', description: 'New logo MRR added in USD' },
      { name: 'expansion_mrr_usd', type: 'INTEGER', description: 'Expansion / upsell MRR in USD' },
      { name: 'churned_mrr_usd', type: 'INTEGER', description: 'Churned + contraction MRR in USD' },
      { name: 'active_customers', type: 'INTEGER', description: 'Active paying customer organizations' },
      { name: 'net_dollar_retention_pct', type: 'REAL', description: 'Net Dollar Retention % (e.g. 118.4)' },
    ],
    rows: buildMonthlyRevenueRows(),
  },
  {
    name: 'enterprise_accounts',
    dataset: 'saas_metrics',
    datasetLabel: 'SaaS Revenue & Retention',
    description: 'Key enterprise and pro customer accounts with ARR, licensed seats, product usage health score, renewal date, and churn risk tier.',
    columns: [
      { name: 'account_id', type: 'TEXT', description: 'Unique account identifier' },
      { name: 'account_name', type: 'TEXT', description: 'Customer company name' },
      { name: 'region', type: 'TEXT', description: 'North America, EMEA, APAC, LATAM' },
      { name: 'plan', type: 'TEXT', description: 'Enterprise or Pro' },
      { name: 'arr_usd', type: 'INTEGER', description: 'Annual Recurring Revenue in USD' },
      { name: 'seats', type: 'INTEGER', description: 'Active provisioned seats' },
      { name: 'usage_score', type: 'INTEGER', description: 'Product adoption health score (0-100)' },
      { name: 'renewal_date', type: 'TEXT', description: 'Contract renewal YYYY-MM-DD' },
      { name: 'churn_risk', type: 'TEXT', description: 'Low, Medium, or High' },
      { name: 'csm_owner', type: 'TEXT', description: 'Assigned Customer Success Manager' },
    ],
    rows: ENTERPRISE_ACCOUNTS_ROWS,
  },
  {
    name: 'daily_orders',
    dataset: 'ecommerce_growth',
    datasetLabel: 'E-Commerce Orders & Funnel',
    description: 'Monthly e-commerce order volume, gross/net revenue, average order value (AOV), and return rates across product categories and acquisition channels.',
    columns: [
      { name: 'month', type: 'TEXT', description: 'YYYY-MM month' },
      { name: 'quarter', type: 'TEXT', description: 'Quarter label' },
      { name: 'category', type: 'TEXT', description: 'Electronics, Home & Studio, Apparel, Wellness' },
      { name: 'channel', type: 'TEXT', description: 'Organic Search, Paid Social, Direct, Lifecycle Email' },
      { name: 'orders', type: 'INTEGER', description: 'Completed order count' },
      { name: 'gross_revenue_usd', type: 'INTEGER', description: 'Gross merchandise value in USD' },
      { name: 'net_revenue_usd', type: 'INTEGER', description: 'Net revenue after returns in USD' },
      { name: 'aov_usd', type: 'REAL', description: 'Average Order Value in USD' },
      { name: 'return_rate_pct', type: 'REAL', description: 'Return percentage' },
    ],
    rows: buildEcommerceRows(),
  },
  {
    name: 'conversion_funnel',
    dataset: 'ecommerce_growth',
    datasetLabel: 'E-Commerce Orders & Funnel',
    description: 'Storefront conversion funnel stages broken down by Desktop vs Mobile sessions.',
    columns: [
      { name: 'stage_order', type: 'INTEGER', description: '1..5 funnel step order' },
      { name: 'stage', type: 'TEXT', description: 'Funnel stage name' },
      { name: 'device', type: 'TEXT', description: 'Desktop or Mobile' },
      { name: 'users', type: 'INTEGER', description: 'Unique users reaching stage' },
      { name: 'conversion_pct', type: 'REAL', description: 'Conversion rate from top of funnel (%)' },
    ],
    rows: FUNNEL_ROWS,
  },
  {
    name: 'service_spend',
    dataset: 'cloud_finops',
    datasetLabel: 'Cloud FinOps & AI Telemetry',
    description: 'Cloud infrastructure and Gemini Live AI monthly cost, request volume, P95 latency, and error rates by environment.',
    columns: [
      { name: 'month', type: 'TEXT', description: 'YYYY-MM month' },
      { name: 'service', type: 'TEXT', description: 'Cloud/AI service name' },
      { name: 'provider', type: 'TEXT', description: 'Cloud provider (gcp)' },
      { name: 'environment', type: 'TEXT', description: 'production or staging' },
      { name: 'cost_usd', type: 'INTEGER', description: 'Monthly spend in USD' },
      { name: 'requests_millions', type: 'REAL', description: 'Request volume in millions' },
      { name: 'p95_latency_ms', type: 'INTEGER', description: 'P95 response latency in milliseconds' },
      { name: 'error_rate_pct', type: 'REAL', description: 'Error rate percentage' },
    ],
    rows: buildCloudFinopsRows(),
  },
  {
    name: 'deals_pipeline',
    dataset: 'sales_crm',
    datasetLabel: 'Enterprise Sales CRM Pipeline',
    description: 'Enterprise CRM opportunities with stage, region, sales rep, deal amount, win probability, and weighted pipeline value.',
    columns: [
      { name: 'deal_id', type: 'TEXT', description: 'Opportunity ID' },
      { name: 'company', type: 'TEXT', description: 'Prospect company name' },
      { name: 'stage', type: 'TEXT', description: '1. Discovery .. 6. Closed Lost' },
      { name: 'region', type: 'TEXT', description: 'North America, EMEA, APAC, LATAM' },
      { name: 'rep_name', type: 'TEXT', description: 'Account Executive' },
      { name: 'amount_usd', type: 'INTEGER', description: 'Contract value in USD' },
      { name: 'probability_pct', type: 'INTEGER', description: 'Win probability (0-100)' },
      { name: 'weighted_usd', type: 'INTEGER', description: 'Probability-weighted value in USD' },
      { name: 'close_quarter', type: 'TEXT', description: 'Expected close quarter' },
    ],
    rows: SALES_PIPELINE_ROWS.map((r) => [r[0], r[1], r[2], r[3], String(r[4]).trim(), r[5], r[6], r[7], r[8]]),
  },
  {
    name: 'stock_ohlc',
    dataset: 'financial_markets',
    datasetLabel: 'Financial OHLC & Market Volume',
    description: 'Weekly open, high, low, close (OHLC) share prices and trading volume for cloud index ticker CLDX.',
    columns: [
      { name: 'trading_date', type: 'TEXT', description: 'Trading week YYYY-MM-DD' },
      { name: 'ticker', type: 'TEXT', description: 'Ticker symbol (CLDX)' },
      { name: 'open_usd', type: 'REAL', description: 'Opening price in USD' },
      { name: 'high_usd', type: 'REAL', description: 'Intraday/weekly high in USD' },
      { name: 'low_usd', type: 'REAL', description: 'Intraday/weekly low in USD' },
      { name: 'close_usd', type: 'REAL', description: 'Closing price in USD' },
      { name: 'volume_k', type: 'INTEGER', description: 'Trading volume in thousands of shares' },
    ],
    rows: STOCK_OHLC_ROWS,
  },
  {
    name: 'project_roadmap',
    dataset: 'product_delivery',
    datasetLabel: 'Product Roadmap & Gantt Schedule',
    description: 'Engineering & launch milestones with start/end day offsets, completion progress, and budget allocation.',
    columns: [
      { name: 'task_id', type: 'TEXT', description: 'Milestone ID' },
      { name: 'task_name', type: 'TEXT', description: 'Initiative or milestone name' },
      { name: 'workstream', type: 'TEXT', description: 'Data Platform, AI Runtime, Visualization, Security, Motion Studio, Cloud Ops' },
      { name: 'owner', type: 'TEXT', description: 'Lead owner' },
      { name: 'start_day', type: 'INTEGER', description: 'Start offset in days from quarter start' },
      { name: 'end_day', type: 'INTEGER', description: 'End offset in days from quarter start' },
      { name: 'duration_days', type: 'INTEGER', description: 'Planned duration in days' },
      { name: 'progress_pct', type: 'INTEGER', description: 'Completion percentage (0-100)' },
      { name: 'budget_usd', type: 'INTEGER', description: 'Allocated budget in USD' },
    ],
    rows: PROJECT_ROADMAP_ROWS,
  },
  {
    name: 'org_directory',
    dataset: 'company_hierarchy',
    datasetLabel: 'Organization Hierarchy & Budgets',
    description: 'Executive, VP, and Director reporting tree with parent_id links, team headcount, and annual department budgets.',
    columns: [
      { name: 'node_id', type: 'TEXT', description: 'Unique role/team node ID' },
      { name: 'role_title', type: 'TEXT', description: 'Role or division title' },
      { name: 'parent_id', type: 'TEXT', description: 'Reporting parent node_id (NULL for CEO root)' },
      { name: 'department', type: 'TEXT', description: 'Executive, Engineering, Go-To-Market, Operations' },
      { name: 'headcount', type: 'INTEGER', description: 'Total team headcount' },
      { name: 'budget_usd', type: 'INTEGER', description: 'Annual budget in USD' },
    ],
    rows: ORG_DIRECTORY_ROWS,
  },
  {
    name: 'global_flows',
    dataset: 'geo_network',
    datasetLabel: 'Global Geo Hubs & Network Flows',
    description: 'Origin-destination city coordinates (lat/lon), regional corridors, bandwidth Gbps, attributed revenue, and RTT latency.',
    columns: [
      { name: 'origin_city', type: 'TEXT', description: 'Source city hub' },
      { name: 'origin_region', type: 'TEXT', description: 'North America, EMEA, APAC, LATAM' },
      { name: 'origin_lat', type: 'REAL', description: 'Origin latitude (-90..90)' },
      { name: 'origin_lon', type: 'REAL', description: 'Origin longitude (-180..180)' },
      { name: 'dest_city', type: 'TEXT', description: 'Destination city hub' },
      { name: 'dest_region', type: 'TEXT', description: 'North America, EMEA, APAC, LATAM' },
      { name: 'dest_lat', type: 'REAL', description: 'Destination latitude (-90..90)' },
      { name: 'dest_lon', type: 'REAL', description: 'Destination longitude (-180..180)' },
      { name: 'volume_gbps', type: 'INTEGER', description: 'Traffic throughput in Gbps' },
      { name: 'revenue_usd', type: 'INTEGER', description: 'Corridor ARR in USD' },
      { name: 'latency_ms', type: 'INTEGER', description: 'Round-trip latency in ms' },
    ],
    rows: GLOBAL_FLOWS_ROWS,
  },
];
