import { ISeriesApi, SeriesType, ISeriesPrimitive, AreaStyleOptions, BarStyleOptions, DeepPartial, HistogramStyleOptions, LineStyleOptions, SeriesOptionsCommon, LineStyle, IChartApi, Logical, MouseEventParams, Coordinate, SeriesDataItemTypeMap } from "lightweight-charts";
import { Legend } from "../general/legend";
import { ohlcSeriesOptions } from "../ohlc-series/ohlc-series";
import { convertDataItem, SupportedSeriesType } from "./series";
import { Point as LogicalPoint } from "../drawing/data-source";
import { Point as CanvasPoint } from "lightweight-charts";
import { ViewPoint } from "../drawing/pane-view";
export interface ISeriesApiExtended extends ISeriesApi<SeriesType> {
  primitives: {
      [key: string]: any; // Dictionary for attached primitives
      [index: number]: any; // Indexed access for primitives
      length: number; // Array-like length
    };
    primitive: any; // Reference to the most recently attached primitive
    addPeer(peer: ISeriesApi<any>): void; // Add a peer series
    removePeer(peer: ISeriesApi<any>): void; // Remove a peer series
    peers: ISeriesApi<any>[]; // List of peer series
    sync(series: ISeriesApi<any>): void;
    attachPrimitive(primitive:ISeriesPrimitive, name?: string, replace?:boolean, addToLegend?:boolean): void; // Method to attach a primitive
    detachPrimitive(primitive:ISeriesPrimitive): void; // Detach a primitive by type
    detachPrimitives():void;
  decorated: boolean; // Flag indicating if the series has been decorated
  }
  export function decorateSeries<T extends ISeriesApi<SeriesType>>(
    original: T,
    legend?: Legend // Optional Legend instance to handle primitives
  ): T & ISeriesApiExtended {
  // Check if the series is already decorated
  if ((original as any)._isDecorated) {
    console.warn("Series is already decorated. Skipping decoration.");
      return original as T & ISeriesApiExtended;
  }

  // Mark the series as decorated
  (original as any)._isDecorated = true;
    const decorated: boolean = true;
    const peers: ISeriesApi<any>[] = [];
    const originalSetData = (original as ISeriesApi<any>).setData.bind(original);

    // Array to store attached primitives
    const primitives: ISeriesPrimitive[] = [];
  
    // Reference to the most recently attached primitive
  let lastAttachedPrimitive: ISeriesPrimitive | null = null;

    // Hook into the original `detachPrimitive` if it exists
  const originalDetachPrimitive = (original as any).detachPrimitive?.bind(original);
  const originalAttachPrimitive = (original as any).attachPrimitive?.bind(original);
  const originalData = (original as any).data?.bind(original);

  /**
   * Helper function to convert data items.
   * 
   * @param sourceItem - The raw source item (must contain a `time` property).
   * @param keys - Optional list of property names to copy. Defaults to ['time'].
   * @param copy - If true, copies all properties from sourceItem, overriding `keys`.
   * @returns A partial data item or null if `time` is missing.
   */

  function sync(series: ISeriesApi<SeriesType>): void {
    // 1) Determine the type from the series’ own options
    //    (Ensure "seriesType" is indeed on the options, otherwise provide fallback)
    const options = series.options() as { seriesType?: SupportedSeriesType };
    const targetType = options.seriesType ?? "Line"; // fallback to "Line" if undefined
  
    // 2) Perform initial synchronization from "originalData"
    const sourceData = originalData();
    if (!sourceData) {
      console.warn("Source data is missing for synchronization.");
      return;
    }
  
    const targetData = [...series.data()];
    for (let i = targetData.length; i < sourceData.length; i++) {
      // Now call your convertDataItem with the discovered type:
      const newItem = convertDataItem(series, targetType, i);
      if (newItem) {
        if (newItem && 'time' in newItem && 'value' in newItem) {
            targetData.push(newItem);
        } else {
            console.warn('Invalid data item:', newItem);
        }
      }
    }
    series.setData(targetData);
    console.log(`Synchronized series of type ${series.seriesType}`);
  
    // 3) Subscribe for future changes
    series.subscribeDataChanged(() => {
      const updatedSourceData = [...originalData()];
      if (!updatedSourceData || updatedSourceData.length === 0) {
        console.warn("Source data is missing for synchronization.");
        return;
      }
  
      // Get the last bar from the target series
      const lastTargetBar = series.data().slice(-1)[0];
      // The last index from updatedSourceData
      const lastSourceIndex = updatedSourceData.length - 1;
  
      // If the new item has a time >= last target bar’s time, we update/append
      if (
        !lastTargetBar ||
        updatedSourceData[lastSourceIndex].time >= lastTargetBar.time
      ) {
        const newItem = convertDataItem(series, targetType, lastSourceIndex);
        if (newItem) {
          series.update(newItem);
          console.log(`Updated/added bar via "update()" for series type ${series.seriesType}`);
        }
      }
    });
  }
  

  function attachPrimitive(
    primitive: ISeriesPrimitive,
    name?: string,
    replace: boolean = true,
    addToLegend: boolean = false
  ): void {
    const primitiveType = (primitive.constructor as any).type || primitive.constructor.name;

      // Detach existing primitives if `replace` is true
      if (replace) {
        detachPrimitives();
      } else {
        // Check if a primitive of the same type is already attached
        const existingIndex = primitives.findIndex(
          (p) => (p.constructor as any).type === primitiveType
        );
        if (existingIndex !== -1) {
          detachPrimitive(primitives[existingIndex]);
        }
      }
  
      // Attach the primitive to the series
    if (originalAttachPrimitive) {
      originalAttachPrimitive(primitive);
    }

      // Add the new primitive to the list
      primitives.push(primitive);
    lastAttachedPrimitive = primitive;

    console.log(`Primitive of type "${primitiveType}" attached.`);

    // Add the primitive to the legend if required
    if (legend && addToLegend) {
      legend.addLegendPrimitive(original as ISeriesApi<any>, primitive, name);
    }
  }
  
  function detachPrimitive(primitive: ISeriesPrimitive): void {
      const index = primitives.indexOf(primitive);
      if (index === -1) {
        return;
      }
  
      // Remove the primitive from the array
      primitives.splice(index, 1);
  
    if (lastAttachedPrimitive === primitive) {
      lastAttachedPrimitive = null;
    }
  
      // Detach the primitive using the original method
      if (originalDetachPrimitive) {
        originalDetachPrimitive(primitive);
      }

    // Remove the primitive from the legend if it exists
    if (legend) {
        const legendEntry = legend.findLegendPrimitive(original as ISeriesApi<any>, primitive);
        if (legendEntry) {
      legend.removeLegendPrimitive(primitive);
          console.log(`Removed primitive of type "${primitive.constructor.name}" from legend.`);
        }
      }
    }

  function detachPrimitives(): void {
    console.log("Detaching all primitives.");
      while (primitives.length > 0) {
        const primitive = primitives.pop()!;
        detachPrimitive(primitive);
      }
    console.log("All primitives detached.");
  }

    function setData(data: any[]) {
      originalSetData(data);
      peers.forEach((peer) => peer.setData?.(data));
      console.log("Data updated on series and peers.");
          }
  
    function addPeer(peer: ISeriesApi<any>) {
      peers.push(peer);
    }
  
    function removePeer(peer: ISeriesApi<any>) {
      const index = peers.indexOf(peer);
      if (index !== -1) peers.splice(index, 1);
    }
  
    return Object.assign(original, {
    setData,
      addPeer,
      removePeer,
      peers,
      primitives,
      sync,
      attachPrimitive,
      detachPrimitive,
      detachPrimitives,
      decorated,
    get primitive() {
      return lastAttachedPrimitive;
    },
    });
  }
  
