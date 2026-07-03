import { postJson, reqJson } from '@/lib/api';
import type {
    OfComparison,
    OfEarningsOverview,
    OfForecast,
    OfHistoricalPoint,
    OfProfitabilityHistoryRow,
    OfProfitabilityRow,
    OfTxnByType,
    OfTxnSummary,
} from '@/types/crm';

/** Live agency-wide OnlyFans Analytics proxy for the dashboard. All calls hit
 *  /analytics/of/… (manager/admin only, gated server-side) and return the upstream
 *  payload under `{ data }`. Nothing is persisted. `accountIds` empty ⇒ all connected. */

export interface DateRange {
    start_date: string;
    end_date: string;
}

export interface ComparisonBody {
    period_a: { start: string; end: string };
    period_b: { start: string; end: string };
    granularity?: 'months' | 'quarters' | 'half_years' | 'years';
    stat_type?:
        | 'totalEarnings'
        | 'subscriptions'
        | 'posts'
        | 'messages'
        | 'tips'
        | 'streams';
}

export interface ForecastBody {
    metric: 'revenue' | 'churn_percentage';
    model: 'moving_average' | 'linear_regression' | 'arima' | 'sarima';
    historical_days: number;
    forecast_days: number;
}

const unwrap = <T>(p: Promise<{ data: T }>): Promise<T> =>
    p.then((r) => r.data);

export const ofAnalytics = {
    earnings: (accountIds: string[], range: DateRange) =>
        unwrap<OfEarningsOverview>(
            postJson('/analytics/of/earnings', {
                account_ids: accountIds,
                ...range,
            }),
        ),

    historical: (timeRange?: string) =>
        unwrap<OfHistoricalPoint[]>(
            postJson('/analytics/of/historical', { time_range: timeRange }),
        ),

    comparison: (accountIds: string[], body: ComparisonBody) =>
        unwrap<OfComparison>(
            postJson('/analytics/of/comparison', {
                account_ids: accountIds,
                ...body,
            }),
        ),

    transactionSummary: (accountIds: string[], range: DateRange) =>
        unwrap<OfTxnSummary>(
            postJson('/analytics/of/transactions/summary', {
                account_ids: accountIds,
                ...range,
            }),
        ),

    transactionsByType: (accountIds: string[], range: DateRange) =>
        unwrap<OfTxnByType[]>(
            postJson('/analytics/of/transactions/by-type', {
                account_ids: accountIds,
                ...range,
            }),
        ),

    forecast: (accountIds: string[], body: ForecastBody) =>
        unwrap<OfForecast>(
            postJson('/analytics/of/forecast', {
                account_ids: accountIds,
                ...body,
            }),
        ),

    profitability: (accountIds: string[], year: number, month: number) =>
        unwrap<OfProfitabilityRow[]>(
            postJson('/analytics/of/profitability', {
                account_ids: accountIds,
                year,
                month,
            }),
        ),

    profitabilityHistory: (modelId: number, months = 12) =>
        unwrap<OfProfitabilityHistoryRow[]>(
            reqJson(
                'GET',
                `/analytics/of/profitability/${modelId}/history?months=${months}`,
            ),
        ),
};
