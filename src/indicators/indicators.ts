/* 
  Complete Integration of All Indicators with Lightweight Charts
  ===============================================================
  Now each `paramMap` entry is an object like:
     shortPeriod: { defaultValue: 12, type: 'number', min:1, max:200 }

  This makes it straightforward to read param definitions, build a menu, 
  and override them when calling `calc(data, overrideParams)`.
*/

import {
  Time,
  OhlcData,
  BarData,
  CandlestickData
} from 'lightweight-charts';

// =========================
//  Basic Data Interfaces
// =========================

export interface SingleValueData {
  time: Time;
  value: number;
}

/** 
 * One indicator can produce multiple figures (lines or histograms).
 */
export interface IndicatorFigure {
  key: string;                 // e.g. "macd", "wr1", etc.
  title: string;               // e.g. "MACD", "WR(6)"
  type: 'line' | 'histogram';  // how we display it
  data: SingleValueData[];     // array of { time, value }
}

/** 
 * For each param, we store defaultValue plus some metadata (type, optional min/max).
 */
export interface IndicatorParamSpec {
  defaultValue: number;         // could store a numeric default
  type: 'number';               // in a more advanced approach, you could add 'select'|'boolean' etc.
  min?: number;
  max?: number;
  step?: number;
  options?:string[];

}

/** 
 * A single indicator definition.
 * paramMap: { [paramName]: IndicatorParamSpec } 
 */
export interface IndicatorDefinition {
  name: string;
  shortName: string;
  /** Whether it needs open/high/low/close or can rely on single-value. */
  shouldOhlc: boolean;  
  /** The default numeric parameters, each described by a small spec. */
  paramMap: Record<string, IndicatorParamSpec>;

  /**
   * The main calculation. Accept an optional overrides object 
   * with numeric values for each param key. 
   */
  calc(
    dataList: (BarData | CandlestickData | OhlcData)[],
    overrideParams?: Record<string, number>,
    volumeData?: SingleValueData[]
  ): IndicatorFigure[];
}

/** 
 * A helper function to retrieve (paramMap + overrideParams) for each param key. 
 */
function getParams(
  definition: IndicatorDefinition,
  overrideParams?: Record<string, number>
): Record<string, number> {
  const combined: Record<string, number> = {};
  for (const [paramName, spec] of Object.entries(definition.paramMap)) {
    const val = overrideParams?.[paramName] ?? spec.defaultValue;
    combined[paramName] = val;
  }
  return combined;
}




// -------------------------------------------------
// 2) awesomeOscillator (AO)
// -------------------------------------------------
const awesomeOscillator: IndicatorDefinition = {
  name: 'Awesome Oscillator',
  shortName: 'AO',
  shouldOhlc: true,
  paramMap: {
    shortPeriod: { defaultValue: 5, type: 'number', min: 1, max: 100 },
    longPeriod:  { defaultValue: 34, type: 'number', min: 1, max: 200 },
  },
  calc(dataList, overrideParams) {
    const p = getParams(this, overrideParams);
    const shortP = p.shortPeriod;
    const longP  = p.longPeriod;
    const maxP = Math.max(shortP, longP);

    let shortSum = 0;
    let longSum = 0;
    const aoArr: SingleValueData[] = [];

    dataList.forEach((bar, i) => {
      const mid = (bar.high + bar.low) / 2;
      shortSum += mid;
      longSum += mid;

      let sMa = NaN;
      let lMa = NaN;

      if (i >= shortP - 1) {
        sMa = shortSum / shortP;
        const removeVal = (dataList[i - (shortP - 1)].high + dataList[i - (shortP - 1)].low) / 2;
        shortSum -= removeVal;
      }
      if (i >= longP - 1) {
        lMa = longSum / longP;
        const removeVal = (dataList[i - (longP - 1)].high + dataList[i - (longP - 1)].low) / 2;
        longSum -= removeVal;
      }
      let aoVal = NaN;
      if (i >= maxP - 1) {
        aoVal = sMa - lMa;
      }
      aoArr.push({ time: bar.time, value: aoVal });
    });

    return [
      {
        key: 'ao',
        title: 'AO',
        type: 'histogram',
        data: aoArr,
      },
    ];
  },
};

// ============================================
//  3) bias (BIAS)
// ============================================
const bias: IndicatorDefinition = {
  name: 'Bias',
  shortName: 'BIAS',
  shouldOhlc: true,
  paramMap: {
    period1: { defaultValue: 6,  type: 'number', min:1, max:999 },
    period2: { defaultValue: 12, type: 'number', min:1, max:999 },
    period3: { defaultValue: 24, type: 'number', min:1, max:999 },
  },
  calc(dataList, overrideParams) {
    const p = getParams(this, overrideParams);
    const arrP = [p.period1, p.period2, p.period3];
    const sums = arrP.map(() => 0);

    const figures: IndicatorFigure[] = arrP.map((val, i) => ({
      key: `bias${i + 1}`,
      title: `BIAS${val}`,
      type: 'line',
      data: [],
    }));

    dataList.forEach((bar, i) => {
      const c = bar.close;
      arrP.forEach((period, idx) => {
        sums[idx] += c;
        if (i >= period - 1) {
          const mean = sums[idx] / period;
          const val = ((c - mean) / mean) * 100;
          figures[idx].data.push({ time: bar.time, value: val });
          sums[idx] -= dataList[i - (period - 1)].close;
        } else {
          figures[idx].data.push({ time: bar.time, value: NaN });
        }
      });
    });

    return figures;
  },
};

// ============================================
//  4) bollingerBands (BOLL)
// ============================================
function getBollMd(subset: (BarData | CandlestickData)[], mid: number) {
  let sum = 0;
  subset.forEach(bar => {
    const diff = bar.close - mid;
    sum += diff * diff;
  });
  return Math.sqrt(sum / subset.length);
}

const bollingerBands: IndicatorDefinition = {
  name: 'Bollinger Bands',
  shortName: 'BOLL',
  shouldOhlc: true,
  paramMap: {
    period:     { defaultValue: 20, type: 'number', min:1 },
    multiplier: { defaultValue:  2, type: 'number', min:0, step:0.5 },
  },
  calc(dataList, overrideParams) {
    const p = getParams(this, overrideParams);
    const period     = p.period;
    const multiplier = p.multiplier;

    let closeSum = 0;

    const upArr: SingleValueData[] = [];
    const midArr: SingleValueData[] = [];
    const dnArr: SingleValueData[] = [];

    dataList.forEach((bar, i) => {
      closeSum += bar.close;
      if (i >= period - 1) {
        const mid = closeSum / period;
        const windowData = dataList.slice(i - (period - 1), i + 1);
        const md = getBollMd(windowData, mid);
        const up = mid + multiplier * md;
        const dn = mid - multiplier * md;

        upArr.push({ time: bar.time, value: up });
        midArr.push({ time: bar.time, value: mid });
        dnArr.push({ time: bar.time, value: dn });

        closeSum -= dataList[i - (period - 1)].close;
      } else {
        upArr.push({ time: bar.time, value: NaN });
        midArr.push({ time: bar.time, value: NaN });
        dnArr.push({ time: bar.time, value: NaN });
      }
    });

    return [
      { key: 'up',  title: 'UP',  type: 'line', data: upArr },
      { key: 'mid', title: 'MID', type: 'line', data: midArr },
      { key: 'dn',  title: 'DN',  type: 'line', data: dnArr },
    ];
  },
};