export interface SeriesOptionsExtended {
    primitives?: {
      [key: string]: any; // Dictionary for attached primitives
    };
    seriesType?: string;
    group?: string; // Group name for the series
    legendSymbol?: string | string[]; // Legend symbol(s) for the series
    isIndicator?: boolean; // Indicator flag
  }
  // Define specific options interfaces with optional `group`, `legendSymbol`, and `primitives` properties
  export interface LineSeriesOptions
    extends DeepPartial<LineStyleOptions & SeriesOptionsCommon>,
      SeriesOptionsExtended {}
  
  export interface HistogramSeriesOptions
    extends DeepPartial<HistogramStyleOptions & SeriesOptionsCommon>,
      SeriesOptionsExtended {}
  
  export interface AreaSeriesOptions
    extends DeepPartial<AreaStyleOptions & SeriesOptionsCommon>,
      SeriesOptionsExtended {}
  
  export interface BarSeriesOptions
    extends DeepPartial<BarStyleOptions & SeriesOptionsCommon>,
      SeriesOptionsExtended {}
  
  export interface OhlcSeriesOptions
    extends ohlcSeriesOptions,
        DeepPartial<SeriesOptionsExtended> {}
    

/**
 * Converts a string or numeric style to the numeric LineStyle enum from Lightweight Charts.
 */
