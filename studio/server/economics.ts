/**
 * Unit economics calculator for Voice Diagram Studio (Gemini Live API).
 *
 * Each Live API ephemeral token starts one session (up to 30 minutes TTL).
 * Because Pro allows up to 300 sessions/day (and Free up to 20/day), we model
 * token consumption across audio input, audio output, system prompt + tool
 * schemas, and multi-turn tool calls to measure average cost per session,
 * break-even session volume, and gross margin at €19/month (€180/year).
 *
 * Run from the CLI:
 *   npm run economics
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface LivePricingRates {
  /** USD per 1M audio input tokens (Gemini Flash Live native audio). */
  audioInputPerMillionUsd: number;
  /** USD per 1M audio output tokens. */
  audioOutputPerMillionUsd: number;
  /** USD per 1M text/tool input tokens. */
  textInputPerMillionUsd: number;
  /** USD per 1M text/tool output tokens. */
  textOutputPerMillionUsd: number;
  /** Native audio tokenization rate (tokens per second of audio). */
  audioTokensPerSecond: number;
}

export const DEFAULT_LIVE_RATES: LivePricingRates = {
  audioInputPerMillionUsd: 3.00,
  audioOutputPerMillionUsd: 12.00,
  textInputPerMillionUsd: 0.50,
  textOutputPerMillionUsd: 2.00,
  audioTokensPerSecond: 25,
};

export interface SessionProfile {
  name: string;
  durationMinutes: number;
  /** Seconds the user actively speaks into the microphone. */
  userSpeechSeconds: number;
  /** Seconds the model speaks back in audio. */
  modelSpeechSeconds: number;
  /** Number of diagram tool calls (compose_diagram, place_node, patch, etc.). */
  toolCallTurns: number;
  /** Base system instruction + tool declaration tokens sent at session setup. */
  setupTextTokens?: number;
  /** Average text input tokens per tool response / state summary turn. */
  tokensPerToolInput?: number;
  /** Average text output tokens per tool call arguments turn. */
  tokensPerToolOutput?: number;
}

export interface SessionCostEstimate {
  profile: string;
  durationMinutes: number;
  audioInputTokens: number;
  audioOutputTokens: number;
  textInputTokens: number;
  textOutputTokens: number;
  totalTokens: number;
  audioInputCostUsd: number;
  audioOutputCostUsd: number;
  textInputCostUsd: number;
  textOutputCostUsd: number;
  totalCostUsd: number;
}

export interface PlanEconomicsReport {
  proMonthlyPriceEur: number;
  proMonthlyPriceUsd: number;
  proAnnualPriceEur: number;
  freeDailyLimit: number;
  proDailyLimit: number;
  typicalSessionCostUsd: number;
  profiles: SessionCostEstimate[];
  /** Maximum typical sessions per month before a €19 ($20.50) subscription reaches break-even after Stripe fees. */
  breakEvenSessionsPerMonth: number;
  /** Equivalent daily sessions (across 30 days) before reaching break-even. */
  breakEvenSessionsPerDay: number;
  scenarios: Array<{
    cohort: string;
    sessionsPerDay: number;
    activeDaysPerMonth: number;
    monthlySessions: number;
    monthlyGeminiCostUsd: number;
    grossMarginPercent: number | null;
  }>;
}

export const SESSION_PROFILES: readonly SessionProfile[] = [
  {
    name: 'Quick tweak (2 min)',
    durationMinutes: 2,
    userSpeechSeconds: 35,
    modelSpeechSeconds: 20,
    toolCallTurns: 4,
  },
  {
    name: 'Typical architecture session (5 min)',
    durationMinutes: 5,
    userSpeechSeconds: 90,
    modelSpeechSeconds: 45,
    toolCallTurns: 8,
  },
  {
    name: 'Deep design session (15 min)',
    durationMinutes: 15,
    userSpeechSeconds: 240,
    modelSpeechSeconds: 110,
    toolCallTurns: 18,
  },
  {
    name: 'Full 30-min token ceiling',
    durationMinutes: 30,
    userSpeechSeconds: 450,
    modelSpeechSeconds: 200,
    toolCallTurns: 32,
  },
];

export function estimateSessionCost(
  profile: SessionProfile,
  rates: LivePricingRates = DEFAULT_LIVE_RATES,
): SessionCostEstimate {
  const setupTokens = profile.setupTextTokens ?? 2900; // systemInstruction (~1250) + 14 tool declarations (~1650)
  const perToolIn = profile.tokensPerToolInput ?? 420; // canvas state digest returned to model
  const perToolOut = profile.tokensPerToolOutput ?? 180; // functionCall JSON arguments

  const audioInputTokens = Math.round(profile.userSpeechSeconds * rates.audioTokensPerSecond);
  const audioOutputTokens = Math.round(profile.modelSpeechSeconds * rates.audioTokensPerSecond);
  const textInputTokens = setupTokens + profile.toolCallTurns * perToolIn;
  const textOutputTokens = profile.toolCallTurns * perToolOut;
  const totalTokens = audioInputTokens + audioOutputTokens + textInputTokens + textOutputTokens;

  const audioInputCostUsd = (audioInputTokens / 1_000_000) * rates.audioInputPerMillionUsd;
  const audioOutputCostUsd = (audioOutputTokens / 1_000_000) * rates.audioOutputPerMillionUsd;
  const textInputCostUsd = (textInputTokens / 1_000_000) * rates.textInputPerMillionUsd;
  const textOutputCostUsd = (textOutputTokens / 1_000_000) * rates.textOutputPerMillionUsd;
  const totalCostUsd = Number(
    (audioInputCostUsd + audioOutputCostUsd + textInputCostUsd + textOutputCostUsd).toFixed(6),
  );

  return {
    profile: profile.name,
    durationMinutes: profile.durationMinutes,
    audioInputTokens,
    audioOutputTokens,
    textInputTokens,
    textOutputTokens,
    totalTokens,
    audioInputCostUsd: Number(audioInputCostUsd.toFixed(6)),
    audioOutputCostUsd: Number(audioOutputCostUsd.toFixed(6)),
    textInputCostUsd: Number(textInputCostUsd.toFixed(6)),
    textOutputCostUsd: Number(textOutputCostUsd.toFixed(6)),
    totalCostUsd,
  };
}

