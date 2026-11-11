/**
 * The dashboard offered on an empty page. It lives outside DashboardView so
 * the empty state can offer it without loading the chart code.
 */
export const STARTER_SAAS_DASHBOARD = {
  title: 'SaaS Executive Revenue & Retention',
  subtitle: 'Live SQLite-Wasm metrics across MRR, NDR, regional growth, and enterprise accounts',
  source: 'local',
  refresh_seconds: 0,
  filters: [
    {
      id: 'filter_region',
      label: 'Region',
      param: 'region',
      kind: 'select' as const,
      options: ['ALL', 'North America', 'EMEA', 'APAC', 'LATAM'],
      value: 'ALL',
    },
  ],
  widgets: [
    {
      id: 'latest_mrr',
      title: 'Latest Monthly MRR',
      subtitle: '2026-10 recurring revenue',
      kind: 'kpi' as const,
      sql: `SELECT SUM(mrr_usd) AS mrr_usd, ROUND(AVG(net_dollar_retention_pct) - 100, 1) AS net_expansion_pct
FROM monthly_revenue
WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region)`,
      format: 'currency_usd' as const,
      col_span: 3,
      color: 'blue' as const,
      explanation: 'Sums recurring monthly revenue in October 2026 filtered by region, alongside net expansion above 100% NDR.',
    },
    {
      id: 'avg_nrr',
      title: 'Net Dollar Retention',
      subtitle: 'Cohort weighted NDR %',
      kind: 'kpi' as const,
      sql: `SELECT ROUND(AVG(net_dollar_retention_pct), 1) AS ndr_pct FROM monthly_revenue WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region)`,
      format: 'percent' as const,
      col_span: 3,
      color: 'teal' as const,
      explanation: 'Average net dollar retention percentage across active plans in 2026-10.',
    },
    {
      id: 'new_arr_6m',
      title: '12-Month New MRR Added',
      subtitle: 'Gross new logo MRR booked',
      kind: 'kpi' as const,
      sql: `SELECT SUM(new_mrr_usd) AS new_mrr_usd FROM monthly_revenue WHERE (:region = 'ALL' OR region = :region)`,
      format: 'currency_usd' as const,
      col_span: 3,
      color: 'green' as const,
      explanation: 'Cumulative new logo MRR added across the 12-month window.',
    },
    {
      id: 'active_customers',
      title: 'Active Customers',
      subtitle: 'Paying SaaS accounts',
      kind: 'kpi' as const,
      sql: `SELECT SUM(active_customers) AS customers FROM monthly_revenue WHERE month = '2026-10' AND (:region = 'ALL' OR region = :region)`,
      format: 'number' as const,
      col_span: 3,
      color: 'purple' as const,
      explanation: 'Total paying accounts active in October 2026.',
    },
    {
      id: 'mrr_trend',
      title: 'Monthly Recurring Revenue Trajectory',
      subtitle: '12-month recurring growth curve',
      kind: 'area' as const,
      sql: `SELECT month, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE (:region = 'ALL' OR region = :region) GROUP BY month ORDER BY month`,
      format: 'currency_usd' as const,
      col_span: 8,
      color: 'blue' as const,
      explanation: 'Aggregates monthly MRR from 2025-11 through 2026-10.',
    },
    {
      id: 'region_mix',
      title: 'MRR Share by Region',
      subtitle: 'October 2026 distribution',
      kind: 'donut' as const,
      sql: `SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY mrr_usd DESC`,
      format: 'currency_usd' as const,
      col_span: 4,
      explanation: 'Regional contribution to October 2026 MRR.',
    },
    {
      id: 'top_accounts',
      title: 'Enterprise Accounts & Health',
      subtitle: 'Click any column header to sort or click any figure to inspect SQL',
      kind: 'table' as const,
      sql: `SELECT account_name, region, plan, arr_usd, seats, usage_score, renewal_date, churn_risk
FROM enterprise_accounts
WHERE (:region = 'ALL' OR region = :region)
ORDER BY arr_usd DESC`,
      format: 'currency_usd' as const,
      col_span: 12,
      explanation: 'Lists enterprise accounts with ARR, seat deployment, usage health score, renewal date, and churn risk.',
    },
  ],
};