export function parseLineStyle(style: string | number): LineStyle {
  // If it's already numeric and valid, just return it.
  if (typeof style === 'number' && style in LineStyle) {
    return style as LineStyle;
  }

  // Otherwise, map strings to numeric values
  switch (style) {
    case 'Solid':         return LineStyle.Solid;
    case 'Dotted':        return LineStyle.Dotted;
    case 'Dashed':        return LineStyle.Dashed;
    case 'Large Dashed':  return LineStyle.LargeDashed;
    case 'Sparse Dotted': return LineStyle.SparseDotted;
    default:
      console.warn(`Unknown line style "${style}", defaulting to Solid.`);
      return LineStyle.Solid;
  }
}



export function _measureLogicalRange(chart: IChartApi): { from: Logical; to: Logical } | null {
  if (!chart) return null;
  const timeScale = chart.timeScale();
  const visibleLogicalRange = timeScale.getVisibleLogicalRange();
  if (!visibleLogicalRange) return null;
  return {
      from: visibleLogicalRange.from,
      to: visibleLogicalRange.to,
  };
}
export function _measurePriceRange(chart: IChartApi, series?: ISeriesApiExtended): { max: number; min: number } | null {
  if (!chart ) return null;
  if (!series){
    const series= chart.addLineSeries()
  }
  const paneSize = chart.paneSize();
  const max = series!.coordinateToPrice(0);
  const min = series!.coordinateToPrice(paneSize.height);
  if (max === null || min === null) return null;
  return {
      max,
      min,
  };
}
/**
 * Converts the mouse event parameters into a LogicalPoint.
 */
export function eventToLogicalPoint(
  param: MouseEventParams,
  chart: IChartApi,
  series?: ISeriesApi<any>
): LogicalPoint | null {
  if (!chart || !param.point || !param.logical) return null;
  if (!series){
    const series= chart.addLineSeries()
  }
  const price = series!.coordinateToPrice(param.point.y);
  if (price === null) return null;
  return {
    time:chart.timeScale().coordinateToTime(param.point?.x),
    logical: param.logical,
    price,
  };
}

/**
 * Given a target LogicalPoint, a tolerance factor (for example, 0.05 means 5%),
 * the chart, the series, and the current MouseEventParams, this function checks
 * whether the current mouse event is “close” to the target. The idea is to compute
 * the visible logical and price spans and then use the tolerance factor to derive a
 * threshold for each.
 *
 * @param target The LogicalPoint (for example, an endpoint) to test.
 * @param toleranceFactor A fraction (e.g. 0.05 for 5%) of the visible span.
 * @param chart The chart API.
 * @param series The series API used for the price conversion.
 * @param param The MouseEventParams from the chart.
 * @returns True if the mouse event’s logical and price are within the tolerance thresholds.
 */
/**
 * Measures the visible pane size from the chart.
 */
export function _measurePaneSize(chart: IChartApi): { width: number; height: number } | null {
  if (!chart) return null;
  const paneSize = chart.paneSize();
  return {
      width: paneSize.width,
      height: paneSize.height,
  };
}