export function buildEconomicsReport(
  options: {
    proMonthlyPriceEur?: number;
    eurToUsd?: number;
    freeDailyLimit?: number;
    proDailyLimit?: number;
    rates?: LivePricingRates;
  } = {},
): PlanEconomicsReport {
  const proMonthlyPriceEur = options.proMonthlyPriceEur ?? 19;
  const eurToUsd = options.eurToUsd ?? 1.08;
  const proMonthlyPriceUsd = Number((proMonthlyPriceEur * eurToUsd).toFixed(2));
  const stripeFeeUsd = proMonthlyPriceUsd * 0.029 + 0.30; // ~2.9% + $0.30
  const netRevenueUsd = Math.max(0, proMonthlyPriceUsd - stripeFeeUsd);

  const freeDailyLimit = options.freeDailyLimit ?? 20;
  const proDailyLimit = options.proDailyLimit ?? 300;
  const rates = options.rates ?? DEFAULT_LIVE_RATES;

  const profiles = SESSION_PROFILES.map((p) => estimateSessionCost(p, rates));
  const typical = profiles[1]; // 5-min typical session
  const typicalSessionCostUsd = typical.totalCostUsd;

  const breakEvenSessionsPerMonth = Math.floor(netRevenueUsd / typicalSessionCostUsd);
  const breakEvenSessionsPerDay = Number((breakEvenSessionsPerMonth / 30).toFixed(1));

  const rawScenarios = [
    { cohort: 'Free evaluation user', sessionsPerDay: 3, activeDaysPerMonth: 5, paid: false },
    { cohort: 'Free daily cap (20/day × 10d)', sessionsPerDay: freeDailyLimit, activeDaysPerMonth: 10, paid: false },
    { cohort: 'Typical Pro architect', sessionsPerDay: 10, activeDaysPerMonth: 20, paid: true },
    { cohort: 'Heavy Pro architect', sessionsPerDay: 35, activeDaysPerMonth: 22, paid: true },
    { cohort: 'Pro break-even threshold', sessionsPerDay: Math.floor(breakEvenSessionsPerDay), activeDaysPerMonth: 30, paid: true },
    { cohort: 'Pro 300/day hard ceiling (all 30d)', sessionsPerDay: proDailyLimit, activeDaysPerMonth: 30, paid: true },
  ];

  const scenarios = rawScenarios.map((s) => {
    const monthlySessions = s.sessionsPerDay * s.activeDaysPerMonth;
    const monthlyGeminiCostUsd = Number((monthlySessions * typicalSessionCostUsd).toFixed(2));
    const grossMarginPercent = s.paid
      ? Number((((netRevenueUsd - monthlyGeminiCostUsd) / proMonthlyPriceUsd) * 100).toFixed(1))
      : null;
    return {
      cohort: s.cohort,
      sessionsPerDay: s.sessionsPerDay,
      activeDaysPerMonth: s.activeDaysPerMonth,
      monthlySessions,
      monthlyGeminiCostUsd,
      grossMarginPercent,
    };
  });

  return {
    proMonthlyPriceEur,
    proMonthlyPriceUsd,
    proAnnualPriceEur: 180,
    freeDailyLimit,
    proDailyLimit,
    typicalSessionCostUsd,
    profiles,
    breakEvenSessionsPerMonth,
    breakEvenSessionsPerDay,
    scenarios,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = buildEconomicsReport();
  console.log('\n=== Voice Diagram Studio — Gemini Live Unit Economics ===\n');
  console.log(`Subscription Price: €${report.proMonthlyPriceEur}/mo ($${report.proMonthlyPriceUsd}/mo) | €${report.proAnnualPriceEur}/yr`);
  console.log(`Daily Allowances:   Free = ${report.freeDailyLimit}/day | Pro = ${report.proDailyLimit}/day`);
  console.log(`Typical Session:    $${report.typicalSessionCostUsd.toFixed(4)} USD (${ (report.typicalSessionCostUsd * 100).toFixed(2) } cents / 5-min session)`);
  console.log(`Break-even Volume:  ${report.breakEvenSessionsPerMonth} sessions/month (~${report.breakEvenSessionsPerDay} sessions/day every day)\n`);
  console.log('--- Per-Session Cost Breakdown ---');
  console.table(
    report.profiles.map((p) => ({
      Profile: p.profile,
      'Audio In (tok)': p.audioInputTokens,
      'Audio Out (tok)': p.audioOutputTokens,
      'Text/Tools (tok)': p.textInputTokens + p.textOutputTokens,
      'Cost (USD)': `$${p.totalCostUsd.toFixed(4)}`,
    })),
  );
  console.log('--- Monthly Cohort Margin Analysis ---');
  console.table(
    report.scenarios.map((s) => ({
      Cohort: s.cohort,
      'Sessions/Mo': s.monthlySessions,
      'Gemini Cost (USD)': `$${s.monthlyGeminiCostUsd.toFixed(2)}`,
      'Gross Margin': s.grossMarginPercent === null ? 'Free tier' : `${s.grossMarginPercent}%`,
    })),
  );
}
