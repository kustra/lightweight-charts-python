import { BarData, CandlestickData, HistogramData, OhlcData, SingleValueData } from "lightweight-charts";
import { IndicatorDefinition } from "./indicators";

 // Helper export function to calculate ATR
  export function getATR(dataList: (BarData | CandlestickData)[], index: number, period: number): number {
    if (index < period - 1) return NaN;
  
    let sum = 0;
    for (let i = index - period + 1; i <= index; i++) {
      const tr = Math.max(
        dataList[i].high - dataList[i].low,
        Math.abs(dataList[i].high - dataList[i - 1]?.close || dataList[i].high),
        Math.abs(dataList[i].low - dataList[i - 1]?.close || dataList[i].low)
      );
      sum += tr;
    }
  
    return sum / period;
  }
 // Helper export functions
 export function getHighest(data: number[], period: number): number {
  if (data.length < period) return NaN;
  return Math.max(...data.slice(data.length - period));
}

export function getLowest(data: number[], period: number): number {
  if (data.length < period) return NaN;
  return Math.min(...data.slice(data.length - period));
}

export function getRound(value: number): number {
  return Math.round(value);
}

export function getSma(data: number[], period: number): number {
  if (data.length < period) return NaN;
  const subset = data.slice(data.length - period);
  return subset.reduce((sum, val) => sum + val, 0) / period;
}

export function getEma(data: number[], period: number): number {
  if (data.length < period) return NaN;
  const k = 2 / (period + 1);
  let emaVal = getSma(data, period);
  for (let i = data.length - period + 1; i < data.length; i++) {
    emaVal = data[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

export function getLinreg(data: number[], period: number, offset: number = 0): number {
  if (data.length < period) return NaN;
  const subset = data.slice(data.length - period);
  const n = period;
  const sumX = (n * (n - 1)) / 2;
  const sumY = subset.reduce((sum, val) => sum + val, 0);
  const sumXY = subset.reduce((sum, val, idx) => sum + idx * val, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return slope * (n - 1) / 2 + intercept + offset;
}

export function getAvg(...values: number[]): number {
  if (!values.length) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

// Helper export functions
export function getRsi(data: number[], period: number): number[] {
  const rsiArr: number[] = [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < data.length; i++) {
    const delta = data[i] - data[i - 1];
    if (delta > 0) {
      gain += delta;
    } else {
      loss -= delta;
    }
    if (i < period) {
      rsiArr.push(NaN);
    } else if (i === period) {
      const avgGain = gain / period;
      const avgLoss = loss / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiArr.push(100 - (100 / (1 + rs)));
    } else {
      const avgGain = (rsiArr[i - 1 - 1] * (period - 1) + (data[i] - data[i - 1] > 0 ? data[i] - data[i - 1] : 0)) / period;
      const avgLoss = (rsiArr[i - 1 - 1] * (period - 1) + (data[i] - data[i - 1] < 0 ? -(data[i] - data[i - 1]) : 0)) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiArr.push(100 - (100 / (1 + rs)));
    }
  }
  rsiArr.unshift(NaN); // Align with dataList index
  return rsiArr;
}

export function getBarssince(conditionArray: boolean[]): number {
  for (let i = conditionArray.length - 1; i >= 0; i--) {
    if (conditionArray[i]) {
      return conditionArray.length - 1 - i;
    }
  }
  return conditionArray.length;
}


export function getVwap(data: (BarData | CandlestickData | OhlcData)[], volumeData: SingleValueData[]): number {
  let sumPriceVolume = 0;
  let sumVolume = 0;
  data.forEach((bar,i) => {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    sumPriceVolume += typicalPrice * (volumeData[i].value || 0);
    sumVolume += (volumeData[i].value || 0);
  });
  return sumVolume !== 0 ? sumPriceVolume / sumVolume : 0};



  /**
 * Applies color attributes to each data point in a histogram series.
 * For the first point, the upColor is used.
 * For each subsequent point, if the current value is greater than or equal
 * to the previous value, upColor is used; otherwise, downColor is used.
 *
 * @param data - Array of data points with at least { time, value }.
 * @param upColor - Color to use when the value is rising (default: 'green').
 * @param downColor - Color to use when the value is falling (default: 'red').
 */
export function setHistogramColors(
  data: HistogramData[],
  upColor: string,
  downColor: string
): void {
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      data[i].color = upColor;
    } else {
      const currentValue = data[i].value;
      const previousValue = data[i - 1].value;
      if (!isNaN(currentValue) && !isNaN(previousValue)) {
        data[i].color = currentValue >= previousValue ? upColor : downColor;
      } else {
        data[i].color = upColor;
      }
    }
  }
}
/************************************************
 * Helper: getNumericArray
 * Ensures the override for a param is an array of numbers.
 * If the user passes a single number, we wrap it.
 ************************************************/
export function getNumericArray(
  overrideParams: Record<string, any> | undefined,
  paramName: string,
  defaultArr: number[]
): number[] {
  const val = overrideParams && paramName in overrideParams
    ? overrideParams[paramName]
    : defaultArr;
  return Array.isArray(val) ? val.map(x => Number(x)) : [Number(val)];
}

/************************************************
 * Helper: pickParam
 * For figure index i (0-based), pick arr[i] if exists; otherwise, repeat last.
 ************************************************/
export function pickParam<T extends number>(arr: T[], i: number): T {
  return i < arr.length ? arr[i] : arr[arr.length - 1];
}
/** 
 * A helper function to retrieve (paramMap + overrideParams) for each param key. 
 */
export function getParams(
  definition: IndicatorDefinition,
  overrideParams?: Record<string, any>
): Record<string, any> {
  const combined: Record<string, any> = {};
  for (const [paramName, spec] of Object.entries(definition.paramMap)) {
    const val = overrideParams?.[paramName] ?? spec.defaultValue;
    combined[paramName] = val;
  }
  return combined;
}