/**
* Converts MouseEventParams to canvas coordinates.
*/
export function eventToCanvasPoint(
  event: MouseEvent,
  chart: IChartApi
): CanvasPoint | null {
  if (!event) return null;
  return {
    x: event.x as Coordinate,
    y: event.y as Coordinate,
  };
}
// Helper: convert the input (which may be MouseEventParams or a native MouseEvent)
// to a CanvasPoint. If the input has a 'point' property already, we use that;
// otherwise, if it’s a MouseEvent, we convert it.
function getCanvasCoordinates(
  input: MouseEventParams | MouseEvent,
  chart: IChartApi
): CanvasPoint | null {
  // Check if input is a native MouseEvent by testing for the existence
  // of the "target" property from the DOM event
  if (input instanceof MouseEvent) {
    return eventToCanvasPoint(input, chart);
  }
  // Else, if it’s MouseEventParams and has a "point" property, assume that’s in canvas space.
  if ("point" in input && input.point) {
    return input.point;
  }
  return null;
}
/**
 * Determines if the target CanvasPoint is close to the mouse position within the tolerance factor.
 *
 * @param input - A MouseEvent or MouseEventParams object.
 * @param target - The CanvasPoint (or ViewPoint) to compare against.
 * @param toleranceFactor - Fraction of the visible spans (for example, 0.05 for 5%).
 * @param chart - The chart instance.
 * @returns True if within tolerance; otherwise, false.
 */
export function isPointCloseCanvas(
  input: MouseEvent | MouseEventParams,
  target: CanvasPoint,
  toleranceFactor: number,
  chart: IChartApi
): boolean {
  const paneSize = _measurePaneSize(chart);
  if (!paneSize) return false;

  // Compute visible spans from the pane
  const visibleWidth = paneSize.width;
  const visibleHeight = paneSize.height;

  // Set tolerance thresholds (in canvas coordinate units)
  const xTolerance = visibleWidth * toleranceFactor;
  const yTolerance = visibleHeight * toleranceFactor;

  // Get the canvas point from the input
  const mousePoint = getCanvasCoordinates(input, chart);
  if (!mousePoint || mousePoint.x == null || mousePoint.y == null ||
      target.x == null || target.y == null) {
    return false;
  }

  // Compute the differences in canvas space
  const dx = Math.abs(target.x - mousePoint.x);
  const dy = Math.abs(target.y - mousePoint.y);

  return dx <= xTolerance && dy <= yTolerance;
}


/**
 * Determines if the target LogicalPoint is close to the mouse position within the tolerance factor.
 *
 * @param param - MouseEventParams from the chart.
 * @param target - The LogicalPoint to compare against.
 * @param toleranceFactor - Fraction of the visible spans (e.g., 0.05 for 5%).
 * @param chart - The chart instance.
 * @param series - The series instance used for price conversions.1111
 * @returns True if within tolerance; otherwise, false.
 */
export function isPointCloseLogical(
  param: MouseEventParams,
  target: LogicalPoint,
  toleranceFactor: number,
  chart: IChartApi,
  series?: ISeriesApiExtended
): boolean {
  const visibleLogical = _measureLogicalRange(chart);
  const visiblePrice = _measurePriceRange(chart, series);
  if (!visibleLogical || !visiblePrice) {
      return false;
  }

  // Compute visible spans
  const visibleLogicalSpan = Math.abs(visibleLogical.to - visibleLogical.from);
  const visiblePriceSpan = Math.abs(visiblePrice.max - visiblePrice.min);

  // Set tolerance thresholds
  const logicalTolerance = visibleLogicalSpan * toleranceFactor;
  const priceTolerance = visiblePriceSpan * toleranceFactor;

  // Convert mouse event to logical point
  const mousePoint = eventToLogicalPoint(param, chart, series);
  if (!mousePoint) return false;

  // Compute absolute differences
  const logicalDiff = Math.abs(target.logical - mousePoint.logical);
  const priceDiff = Math.abs(target.price - mousePoint.price);

  return logicalDiff <= logicalTolerance && priceDiff <= priceTolerance;
}
// A helper that "normalizes" either a MouseEventParams or a LogicalPoint 
// into a LogicalPoint.
export function toLogicalPoint(
  input: MouseEventParams | LogicalPoint,
  series: ISeriesApi<any>
): LogicalPoint | null {
  // If input is MouseEventParams (we check for the presence of a "point" property)
  if ('point' in input) {
    const params = input as MouseEventParams;
    if (!params.point || !params.logical) return null;
    const price = series.coordinateToPrice(params.point.y);
    if (price === null) return null;
    return {
      time: params.time || null,
      logical: params.logical,
      price: price.valueOf(),
    };
  }
  // Otherwise assume it is already a LogicalPoint
  return input as LogicalPoint;
}