// ============================================
//  5) brar (BRAR)
// ============================================
const brar: IndicatorDefinition = {
  name: 'Buy-Ratio Analysis',
  shortName: 'BRAR',
  shouldOhlc: true,
  paramMap: {
    period: { defaultValue: 26, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const p = getParams(this, overrideParams);
    const period = p.period;

    let hcy = 0, cyl = 0, ho = 0, ol = 0;
    const brData: SingleValueData[] = [];
    const arData: SingleValueData[] = [];

    dataList.forEach((bar, i) => {
      const prev = dataList[i - 1] ?? bar;
      ho += (bar.high - bar.open);
      ol += (bar.open - bar.low);
      hcy += (bar.high - prev.close);
      cyl += (prev.close - bar.low);

      if (i >= period - 1) {
        const brVal = cyl !== 0 ? (hcy / cyl) * 100 : 0;
        const arVal = ol !== 0 ? (ho / ol) * 100 : 0;
        brData.push({ time: bar.time, value: brVal });
        arData.push({ time: bar.time, value: arVal });

        const oldBar = dataList[i - (period - 1)];
        const oldPrev = dataList[i - period] ?? oldBar;
        hcy -= (oldBar.high - oldPrev.close);
        cyl -= (oldPrev.close - oldBar.low);
        ho -= (oldBar.high - oldBar.open);
        ol -= (oldBar.open - oldBar.low);
      } else {
        brData.push({ time: bar.time, value: NaN });
        arData.push({ time: bar.time, value: NaN });
      }
    });

    return [
      { key: 'br', title: 'BR', type: 'line', data: brData },
      { key: 'ar', title: 'AR', type: 'line', data: arData },
    ];
  },
};

// ============================================
//  6) bullAndBearIndex (BBI)
// ============================================
const bullAndBearIndex: IndicatorDefinition = {
  name: 'Bull and Bear Index',
  shortName: 'BBI',
  shouldOhlc: true,
  paramMap: {
    p1: { defaultValue: 3,  type: 'number', min:1 },
    p2: { defaultValue: 6,  type: 'number', min:1 },
    p3: { defaultValue: 12, type: 'number', min:1 },
    p4: { defaultValue: 24, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const params = [pm.p1, pm.p2, pm.p3, pm.p4];
    const maxPeriod = Math.max(...params);
    const sums = [0, 0, 0, 0];
    const mas  = [0, 0, 0, 0];

    const bbiArr: SingleValueData[] = [];
    dataList.forEach((bar, i) => {
      const c = bar.close;
      params.forEach((p, idx) => {
        sums[idx] += c;
        if (i >= p - 1) {
          mas[idx] = sums[idx] / p;
          sums[idx] -= dataList[i - (p - 1)].close;
        }
      });
      if (i >= maxPeriod - 1) {
        const val = (mas[0] + mas[1] + mas[2] + mas[3]) / 4;
        bbiArr.push({ time: bar.time, value: val });
      } else {
        bbiArr.push({ time: bar.time, value: NaN });
      }
    });

    return [
      { key: 'bbi', title: 'BBI', type: 'line', data: bbiArr },
    ];
  },
};

// ============================================
//  7) commodityChannelIndex (CCI)
// ============================================
const commodityChannelIndex: IndicatorDefinition = {
  name: 'Commodity Channel Index',
  shortName: 'CCI',
  shouldOhlc: true,
  paramMap: {
    period: { defaultValue: 20, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pmap = getParams(this, overrideParams);
    const period = pmap.period;
    const p = period - 1;
    let tpSum = 0;
    const tpList: number[] = [];
    const cciArr: SingleValueData[] = [];

    dataList.forEach((bar, i) => {
      const tp = (bar.high + bar.low + bar.close) / 3;
      tpSum += tp;
      tpList.push(tp);
      if (i >= p) {
        const maTp = tpSum / period;
        let sumAbs = 0;
        for (let j = i - p; j <= i; j++) {
          sumAbs += Math.abs(tpList[j] - maTp);
        }
        const md = sumAbs / period;
        const cciVal = md !== 0 ? ((tp - maTp) / md / 0.015) : 0;
        cciArr.push({ time: bar.time, value: cciVal });

        const agoTp = (dataList[i - p].high + dataList[i - p].low + dataList[i - p].close) / 3;
        tpSum -= agoTp;
      } else {
        cciArr.push({ time: bar.time, value: NaN });
      }
    });

    return [
      { key: 'cci', title: 'CCI', type: 'line', data: cciArr },
    ];
  },
};

// ============================================
//  8) currentRatio (CR)
// ============================================
const currentRatio: IndicatorDefinition = {
  name: 'Current Ratio',
  shortName: 'CR',
  shouldOhlc: true,
  paramMap: {
    period: { defaultValue: 26, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const N = pm.period;

    const crData: SingleValueData[] = [];
    let sumNum = 0;
    let sumDen = 0;
    const queueNum: number[] = [];
    const queueDen: number[] = [];

    dataList.forEach((bar, i) => {
      const prev = dataList[i - 1] ?? bar;
      const mid = (prev.high + prev.low) / 2;
      const highSubMid = Math.max(0, bar.high - mid);
      const midSubLow = Math.max(0, mid - bar.low);
      sumNum += highSubMid;
      sumDen += midSubLow;
      queueNum.push(highSubMid);
      queueDen.push(midSubLow);

      let crVal = NaN;
      if (i >= N - 1) {
        crVal = (sumDen !== 0) ? (sumNum / sumDen * 100) : 0;
        sumNum -= queueNum[i - (N - 1)];
        sumDen -= queueDen[i - (N - 1)];
      }
      crData.push({ time: bar.time, value: crVal });
    });

    return [
      { key: 'cr', title: 'CR', type: 'line', data: crData },
    ];
  },
};

// ============================================
//  9) differentOfMovingAverage (DMA)
// ============================================
const differentOfMovingAverage: IndicatorDefinition = {
  name: 'Difference of Moving Average',
  shortName: 'DMA',
  shouldOhlc: true,
  paramMap: {
    n1: { defaultValue: 10, type: 'number', min:1 },
    n2: { defaultValue: 50, type: 'number', min:1 },
    m:  { defaultValue: 10, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const n1 = pm.n1;
    const n2 = pm.n2;
    const m  = pm.m;
    const maxP = Math.max(n1, n2);

    let sum1 = 0, sum2 = 0;
    let dmaSum = 0;

    const dmaArr: SingleValueData[] = [];
    const amaArr: SingleValueData[] = [];

    const resultsDma: number[] = [];

    dataList.forEach((bar, i) => {
      sum1 += bar.close;
      sum2 += bar.close;
      let ma1 = NaN, ma2 = NaN;

      if (i >= n1 - 1) {
        ma1 = sum1 / n1;
        sum1 -= dataList[i - (n1 - 1)].close;
      }
      if (i >= n2 - 1) {
        ma2 = sum2 / n2;
        sum2 -= dataList[i - (n2 - 1)].close;
      }

      if (i >= maxP - 1) {
        const dif = ma1 - ma2;
        resultsDma.push(dif);
        dmaArr.push({ time: bar.time, value: dif });

        dmaSum += dif;
        if (resultsDma.length > m) {
          dmaSum -= resultsDma[resultsDma.length - 1 - m];
          const amaVal = dmaSum / m;
          amaArr.push({ time: bar.time, value: amaVal });
        } else {
          amaArr.push({ time: bar.time, value: NaN });
        }
      } else {
        dmaArr.push({ time: bar.time, value: NaN });
        amaArr.push({ time: bar.time, value: NaN });
      }
    });

    return [
      { key: 'dma', title: 'DMA', type: 'line', data: dmaArr },
      { key: 'ama', title: 'AMA', type: 'line', data: amaArr },
    ];
  },
};

// ============================================
// 10) directionalMovementIndex (DMI)
// ============================================
const directionalMovementIndex: IndicatorDefinition = {
  name: 'Directional Movement Index',
  shortName: 'DMI',
  shouldOhlc: true,
  paramMap: {
    n:  { defaultValue: 14, type: 'number', min:1 },
    mm: { defaultValue: 6,  type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const N = pm.n;
    const MM = pm.mm;

    let tr = 0, dmp = 0, dmm = 0;
    let adx = 0;
    let outAdxStarted = false;

    const pdiArr: SingleValueData[] = [];
    const mdiArr: SingleValueData[] = [];
    const adxArr: SingleValueData[] = [];
    const adxrArr: SingleValueData[] = [];

    dataList.forEach((bar, i) => {
      const prev = dataList[i - 1] ?? bar;
      const highDiff = bar.high - prev.high;
      const lowDiff = prev.low - bar.low;

      const cTr = Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - prev.close),
        Math.abs(prev.close - bar.low)
      );

      let cDmp = 0, cDmm = 0;
      if (highDiff > 0 && highDiff > lowDiff) cDmp = highDiff;
      if (lowDiff > 0 && lowDiff > highDiff) cDmm = lowDiff;

      if (i === 0) {
        tr = cTr;
        dmp = cDmp;
        dmm = cDmm;
      } else {
        tr = (tr * (N - 1) + cTr) / N;
        dmp = (dmp * (N - 1) + cDmp) / N;
        dmm = (dmm * (N - 1) + cDmm) / N;
      }

      let pdi = NaN, mdi = NaN;
      if (tr !== 0) {
        pdi = (dmp / tr) * 100;
        mdi = (dmm / tr) * 100;
      }

      pdiArr.push({ time: bar.time, value: pdi });
      mdiArr.push({ time: bar.time, value: mdi });

      let dx = NaN;
      if (!isNaN(pdi) && !isNaN(mdi) && (pdi + mdi) !== 0) {
        dx = (Math.abs(mdi - pdi) / (mdi + pdi)) * 100;
      }

      if (i < N - 1) {
        adxArr.push({ time: bar.time, value: NaN });
        adxrArr.push({ time: bar.time, value: NaN });
      } else {
        if (!outAdxStarted) {
          // first ADX
          adx = dx;
          outAdxStarted = true;
        } else {
          adx = (adx * (N - 1) + dx) / N;
        }
        adxArr.push({ time: bar.time, value: adx });

        if (i < N - 1 + MM) {
          adxrArr.push({ time: bar.time, value: NaN });
        } else {
          const olderAdx = adxArr[adxArr.length - 1 - MM];
          if (olderAdx) {
            const val = (adx + olderAdx.value) / 2;
            adxrArr.push({ time: bar.time, value: val });
          } else {
            adxrArr.push({ time: bar.time, value: NaN });
          }
        }
      }
    });

    return [
      { key: 'pdi',  title: 'PDI',  type: 'line', data: pdiArr },
      { key: 'mdi',  title: 'MDI',  type: 'line', data: mdiArr },
      { key: 'adx',  title: 'ADX',  type: 'line', data: adxArr },
      { key: 'adxr', title: 'ADXR', type: 'line', data: adxrArr },
    ];
  },
};

// ============================================
// 12) exponentialMovingAverage (EMA)
// ============================================
const exponentialMovingAverage: IndicatorDefinition = {
  name: 'Exponential Moving Average',
  shortName: 'EMA',
  shouldOhlc: true,
  paramMap: {
    p1: { defaultValue: 6,  type: 'number', min:1 },
    p2: { defaultValue: 12, type: 'number', min:1 },
    p3: { defaultValue: 20, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const periods = [pm.p1, pm.p2, pm.p3];
    const emaValues = periods.map(() => 0);
    const sums = periods.map(() => 0);

    const figures: IndicatorFigure[] = periods.map((pp, i) => ({
      key: `ema${i + 1}`,
      title: `EMA${pp}`,
      type: 'line',
      data: [],
    }));

    dataList.forEach((bar, i) => {
      const c = bar.close;
      periods.forEach((p, idx) => {
        sums[idx] += c;
        if (i === p - 1) {
          // first initialization is just an average
          emaValues[idx] = sums[idx] / p;
        } else if (i > p - 1) {
          const multiplier = 2 / (p + 1);
          emaValues[idx] = (c - emaValues[idx]) * multiplier + emaValues[idx];
        }
        if (i >= p - 1) {
          figures[idx].data.push({ time: bar.time, value: emaValues[idx] });
        } else {
          figures[idx].data.push({ time: bar.time, value: NaN });
        }
      });
    });

    return figures;
  },
};

// ============================================
// 13) momentum (MTM)
// ============================================
const momentum: IndicatorDefinition = {
  name: 'Momentum',
  shortName: 'MTM',
  shouldOhlc: true,
  paramMap: {
    n: { defaultValue: 12, type: 'number', min:1 },
    m: { defaultValue: 6,  type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const N = pm.n;
    const M = pm.m;

    const mtmArr: SingleValueData[] = [];
    const maMtmArr: SingleValueData[] = [];

    let sumMtm = 0;
    const mtmBuffer: number[] = [];

    dataList.forEach((bar, i) => {
      if (i >= N) {
        const oldBar = dataList[i - N];
        const val = bar.close - oldBar.close;
        mtmArr.push({ time: bar.time, value: val });
        mtmBuffer.push(val);
        sumMtm += val;
        if (mtmBuffer.length > M) {
          sumMtm -= mtmBuffer[mtmBuffer.length - 1 - M];
        }
        const maVal = (mtmBuffer.length >= M) ? sumMtm / M : NaN;
        maMtmArr.push({ time: bar.time, value: maVal });
      } else {
        mtmArr.push({ time: bar.time, value: NaN });
        maMtmArr.push({ time: bar.time, value: NaN });
      }
    });

    return [
      { key: 'mtm',   title: 'MTM',   type: 'line', data: mtmArr },
      { key: 'maMtm', title: 'MAMTM', type: 'line', data: maMtmArr },
    ];
  },
};

// ============================================
// 14) movingAverage (MA)
// ============================================
const movingAverage: IndicatorDefinition = {
  name: 'Moving Average',
  shortName: 'MA',
  shouldOhlc: true,
  paramMap: {
    p1: { defaultValue: 5,  type: 'number', min:1 },
    p2: { defaultValue: 10, type: 'number', min:1 },
    p3: { defaultValue: 30, type: 'number', min:1 },
    p4: { defaultValue: 60, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const arrP = [pm.p1, pm.p2, pm.p3, pm.p4];
    const sums = arrP.map(() => 0);

    const lines: IndicatorFigure[] = arrP.map((val, i) => ({
      key: `ma${i + 1}`,
      title: `MA${val}`,
      type: 'line',
      data: [],
    }));

    dataList.forEach((bar, i) => {
      const c = bar.close;
      arrP.forEach((p, idx) => {
        sums[idx] += c;
        if (i >= p - 1) {
          const avg = sums[idx] / p;
          lines[idx].data.push({ time: bar.time, value: avg });
          sums[idx] -= dataList[i - (p - 1)].close;
        } else {
          lines[idx].data.push({ time: bar.time, value: NaN });
        }
      });
    });

    return lines;
  },
};

// ============================================
// 15) movingAverageConvergenceDivergence (MACD)
// ============================================
const movingAverageConvergenceDivergence: IndicatorDefinition = {
  name: 'Moving Average Convergence Divergence',
  shortName: 'MACD',
  shouldOhlc: true,
  paramMap: {
    shortPeriod:  { defaultValue: 12, type: 'number', min:1 },
    longPeriod:   { defaultValue: 26, type: 'number', min:1 },
    signalPeriod: { defaultValue:  9, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const shortP = pm.shortPeriod;
    const longP = pm.longPeriod;
    const signalP = pm.signalPeriod;

    let emaShort = 0, emaLong = 0;
    let dif = 0, dea = 0;
    let difSum = 0;

    const difArr: SingleValueData[] = [];
    const deaArr: SingleValueData[] = [];
    const macdArr: SingleValueData[] = [];

    let sumClose = 0;

    dataList.forEach((bar, i) => {
      sumClose += bar.close;
      // init short
      if (i === shortP - 1) {
        emaShort = sumClose / shortP;
      } else if (i > shortP - 1) {
        emaShort = (bar.close * 2 + (shortP - 1) * emaShort) / (shortP + 1);
      }
      // init long
      if (i === longP - 1) {
        emaLong = sumClose / longP;
      } else if (i > longP - 1) {
        emaLong = (bar.close * 2 + (longP - 1) * emaLong) / (longP + 1);
      }

      if (i >= Math.max(shortP, longP) - 1) {
        dif = emaShort - emaLong;
        difArr.push({ time: bar.time, value: dif });
        difSum += dif;
        if (difArr.length === signalP) {
          dea = difSum / signalP;
        } else if (difArr.length > signalP) {
          dea = (dif * 2 + (signalP - 1) * dea) / (signalP + 1);
        }
        if (difArr.length >= signalP) {
          deaArr.push({ time: bar.time, value: dea });
          macdArr.push({ time: bar.time, value: (dif - dea) * 2 });
        } else {
          deaArr.push({ time: bar.time, value: NaN });
          macdArr.push({ time: bar.time, value: NaN });
        }
      } else {
        difArr.push({ time: bar.time, value: NaN });
        deaArr.push({ time: bar.time, value: NaN });
        macdArr.push({ time: bar.time, value: NaN });
      }
    });

    return [
      { key: 'dif',  title: 'DIF',  type: 'line',       data: difArr },
      { key: 'dea',  title: 'DEA',  type: 'line',       data: deaArr },
      { key: 'macd', title: 'MACD', type: 'histogram',  data: macdArr },
    ];
  },
};

// ============================================
// 18) psychologicalLine (PSY)
// ============================================
const psychologicalLine: IndicatorDefinition = {
  name: 'Psychological Line',
  shortName: 'PSY',
  shouldOhlc: true,
  paramMap: {
    n: { defaultValue: 12, type: 'number', min:1 },
    m: { defaultValue:  6, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const N = pm.n;
    const M = pm.m;

    let upCount = 0;
    const upQueue: number[] = [];
    let psySum = 0;

    const psyArr: SingleValueData[] = [];
    const maPsyArr: SingleValueData[] = [];

    const psyBuffer: number[] = [];

    dataList.forEach((bar, i) => {
      const prev = dataList[i - 1] ?? bar;
      const upFlag = bar.close > prev.close ? 1 : 0;
      upQueue.push(upFlag);
      upCount += upFlag;

      if (i >= N - 1) {
        const ratio = (upCount / N) * 100;
        psyArr.push({ time: bar.time, value: ratio });
        psyBuffer.push(ratio);
        psySum += ratio;
        if (psyBuffer.length > M) {
          psySum -= psyBuffer[psyBuffer.length - 1 - M];
        }
        const maVal = (psyBuffer.length >= M) ? (psySum / M) : NaN;
        maPsyArr.push({ time: bar.time, value: maVal });

        upCount -= upQueue[i - (N - 1)];
      } else {
        psyArr.push({ time: bar.time, value: NaN });
        maPsyArr.push({ time: bar.time, value: NaN });
      }
    });

    return [
      { key: 'psy',   title: 'PSY',   type: 'line', data: psyArr },
      { key: 'maPsy', title: 'MAPSY', type: 'line', data: maPsyArr },
    ];
  },
};

// ============================================
// 19) rateOfChange (ROC)
// ============================================
const rateOfChange: IndicatorDefinition = {
  name: 'Rate of Change',
  shortName: 'ROC',
  shouldOhlc: true,
  paramMap: {
    n: { defaultValue: 12, type: 'number', min:1 },
    m: { defaultValue:  6, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const N = pm.n;
    const M = pm.m;

    const rocArr: SingleValueData[] = [];
    const maRocArr: SingleValueData[] = [];

    let rocSum = 0;
    const buffer: number[] = [];

    dataList.forEach((bar, i) => {
      if (i >= N) {
        const ago = dataList[i - N];
        const prevClose = ago.close;
        let rocVal = 0;
        if (prevClose !== 0) {
          rocVal = (bar.close - prevClose) / prevClose * 100;
        }
        rocArr.push({ time: bar.time, value: rocVal });
        buffer.push(rocVal);
        rocSum += rocVal;
        if (buffer.length > M) {
          rocSum -= buffer[buffer.length - 1 - M];
        }
        const maVal = (buffer.length >= M) ? (rocSum / M) : NaN;
        maRocArr.push({ time: bar.time, value: maVal });
      } else {
        rocArr.push({ time: bar.time, value: NaN });
        maRocArr.push({ time: bar.time, value: NaN });
      }
    });

    return [
      { key: 'roc',   title: 'ROC',   type: 'line', data: rocArr },
      { key: 'maRoc', title: 'MAROC', type: 'line', data: maRocArr },
    ];
  },
};

// ============================================
// 20) relativeStrengthIndex (RSI)
// ============================================
const relativeStrengthIndex: IndicatorDefinition = {
  name: 'Relative Strength Index',
  shortName: 'RSI',
  shouldOhlc: true,
  paramMap: {
    p1: { defaultValue:  6, type: 'number', min:1 },
    p2: { defaultValue: 12, type: 'number', min:1 },
    p3: { defaultValue: 24, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const arrP = [pm.p1, pm.p2, pm.p3];
    const upSums = arrP.map(() => 0);
    const downSums = arrP.map(() => 0);

    const lines: IndicatorFigure[] = arrP.map((val, i) => ({
      key: `rsi${i + 1}`,
      title: `RSI${val}`,
      type: 'line',
      data: [],
    }));

    dataList.forEach((bar, i) => {
      const prev = dataList[i - 1] ?? bar;
      const diff = bar.close - prev.close;
      arrP.forEach((p, idx) => {
        if (diff > 0) {
          upSums[idx] += diff;
        } else {
          downSums[idx] += Math.abs(diff);
        }
        if (i >= p - 1) {
          const rsiVal = downSums[idx] !== 0
            ? (100 - (100 / (1 + upSums[idx] / downSums[idx])))
            : 100;
          lines[idx].data.push({ time: bar.time, value: rsiVal });

          const oldDiff = dataList[i - (p - 1)].close - dataList[i - p]?.close;
          if (oldDiff > 0) {
            upSums[idx] -= oldDiff;
          } else {
            downSums[idx] -= Math.abs(oldDiff);
          }
        } else {
          lines[idx].data.push({ time: bar.time, value: NaN });
        }
      });
    });

    return lines;
  },
};

// ============================================
// 21) simpleMovingAverage (SMA)
// ============================================
const simpleMovingAverage: IndicatorDefinition = {
  name: 'Simple Moving Average',
  shortName: 'SMA',
  shouldOhlc: true,
  paramMap: {
    n: { defaultValue: 12, type: 'number', min:1 },
    k: { defaultValue:  2, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const N = pm.n;
    const K = pm.k;

    let closeSum = 0;
    let smaVal = 0;
    const smaArr: SingleValueData[] = [];

    dataList.forEach((bar, i) => {
      closeSum += bar.close;
      if (i >= N - 1) {
        if (i === N - 1) {
          // first initialization
          smaVal = closeSum / N;
        } else {
          // formula: (CLOSE*K + SMA*(N-K)) / N
          smaVal = (bar.close * K + smaVal * (N - K)) / N;
        }
        closeSum -= dataList[i - (N - 1)].close;
        smaArr.push({ time: bar.time, value: smaVal });
      } else {
        smaArr.push({ time: bar.time, value: NaN });
      }
    });

    return [
      { key: 'sma', title: 'SMA', type: 'line', data: smaArr },
    ];
  },
};

// ============================================
// 22) stoch (a.k.a. KDJ)
// ============================================
const stoch: IndicatorDefinition = {
  name: 'Stochastic',
  shortName: 'KDJ',
  shouldOhlc: true,
  paramMap: {
    n:       { defaultValue: 9, type: 'number', min:1 },
    kPeriod: { defaultValue: 3, type: 'number', min:1 },
    dPeriod: { defaultValue: 3, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const n       = pm.n;
    const kPeriod = pm.kPeriod;
    const dPeriod = pm.dPeriod;

    let prevK = 50, prevD = 50;

    const kArr: SingleValueData[] = [];
    const dArr: SingleValueData[] = [];
    const jArr: SingleValueData[] = [];

    dataList.forEach((bar, i) => {
      if (i < n - 1) {
        kArr.push({ time: bar.time, value: NaN });
        dArr.push({ time: bar.time, value: NaN });
        jArr.push({ time: bar.time, value: NaN });
        return;
      }
      const slice = dataList.slice(i - (n - 1), i + 1);
      const highN = Math.max(...slice.map(b => b.high));
      const lowN  = Math.min(...slice.map(b => b.low));
      const rsv   = (highN === lowN) ? 100 : ((bar.close - lowN) / (highN - lowN) * 100);

      const kVal = ((kPeriod - 1) * prevK + rsv) / kPeriod;
      const dVal = ((dPeriod - 1) * prevD + kVal) / dPeriod;
      const jVal = 3 * kVal - 2 * dVal;

      kArr.push({ time: bar.time, value: kVal });
      dArr.push({ time: bar.time, value: dVal });
      jArr.push({ time: bar.time, value: jVal });

      prevK = kVal;
      prevD = dVal;
    });

    return [
      { key: 'k', title: 'K', type: 'line', data: kArr },
      { key: 'd', title: 'D', type: 'line', data: dArr },
      { key: 'j', title: 'J', type: 'line', data: jArr },
    ];
  },
};

// ============================================
// 23) stopAndReverse (SAR)
// ============================================
const stopAndReverse: IndicatorDefinition = {
  name: 'Stop and Reverse',
  shortName: 'SAR',
  shouldOhlc: true,
  paramMap: {
    accStart: { defaultValue: 0.02, type: 'number', min:0 },
    accStep:  { defaultValue: 0.02, type: 'number', min:0 },
    accMax:   { defaultValue: 0.20, type: 'number', min:0 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const accStart = pm.accStart;
    const accStep  = pm.accStep;
    const accMax   = pm.accMax;

    let af = accStart;
    let ep = 0;
    let sar = 0;
    let isUp = false;

    const sarArr: SingleValueData[] = [];

    dataList.forEach((bar, i) => {
      if (i === 0) {
        sarArr.push({ time: bar.time, value: NaN });
        return;
      }
      if (i === 1) {
        isUp = (bar.close > dataList[0].close);
        ep = isUp ? bar.high : bar.low;
        sar = isUp ? dataList[0].low : dataList[0].high;
        sarArr.push({ time: dataList[0].time, value: sar });
      }

      sar = sar + af * (ep - sar);

      if (isUp) {
        if (bar.low < sar) {
          isUp = false;
          sar = ep;
          af = accStart;
          ep = bar.low;
        } else {
          if (bar.high > ep) {
            ep = bar.high;
            af = Math.min(af + accStep, accMax);
          }
        }
      } else {
        if (bar.high > sar) {
          isUp = true;
          sar = ep;
          af = accStart;
          ep = bar.high;
        } else {
          if (bar.low < ep) {
            ep = bar.low;
            af = Math.min(af + accStep, accMax);
          }
        }
      }

      sarArr.push({ time: bar.time, value: sar });
    });

    return [
      { key: 'sar', title: 'SAR', type: 'line', data: sarArr },
    ];
  },
};

// ============================================
// 24) tripleExponentiallySmoothedAverage (TRIX)
// ============================================
const tripleExponentiallySmoothedAverage: IndicatorDefinition = {
  name: 'TRIX',
  shortName: 'TRIX',
  shouldOhlc: true,
  paramMap: {
    n: { defaultValue: 12, type: 'number', min:1 },
    m: { defaultValue:  9, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const N = pm.n;
    const M = pm.m;

    let ema1 = 0, ema2 = 0, ema3 = 0;
    let sumClose = 0;
    const trixArr: SingleValueData[] = [];
    const maTrixArr: SingleValueData[] = [];
    let trixSum = 0;
    const buffer: number[] = [];

    dataList.forEach((bar, i) => {
      sumClose += bar.close;

      // 1) EMA1
      if (i === N - 1) {
        ema1 = sumClose / N;
      } else if (i > N - 1) {
        ema1 = (bar.close * 2 + (N - 1) * ema1) / (N + 1);
      }

      // 2) EMA2
      if (i >= N - 1) {
        if (i === 2*N - 2) {
          ema2 = ema1;
        } else if (i > 2*N - 2) {
          ema2 = (ema1 * 2 + (N - 1) * ema2) / (N + 1);
        }
      }

      // 3) EMA3
      let trVal = NaN;
      if (i >= 2*N - 2) {
        if (i === 3*N - 3) {
          ema3 = ema2;
        } else if (i > 3*N - 3) {
          const old = ema3;
          ema3 = (ema2 * 2 + (N - 1) * old) / (N + 1);
          trVal = (ema3 - old) / old * 100;
        }
      }

      trixArr.push({ time: bar.time, value: trVal });
      buffer.push(trVal);
      trixSum += (isNaN(trVal) ? 0 : trVal);

      if (buffer.length > M) {
        const oldest = buffer[buffer.length - 1 - M];
        trixSum -= (isNaN(oldest) ? 0 : oldest);
      }
      const maVal = (buffer.length >= M && !isNaN(trVal)) ? (trixSum / M) : NaN;
      maTrixArr.push({ time: bar.time, value: maVal });
    });

    return [
      { key: 'trix',   title: 'TRIX',   type: 'line', data: trixArr },
      { key: 'maTrix', title: 'MATRIX', type: 'line', data: maTrixArr },
    ];
  },
};

// ============================================
// 27) williamsR (WR)
// ============================================
const williamsR: IndicatorDefinition = {
  name: 'Williams %R',
  shortName: 'WR',
  shouldOhlc: true,
  paramMap: {
    p1: { defaultValue:  6, type: 'number', min:1 },
    p2: { defaultValue: 10, type: 'number', min:1 },
    p3: { defaultValue: 14, type: 'number', min:1 },
  },
  calc(dataList, overrideParams) {
    const pm = getParams(this, overrideParams);
    const arrP = [pm.p1, pm.p2, pm.p3];

    const lines: IndicatorFigure[] = arrP.map((val, i) => ({
      key: `wr${i + 1}`,
      title: `WR${val}`,
      type: 'line',
      data: [],
    }));

    dataList.forEach((bar, i) => {
      arrP.forEach((period, idx) => {
        if (i >= period - 1) {
          let highest = -Infinity, lowest = Infinity;
          for (let j = i - (period - 1); j <= i; j++) {
            highest = Math.max(highest, dataList[j].high);
            lowest  = Math.min(lowest,  dataList[j].low);
          }
          const wrVal = (highest !== lowest)
            ? ((bar.close - highest) / (highest - lowest)) * 100
            : 0;
          lines[idx].data.push({ time: bar.time, value: wrVal });
        } else {
          lines[idx].data.push({ time: bar.time, value: NaN });
        }
      });
    });

    return lines;
  },
};

//------------------------------------------------------------------
//From Pinescript: 
//


// ============================================
//  1) Arnaud Legoux Moving Average (ALMA)
// ============================================
const arnaudLegouxMovingAverage: IndicatorDefinition = {
    name: 'Arnaud Legoux Moving Average',
    shortName: 'ALMA',
    shouldOhlc: false,
    paramMap: {
      windowSize: { defaultValue: 9, type: 'number', min: 1, max: 200 },
      offset:     { defaultValue: 0.85, type: 'number', min: 0, max: 1, step: 0.01 },
      sigma:      { defaultValue: 6, type: 'number', min: 1, max: 10 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const windowSize = p.windowSize;
      const offset = p.offset;
      const sigma = p.sigma;
  
      const m = offset * (windowSize - 1);
      const s = windowSize / sigma;
  
      const almaArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        if (i < windowSize - 1) {
          almaArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        let norm = 0;
        let sum = 0;
  
        for (let j = 0; j < windowSize; j++) {
          const weight = Math.exp(-Math.pow(j - m, 2) / (2 * Math.pow(s, 2)));
          norm += weight;
          sum += dataList[i - (windowSize - j - 1)].close * weight;
        }
  
        almaArr.push({ time: bar.time, value: sum / norm });
      });
  
      return [{ key: 'alma', title: 'ALMA', type: 'line', data: almaArr }];
    },
  };
  
  // ============================================
  //  2) Running Moving Average (RMA)
  // ============================================
  const rollingMovingAverage: IndicatorDefinition = {
    name: 'Rolling Moving Average',
    shortName: 'RMA',
    shouldOhlc: false,
    paramMap: {
      length: { defaultValue: 14, type: 'number', min: 1, max: 200 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const length = p.length;
      const alpha = 1 / length;
  
      const rmaArr: SingleValueData[] = [];
      let sum = 0;
  
      dataList.forEach((bar, i) => {
        if (i === 0) {
          sum = bar.close;
        } else {
          sum = alpha * bar.close + (1 - alpha) * sum;
        }
        rmaArr.push({ time: bar.time, value: sum });
      });
  
      return [{ key: 'rma', title: 'RMA', type: 'line', data: rmaArr }];
    },
  };
  
  // ============================================
  //  3) Symmetric Weighted Moving Average (SWMA)
  // ============================================
  const symmetricWeightedMovingAverage: IndicatorDefinition = {
    name: 'Symmetrically Weighted Moving Average',
    shortName: 'SWMA',
    shouldOhlc: false,
    paramMap: {},
    calc(dataList) {
      const swmaArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        if (i < 3) {
          swmaArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        const swmaValue =
          (dataList[i - 3].close * 1 / 6) +
          (dataList[i - 2].close * 2 / 6) +
          (dataList[i - 1].close * 2 / 6) +
          (dataList[i].close * 1 / 6);
  
        swmaArr.push({ time: bar.time, value: swmaValue });
      });
  
      return [{ key: 'swma', title: 'SWMA', type: 'line', data: swmaArr }];
    },
  };
  
  // ============================================
  //  4) Weighted Moving Average (WMA)
  // ============================================
  const weightedMovingAverage: IndicatorDefinition = {
    name: 'weighted Moving Average',
    shortName: 'WMA',
    shouldOhlc: false,
    paramMap: {
      length: { defaultValue: 9, type: 'number', min: 1, max: 200 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const length = p.length;
  
      const wmaArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        if (i < length - 1) {
          wmaArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        let norm = 0;
        let sum = 0;
  
        for (let j = 0; j < length; j++) {
          const weight = (length - j);
          norm += weight;
          sum += dataList[i - j].close * weight;
        }
  
        wmaArr.push({ time: bar.time, value: sum / norm });
      });
  
      return [{ key: 'wma', title: 'WMA', type: 'line', data: wmaArr }];
    },
  };
  


  const superTrend: IndicatorDefinition = {
    name: 'Super Trend',
    shortName: 'SuperTrend',
    shouldOhlc: true,
    paramMap: {
      factor:     { defaultValue: 3,  type: 'number', min: 1, max: 10, step: 0.1 },
      atrPeriod:  { defaultValue: 10, type: 'number', min: 1, max: 50 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const factor = p.factor;
      const atrPeriod = p.atrPeriod;
  
      const superTrendArr: SingleValueData[] = [];
      const directionArr: SingleValueData[] = [];
  
      let prevSuperTrend = NaN;
      let prevUpperBand = NaN;
      let prevLowerBand = NaN;
      let _direction = NaN;
  
      dataList.forEach((bar, i) => {
        if (i < atrPeriod - 1) {
          superTrendArr.push({ time: bar.time, value: NaN });
          directionArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        const src = (bar.high + bar.low) / 2;
        const atr = getATR(dataList, i, atrPeriod);
  
        let upperBand = src + factor * atr;
        let lowerBand = src - factor * atr;
  
        if (!isNaN(prevLowerBand)) {
          lowerBand = lowerBand > prevLowerBand || dataList[i - 1].close < prevLowerBand
            ? lowerBand
            : prevLowerBand;
        }
  
        if (!isNaN(prevUpperBand)) {
          upperBand = upperBand < prevUpperBand || dataList[i - 1].close > prevUpperBand
            ? upperBand
            : prevUpperBand;
        }
  
        if (isNaN(prevSuperTrend)) {
          _direction = 1;
        } else if (prevSuperTrend === prevUpperBand) {
          _direction = bar.close > upperBand ? -1 : 1;
        } else {
          _direction = bar.close < lowerBand ? 1 : -1;
        }
  
        const superTrend = _direction === -1 ? lowerBand : upperBand;
        superTrendArr.push({ time: bar.time, value: superTrend });
        directionArr.push({ time: bar.time, value: _direction });
  
        prevSuperTrend = superTrend;
        prevUpperBand = upperBand;
        prevLowerBand = lowerBand;
      });
  
      return [
        { key: 'superTrend', title: 'Super Trend', type: 'line', data: superTrendArr },
        { key: 'direction', title: 'Direction', type: 'line', data: directionArr },
      ];
    },
  };
  
  // Helper function to calculate ATR
  function getATR(dataList: (BarData | CandlestickData)[], index: number, period: number): number {
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

  const averageTrueRange: IndicatorDefinition = {
    name: 'Average True Range',
    shortName: 'ATR',
    shouldOhlc: true,
    paramMap: {
      period: { defaultValue: 14, type: 'number', min: 1, max: 100 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const period = p.period;
  
      const atrArr: SingleValueData[] = [];
      let sumTR = 0;
      const trValues: number[] = [];
  
      dataList.forEach((bar, i) => {
        if (i === 0) {
          atrArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        const prevClose = dataList[i - 1].close;
        const tr = Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - prevClose),
          Math.abs(bar.low - prevClose)
        );
  
        trValues.push(tr);
        sumTR += tr;
  
        if (trValues.length > period) {
          sumTR -= trValues.shift()!;
        }
  
        const atrVal = trValues.length >= period ? sumTR / period : NaN;
        atrArr.push({ time: bar.time, value: atrVal });
      });
  
      return [{ key: 'atr', title: 'ATR', type: 'line', data: atrArr }];
    },
  };
  
  const highestHigh: IndicatorDefinition = {
    name: 'Highest High',
    shortName: 'HH',
    shouldOhlc: true,
    paramMap: {
      period: { defaultValue: 14, type: 'number', min: 1, max: 100 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const period = p.period;
  
      const hhArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        if (i < period - 1) {
          hhArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        let highest = -Infinity;
        for (let j = i - (period - 1); j <= i; j++) {
          highest = Math.max(highest, dataList[j].high);
        }
  
        hhArr.push({ time: bar.time, value: highest });
      });
  
      return [{ key: 'hh', title: 'Highest High', type: 'line', data: hhArr }];
    },
  };
  const lowestLow: IndicatorDefinition = {
    name: 'Lowest Low',
    shortName: 'LL',
    shouldOhlc: true,
    paramMap: {
      period: { defaultValue: 14, type: 'number', min: 1, max: 100 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const period = p.period;
  
      const llArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        if (i < period - 1) {
          llArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        let lowest = Infinity;
        for (let j = i - (period - 1); j <= i; j++) {
          lowest = Math.min(lowest, dataList[j].low);
        }
  
        llArr.push({ time: bar.time, value: lowest });
      });
  
      return [{ key: 'll', title: 'Lowest Low', type: 'line', data: llArr }];
    },
  };
  const median: IndicatorDefinition = {
    name: 'Median',
    shortName: 'Median',
    shouldOhlc: true,
    paramMap: {
      period: { defaultValue: 14, type: 'number', min: 1, max: 100 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const period = p.period;
  
      const medianArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        if (i < period - 1) {
          medianArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        const subset = dataList.slice(i - (period - 1), i + 1).map(b => b.close);
        subset.sort((a, b) => a - b);
        const mid = Math.floor(subset.length / 2);
        const medianVal = subset.length % 2 === 0
          ? (subset[mid - 1] + subset[mid]) / 2
          : subset[mid];
  
        medianArr.push({ time: bar.time, value: medianVal });
      });
  
      return [{ key: 'median', title: 'Median', type: 'line', data: medianArr }];
    },
  };
  const standardDeviation: IndicatorDefinition = {
    name: 'Standard Deviation',
    shortName: 'StdDev',
    shouldOhlc: true,
    paramMap: {
      period: { defaultValue: 14, type: 'number', min: 1, max: 100 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const period = p.period;
  
      const stdDevArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        if (i < period - 1) {
          stdDevArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        const subset = dataList.slice(i - (period - 1), i + 1).map(b => b.close);
        const mean = subset.reduce((sum, val) => sum + val, 0) / subset.length;
        const variance = subset.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / subset.length;
        const stdDev = Math.sqrt(variance);
  
        stdDevArr.push({ time: bar.time, value: stdDev });
      });
  
      return [{ key: 'stdDev', title: 'Standard Deviation', type: 'line', data: stdDevArr }];
    },
  };
  const variance: IndicatorDefinition = {
    name: 'Variance',
    shortName: 'Variance',
    shouldOhlc: true,
    paramMap: {
      period: { defaultValue: 14, type: 'number', min: 1, max: 100 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const period = p.period;
  
      const varianceArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        if (i < period - 1) {
          varianceArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        const subset = dataList.slice(i - (period - 1), i + 1).map(b => b.close);
        const mean = subset.reduce((sum, val) => sum + val, 0) / subset.length;
        const variance = subset.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / subset.length;
  
        varianceArr.push({ time: bar.time, value: variance });
      });
  
      return [{ key: 'variance', title: 'Variance', type: 'line', data: varianceArr }];
    },
  };
  const change: IndicatorDefinition = {
    name: 'Change',
    shortName: 'Change',
    shouldOhlc: true,
    paramMap: {
      period: { defaultValue: 1, type: 'number', min: 1, max: 100 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const period = p.period;
  
      const changeArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        if (i < period) {
          changeArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        const prevClose = dataList[i - period].close;
        const changeVal = bar.close - prevClose;
  
        changeArr.push({ time: bar.time, value: changeVal });
      });
  
      return [{ key: 'change', title: 'Change', type: 'line', data: changeArr }];
    },
  };
  const range: IndicatorDefinition = {
    name: 'Range',
    shortName: 'Range',
    shouldOhlc: true,
    paramMap: {
      period: { defaultValue: 14, type: 'number', min: 1, max: 100 },
    },
    calc(dataList, overrideParams) {
      const p = getParams(this, overrideParams);
      const period = p.period;
  
      const rangeArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        if (i < period - 1) {
          rangeArr.push({ time: bar.time, value: NaN });
          return;
        }
  
        const subset = dataList.slice(i - (period - 1), i + 1);
        const highest = Math.max(...subset.map(b => b.high));
        const lowest = Math.min(...subset.map(b => b.low));
  
        rangeArr.push({ time: bar.time, value: highest - lowest });
      });
  
      return [{ key: 'range', title: 'Range', type: 'line', data: rangeArr }];
    },
  };
  
  const volumeWeightedAveragePrice: IndicatorDefinition = {
    name: 'Volume Weighted Average Price',
    shortName: 'VWAP',
    shouldOhlc: true,
    paramMap: {
      anchorInterval: { 
        defaultValue: 1, 
        type: 'number', 
        min: 1, 
        max: 1440, 
        step: 1 
      }, // Defines reset frequency
    },
    calc(dataList,  overrideParams, volumeData) {
      if (!volumeData) {      return [{ key: 'vwap', title: 'VWAP', type: 'line', data:[]}];
    }
      const p = getParams(this, overrideParams);
      const anchorInterval = p.anchorInterval;
  
      let cumulativeVolume = 0;
      let cumulativeVWAP = 0;
  
      // ✅ Convert volumeData into a Map for fast time-based lookups
      const volumeMap = new Map([...volumeData].map(v => [v.time, v.value]));
  
      const vwapArr: SingleValueData[] = [];
  
      dataList.forEach((bar, i) => {
        const volume = volumeData[i].value ?? 0;
        const typicalPrice = (bar.high + bar.low + bar.close) / 3;
        const vwapValue = typicalPrice * volume;
  
        cumulativeVWAP += vwapValue;
        cumulativeVolume += volume;
  
        const vwap = cumulativeVolume !== 0 ? cumulativeVWAP / cumulativeVolume : NaN;
        vwapArr.push({ time: bar.time, value: vwap });
      });
  
      return [{ key: 'vwap', title: 'VWAP', type: 'line', data: vwapArr }];
    },
  };
  
  const volumeWeightedMovingAverage: IndicatorDefinition = {
    name: 'Volume Weighted Moving Average',
    shortName: 'VWMA',
    shouldOhlc: true,
    paramMap: {
      period: { defaultValue: 20, type: 'number', min: 1, max: 200 },
    },
    calc( dataList, overrideParams?, volumeData?) {
      if (!volumeData) {return [{ key: 'vwma', title: 'VWMA', type: 'line', data: [] }] }
      const p = getParams(this, overrideParams);

      const period = p.period;
  
      const vwmaArr: SingleValueData[] = [];
      let sumVolumePrice = 0;
      let sumVolume = 0;
  
    
      dataList.forEach((bar, i) => {
        const volume = volumeData[i].value ?? 0;
        const volumePrice = bar.close * volume;
        sumVolumePrice += volumePrice;
        sumVolume += volume;
  
        if (i >= period - 1) {
          const vwma = sumVolume !== 0 ? sumVolumePrice / sumVolume : NaN;
          vwmaArr.push({ time: bar.time, value: vwma });
  
          const oldVolume = volumeData[i - (period - 1)].value ?? 0;
          const oldVolumePrice = dataList[i - (period - 1)].close * oldVolume;
          sumVolumePrice -= oldVolumePrice;
          sumVolume -= oldVolume;
        } else {
          vwmaArr.push({ time: bar.time, value: NaN });
        }
      });
  
      return [{ key: 'vwma', title: 'VWMA', type: 'line', data: vwmaArr }];
    },
  };
  
// Then add them to your ALL_INDICATORS array as well, if desired.

// =====================================================================
//  ALL_INDICATORS (collect them in one array)
// =====================================================================
export const ALL_INDICATORS: IndicatorDefinition[] = [
    // Overlay Indicators
    arnaudLegouxMovingAverage,
    bollingerBands,
    exponentialMovingAverage,
    highestHigh,
    lowestLow,
    median,
    movingAverage,
    rollingMovingAverage,
    simpleMovingAverage,
    stopAndReverse,
    superTrend,
    symmetricWeightedMovingAverage,
    tripleExponentiallySmoothedAverage,
    volumeWeightedAveragePrice,
    volumeWeightedMovingAverage,
    weightedMovingAverage,

    // Oscillator Indicators
    awesomeOscillator,
    averageTrueRange,
    bias,
    brar,
    bullAndBearIndex,
    commodityChannelIndex,
    currentRatio,
    differentOfMovingAverage,
    directionalMovementIndex,
    momentum,
    movingAverageConvergenceDivergence,
    psychologicalLine,
    rateOfChange,
    relativeStrengthIndex,
    stoch,
    variance,
    williamsR,
    change,
    range,
    standardDeviation
];


