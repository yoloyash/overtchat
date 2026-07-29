export const CONTEXT_METER_STORAGE_KEY = "overtchat_context_meter";
export const DEFAULT_CONTEXT_METER_ENABLED = true;
export const CONTEXT_METER_WARNING_PERCENT = 75;
export const CONTEXT_METER_CRITICAL_PERCENT = 90;

export interface ContextMeterValues {
  usedTokens: number;
  contextWindow?: number;
  percentage?: number;
  ringPercentage: number;
  remainingTokens?: number;
  warning: boolean;
  critical: boolean;
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function getContextMeterValues(
  usedTokens: number,
  contextWindow?: number,
): ContextMeterValues {
  const used = nonNegativeFinite(usedTokens);
  const maximum =
    contextWindow !== undefined &&
    Number.isFinite(contextWindow) &&
    contextWindow > 0
      ? contextWindow
      : undefined;

  if (maximum === undefined) {
    return {
      usedTokens: used,
      ringPercentage: 0,
      warning: false,
      critical: false,
    };
  }

  const rawPercentage = (used / maximum) * 100;
  const percentage = Math.round(rawPercentage);

  return {
    usedTokens: used,
    contextWindow: maximum,
    percentage,
    ringPercentage: Math.min(100, rawPercentage),
    remainingTokens: Math.max(0, maximum - used),
    warning: rawPercentage >= CONTEXT_METER_WARNING_PERCENT,
    critical: rawPercentage >= CONTEXT_METER_CRITICAL_PERCENT,
  };
}
