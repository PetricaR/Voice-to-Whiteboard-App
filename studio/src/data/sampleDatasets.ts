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
];
