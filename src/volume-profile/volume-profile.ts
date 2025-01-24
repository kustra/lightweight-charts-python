// volumeProfile.ts

import {
  CanvasRenderingTarget2D,
  BitmapCoordinatesRenderingScope,
} from "fancy-canvas";

import {
  AutoscaleInfo,
  Coordinate,
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  Logical,
  SeriesType,
  Time,
  HistogramData,
  LineStyle,
  LogicalRange,
  SeriesPrimitivePaneViewZOrder,
} from "lightweight-charts";

import { Point as LogicalPoint } from "../drawing/data-source";
import { DataPoint } from "../trend-trace/sequence";
import { TwoPointDrawingPaneRenderer } from "../drawing/pane-renderer";
import { convertPoint } from "../helpers/formatting";
import { ViewPoint } from "../drawing/pane-view";
import { PluginBase } from "../plugin-base"; // If your plugin base class is optional, adapt as needed
import { DrawingOptions } from "../drawing/options";
import { InteractionState } from "../drawing/drawing";
import { Handler } from "../general";
import { setLineStyle } from "../helpers/canvas-rendering";
import { setOpacity } from "../helpers/colors";

/**
 * A typical "MouseEventParams" as might be used in lightweight-charts
 * or your custom logic. Adjust as needed.
 */
interface MouseEventParams {
  point?: { x: number; y: number };
  logical?: number;
  time?: Time;
}

/** VolumeProfile configuration. Adjust fields as needed. */
export interface VolumeProfileOptions extends DrawingOptions {
  visible: boolean;
  sections?: number;
  upColor?: string;
  downColor?: string;
  borderUpColor?: string;
  borderDownColor?: string;
  rightSide?: boolean;
  width: number;
  lineColor: string;
  lineStyle: LineStyle;
  drawGrid?: boolean; // Determines whether to draw the grid
  gridWidth?: number; // Specifies the width of the grid area in data units
  gridColor?: string; // Specifies the color of the grid lines
  gridLineStyle?: LineStyle; // Defines the style of the grid lines (e.g., solid, dashed)
} /** VolumeProfile configuration. Adjust fields as needed. */
export const defaultVolumeProfileOptions = {
  visible: true,
  sections: 0,
  upColor: undefined,//"rgba(255, 255, 255, 0.25)",
  downColor: undefined,//"rgba(50, 50, 50, 0.25)",
  borderUpColor: undefined,//"rgba(255, 255, 255, 0.33)",
  borderDownColor: undefined,//"rgba(50, 50, 50, 0.33)",
  rightSide: true,
  width: 0,
  lineColor: "#ffffff",
  lineStyle: LineStyle.Solid,
  drawGrid: true,
  gridWidth: 1,
  gridColor: "rgba(255, 255, 255, 0.125)",
  gridLineStyle: LineStyle.SparseDotted,

  // Possibly xScaleLock, yScaleLock, etc.
};
/** A single bin in the volume profile */
export interface VolumeProfileDataPoint {
  price: number;
  upData: number;
  downData: number;
  color: string;
  borderColor: string;
  minPrice: number;
  maxPrice: number;
}

/** The computed bins, plus a reference time & 'width'. */
export interface VolumeProfileData {
  time: Time;
  profile: VolumeProfileDataPoint[];
  width: number; // "width" in chart coordinate space
  visibleRange: LogicalRange;
}
interface Listener {
  name: string;
  listener: (...args: any[]) => void;
}

/**
 * The data for each bar in the final rendering step
 */
export interface VolumeProfileItem {
  y1: Coordinate | null;
  y2: Coordinate | null;
  combinedWidth: number;
  upWidth: number;
  downWidth: number;
  color: string;
  borderColor: string;
}

/**
 * The data needed by the VolumeProfileRenderer
 */
export interface VolumeProfileRendererData {
  x: Coordinate | null;
  width: number;
  items: VolumeProfileItem[];
  maxVolume: number;
  maxBars: number;
  visibleRange: LogicalRange;
}

/**
 * The VolumeProfile class implementing ISeriesPrimitive
 * with full dragging/hover logic for p1/p2, akin to TrendTrace.
 */
export class VolumeProfile
  extends PluginBase
  implements ISeriesPrimitive<Time>
{
  public p1?: LogicalPoint;
  public p2?: LogicalPoint;
  protected _listeners: Listener[] = [];
  public visibleRange: LogicalRange | null = null;

  // Provided by constructor

  // The merged data (OHLC + volume)
  public _originalData: (DataPoint & { volume: number })[];

  // The data slice for p1..p2
  public _currentSlice: (DataPoint & { volume: number })[] | null = null;

  // Aggregated bins => stored here
  public _vpData: VolumeProfileData;

  // The single or multiple pane views we use
  private _paneViews: VolumeProfilePaneView[];

  // Options from the user + defaults
  public _options: VolumeProfileOptions;

  // Throttle re-renders
  private _pendingUpdate: boolean = false;

  // For drag/hover logic
  private _state: InteractionState = InteractionState.NONE;
  protected _latestHoverPoint: LogicalPoint | null = null;
  protected _startDragPoint: LogicalPoint | null = null;
  public static _mouseIsDown: boolean = false;
  protected _hovered: boolean = false; // if you want a hovered style
  public chart_: IChartApi;
  public series_: ISeriesApi<SeriesType>;
  constructor(
    handler: Handler,
    options: VolumeProfileOptions = defaultVolumeProfileOptions,

    p1?: LogicalPoint,
    p2?: LogicalPoint
  ) {
    super(); // call base plugin constructor if needed

    this.chart_ = handler.chart;
    this.series_ = handler.series;
    const priceData = (this.series_ as ISeriesApi<"Candlestick">).data();
    const volumeData = (handler.volumeSeries as ISeriesApi<"Histogram">).data();
    const timeScale = this.chart_.timeScale();
    this.visibleRange = timeScale.getVisibleLogicalRange();

    if (p1 && p2) {
      // Use provided p1 and p2
      this.p1 = p1;
      this.p2 = p2;
    } else {
      // Use visible range or default values
      this.p1 = {
        time: null,
        logical: this.visibleRange?.from ?? (0 as Logical),
        price: 0,
      };
      this.p2 = {
        time: null,
        logical:
          this.visibleRange?.to ?? ((this.series.data().length - 1) as Logical),
        price: 0,
      };
    }

    // Merge user-specified options with defaults
    this._options = {
      ...defaultVolumeProfileOptions,
      ...options,
    };
    if (volumeData.length > 0 && volumeData.every((v) => "value" in v)) {
      // Merge priceData & volumeData
      this._originalData = priceData.map((dp, idx) => ({
        ...dp,
        x1: idx,
        x2: idx,
        volume: volumeData[idx]?.value || 0,
      }));
    } else {
      console.warn(
        '[ProfileProcessor] volumeData is empty or missing "value" property.'
      );
      // Handle the case where volumeData is invalid
      this._originalData = priceData.map((dp, idx) => ({
        ...dp,
        x1: idx,
        x2: idx,
        volume: 0, // Default volume
      }));
    }
    // Slice & compute initial bins
    this.sliceData();
    this._vpData = this.calculateVolumeProfile();

    // Create the single pane view
    this._paneViews = [new VolumeProfilePaneView(this)];

    this._subscribeEvents();

    // Trigger initial update
    this.update();
  }
  // The DOM event callbacks
  private _handleDomMouseDown = (ev: MouseEvent) => {
    // If you want to track raw DOM mousedown
    // (optionally do nothing, or set internal state).
  };
  private _handleDomMouseUp = (ev: MouseEvent) => {
    // If user physically let go anywhere, we finalize the drag
    // ...
    this._onMouseUp();
  };

  // 8) The subscribe/unsubscribe utilities
  protected _subscribe(
    name: keyof DocumentEventMap,
    listener: (ev: any) => void
  ) {
    document.addEventListener(name, listener);
    this._listeners.push({ name, listener });
  }

  protected _unsubscribe(
    name: keyof DocumentEventMap,
    listener: (ev: any) => void
  ) {
    document.removeEventListener(name, listener);
    const idx = this._listeners.findIndex(
      (x) => x.name === name && x.listener === listener
    );
    if (idx !== -1) this._listeners.splice(idx, 1);
  }

  /**
   * Subscribe to relevant events, e.g., crosshair move, chart click.
   */
  private _subscribeEvents(): void {
    if (this.p1 && this.p2 && this.p1.time && this.p2.time) {
      this.chart_.subscribeCrosshairMove(this._handleMouseMove);
      this.chart_.subscribeClick(this._handleMouseDownOrUp);
      // Store subscriptions for later unsubscription
      this._listeners.push(
        { name: "crosshairMove", listener: this._handleMouseMove },
        { name: "click", listener: this._handleMouseDownOrUp }
      );
    } else {
      // Subscribe to visible logical range changes with a handler
      this.chart_
        .timeScale()
        .subscribeVisibleLogicalRangeChange(
          this._handleVisibleLogicalRangeChange
        );
      // Store the subscription for later unsubscription
      this._listeners.push({
        name: "visibleLogicalRangeChange",
        listener: this._handleVisibleLogicalRangeChange,
      });
    }
  }

  /**
   * Handle changes to the visible logical range.
   * Reprocesses the volume profile data and updates the view.
   */
  private _handleVisibleLogicalRangeChange = (): void => {
    const timeScale = this.chart_.timeScale();
    this.visibleRange = timeScale.getVisibleLogicalRange();

    if (!this.visibleRange || !this.series_) {
      console.warn(
        "[VolumeProfile] Visible range or source series is undefined."
      );
      return;
    }

    // Update p1 and p2 based on the new visible range
    this.p1 = {
      time: null,
      logical: this.visibleRange.from ?? (0 as Logical),
      price: 0,
    };
    this.p2 = {
      time: null,
      logical:
        this.visibleRange.to ?? ((this.series_.data().length - 1) as Logical),
      price: 0,
    };
    this.sliceData();

    // Reprocess the volume profile data based on the new visible range
    const vpData = this.calculateVolumeProfile();

    if (vpData) {
      this._vpData = vpData;
      this.updateAllViews();
      this.requestUpdate(); // Trigger re-rendering
    } else {
      console.warn(
        "[VolumeProfile] Failed to process Volume Profile data on visible range change."
      );
    }
  };

  private _handleMouseMove = (param: MouseEventParams) => {
    const mousePoint = this._eventToPoint(param);
    this._latestHoverPoint = mousePoint;

    if (VolumeProfile._mouseIsDown) {
      this._handleDragInteraction(param);
    } else {
      // If near p1/p2 => HOVERING, else NONE
      if (
        this._mouseIsOverPointCanvas(param, 1) ||
        this._mouseIsOverPointCanvas(param, 2)
      ) {
        if (this._state === InteractionState.NONE) {
          this._moveToState(InteractionState.HOVERING);
        }
      } else {
        if (this._state !== InteractionState.NONE) {
          this._moveToState(InteractionState.NONE);
        }
      }
    }
  };

  /**
   * Click => toggle mouseDown
   */
  private _handleMouseDownOrUp = () => {
    VolumeProfile._mouseIsDown = !VolumeProfile._mouseIsDown;
    if (VolumeProfile._mouseIsDown) {
      this._onMouseDown();
    } else {
      this._onMouseUp();
    }
  };

  private _onMouseDown(): void {
    this._startDragPoint = this._latestHoverPoint;
    if (!this._startDragPoint || !this.p1 || !this.p2) return;

    // Are we near p1 or p2 in 'raw' logic?
    const nearP1 = this._mouseIsOverPointRaw(this._startDragPoint, this.p1);
    const nearP2 = this._mouseIsOverPointRaw(this._startDragPoint, this.p2);
    if (nearP1) {
      this._moveToState(InteractionState.DRAGGINGP1);
    } else if (nearP2) {
      this._moveToState(InteractionState.DRAGGINGP2);
    } else {
      this._moveToState(InteractionState.DRAGGING);
    }
  }

  private _onMouseUp(): void {
    VolumeProfile._mouseIsDown = false;
    this._startDragPoint = null;
    this._moveToState(InteractionState.HOVERING);
    // Re-slice the data based on the updated p1 and p2 points.
    this.sliceData();
    // Recompute the volume profile bins with the updated options.
    this._vpData = this.calculateVolumeProfile();

    // Trigger an update to re-render the pane views.
    this.update();
  }

  private _handleDragInteraction(param: MouseEventParams): void {
    if (
      this._state !== InteractionState.DRAGGING &&
      this._state !== InteractionState.DRAGGINGP1 &&
      this._state !== InteractionState.DRAGGINGP2
    ) {
      return;
    }
    const newPoint = this._eventToPoint(param);
    if (!newPoint || !this._startDragPoint) return;

    const diff = {
      logical: newPoint.logical - this._startDragPoint.logical,
      price: newPoint.price - this._startDragPoint.price,
    };
    this._onDrag(diff);

    // Now re-slice the data & recalc bins
    this.sliceData();
    this._vpData = this.calculateVolumeProfile();

    // Force re-render
    this.update();

    // Update anchor
    this._startDragPoint = newPoint;
  }

  private _onDrag(diff: { logical: number; price: number }) {
    if (!this.p1 || !this.p2) return;

    // If the user is dragging entire shape, do both
    if (this._state === InteractionState.DRAGGING) {
      this._addDiffToPoint(this.p1, diff.logical, diff.price);
      this._addDiffToPoint(this.p2, diff.logical, diff.price);
    } else if (this._state === InteractionState.DRAGGINGP1) {
      this._addDiffToPoint(this.p1, diff.logical, diff.price);
    } else if (this._state === InteractionState.DRAGGINGP2) {
      this._addDiffToPoint(this.p2, diff.logical, diff.price);
    }
    // Re-slice the data based on the updated p1 and p2 points.
    this.sliceData();

    // Recompute the volume profile bins with the updated options.
    this._vpData = this.calculateVolumeProfile();

    // Trigger an update to re-render the pane views.
    this.update();
  }

  private _addDiffToPoint(point: LogicalPoint, ldiff: number, pdiff: number) {
    point.logical = (point.logical + ldiff) as Logical;
    point.price = point.price + pdiff;
    // If you want to recalc time, do so here
  }

  /**
   * Minimal "raw" logic check
   */
  private _mouseIsOverPointRaw(
    mousePt: LogicalPoint | null,
    pt: LogicalPoint
  ): boolean {
    if (!mousePt) return false;
    const tol = 1; // 1 bar index + 1 price unit tolerance, or whichever
    if (Math.abs(mousePt.logical - pt.logical) < tol) {
      if (Math.abs(mousePt.price - pt.price) < tol) return true;
    }
    return false;
  }

  /**
   * "Canvas" check if user is near p1/p2
   */
  private _mouseIsOverPointCanvas(
    param: MouseEventParams,
    which: 1 | 2
  ): boolean {
    if (!param.point || !this.p1 || !this.p2) return false;
    const tolerancePx = 10;
    const cpt: ViewPoint =
      which === 1
        ? (convertPoint(this.p1, this.chart_, this.series_) as ViewPoint)
        : (convertPoint(this.p2, this.chart_, this.series_) as ViewPoint);

    const dx = param.point.x - cpt.x!;
    const dy = param.point.y - cpt.y!;
    return dx * dx + dy * dy < tolerancePx * tolerancePx;
  }

  private _moveToState(state: InteractionState): void {
    switch (state) {
      case InteractionState.NONE:
        document.body.style.cursor = "default";
        this._hovered = false;
        // Unsubscribe from DOM events
        this._unsubscribe("mousedown", this._handleDomMouseDown);
        this._unsubscribe("mouseup", this._handleDomMouseUp);
        break;

      case InteractionState.HOVERING:
        document.body.style.cursor = "pointer";
        this._hovered = true;
        // Sub to mousedown, unsub from mouseup
        this._subscribe("mousedown", this._handleDomMouseDown);
        this._unsubscribe("mouseup", this._handleDomMouseUp);
        break;

      case InteractionState.DRAGGING:
      case InteractionState.DRAGGINGP1:
      case InteractionState.DRAGGINGP2:
        document.body.style.cursor = "grabbing";
        this._hovered = false;
        // unsub from mousedown, sub to mouseup
        this._unsubscribe("mousedown", this._handleDomMouseDown);
        this._subscribe("mouseup", this._handleDomMouseUp);
        break;
    }

    this._state = state;
    // Re-slice the data based on the updated p1 and p2 points.
    this.sliceData();

    // Recompute the volume profile bins with the updated options.
    this._vpData = this.calculateVolumeProfile();

    // Trigger an update to re-render the pane views.
    this.update();
  }

  /**
   * Convert the mouse event => LogicalPoint
   */
  private _eventToPoint(param: MouseEventParams): LogicalPoint | null {
    if (!param.point || param.logical == null) return null;
    const barPrice = this.series_.coordinateToPrice(param.point.y);
    if (barPrice == null) return null;
    return {
      time: param.time ?? null,
      logical: param.logical as Logical,
      price: barPrice.valueOf(),
    };
  }

  /** Slices the original data in [p1..p2] range */
  public sliceData(): void {
    if (!this.p1 || !this.p2) return;

    const start = Math.min(this.p1.logical, this.p2.logical);
    const end = Math.max(this.p1.logical, this.p2.logical);
    this._currentSlice = this._originalData.slice(
      Math.max(0, start),
      Math.min(end + 1, this._originalData.length - 1)
    );
  }
  private calculateDynamicSections(
    visibleBars: number,
    priceMin: number,
    priceMax: number
  ): number {
    const K1 = 20; // Adjust for sensitivity to number of bars
    const K2 = 5; // Adjust for sensitivity to price range

    if (visibleBars <= 0 || priceMax <= priceMin) {
      return 10; // Default fallback value if inputs are invalid
    }

    // Dynamic calculation of section count
    const sectionsFromBars = visibleBars / K1;
    const sectionsFromPrice = (priceMax - priceMin) / K2;

    // Take the maximum of the two calculations
    const dynamicSections =
      2 *
      Math.max(1, Math.floor(Math.max(sectionsFromBars, sectionsFromPrice)));

    return Math.max(5, dynamicSections);
  }

  private calculateVolumeProfile(): VolumeProfileData {
    const visibleBars =
      Math.min(this.visibleRange!.to,this._originalData.length - 1) -
      Math.max(this.visibleRange!.from,0);
    let priceMin = Number.POSITIVE_INFINITY;
    let priceMax = Number.NEGATIVE_INFINITY;
    const profile: VolumeProfileDataPoint[] = [];
    let refTime: Time;

    if (this._currentSlice && this._currentSlice.length > 0) {
      for (const pt of this._currentSlice) {
        const repPrice = pt.close ?? pt.open;
        if (repPrice !== undefined) {
          priceMin = Math.min(priceMin, repPrice);
          priceMax = Math.max(priceMax, repPrice);
        }
      }

      // Handle cases where priceMin or priceMax were not updated
      if (
        priceMin === Number.POSITIVE_INFINITY ||
        priceMax === Number.NEGATIVE_INFINITY
      ) {
        priceMin = 0;
        priceMax = 1;
      }

      // Determine the number of sections dynamically if not explicitly set
      let binCount =
        this._options.sections !== undefined && this._options.sections > 0
          ? this._options.sections
          : this.calculateDynamicSections(visibleBars, priceMin, priceMax);

      // Calculate price range and bin size
      const priceRange = priceMax === priceMin ? 1 : priceMax - priceMin;
      const binSize = priceRange / binCount;
      for (let i = 0; i < binCount; i++) {
        const binMin = priceMin + i * binSize;
        const binMax = priceMin + (i + 1) * binSize;
        let upData = 0;
        let downData = 0;

        for (const pt of this._currentSlice) {
          const repPrice = pt.close ?? pt.open;
          if (
            repPrice !== undefined &&
            repPrice >= binMin &&
            repPrice < binMax
          ) {
            const isUp = (pt.close ?? 0) >= (pt.open ?? 0);
            const volume = pt.volume || 0;
            if (isUp) upData += volume;
            else downData += volume;
          }
        }

        // Decide color/border
        const isUp = upData >= downData;
        const color = isUp
          ? this._options.upColor ?? setOpacity((this.series_ as ISeriesApi<"Candlestick">).options().upColor ,.1)??"rgba(0,128,0,0.1)"
          : this._options.downColor ?? setOpacity((this.series_ as ISeriesApi<"Candlestick">).options().downColor ,.1)??"rgba(128,0,0,0.1)";
        const borderColor = isUp
          ? this._options.borderUpColor ?? setOpacity((this.series_ as ISeriesApi<"Candlestick">).options().upColor ,.5)??"rgba(0,128,0,0.66)"
          : this._options.borderDownColor ?? setOpacity((this.series_ as ISeriesApi<"Candlestick">).options().downColor ,.5)??"rgba(128,0,0,0.66)"

        profile.push({
          price: binMin,
          upData,
          downData,
          color: this._options.visible ? color : "rgba(0,0,0,0)",
          borderColor: this._options.visible ? borderColor : "rgba(0,0,0,0)",
          minPrice: binMin,
          maxPrice: binMax,
        });
      }
      refTime = this._options.rightSide
        ? this._currentSlice[this._currentSlice.length - 1].time!
        : this._currentSlice[0].time!;
    } else {
      // fallback
      refTime = Date.now().toString();
    }
    this.update();
    return {
      time: refTime,
      profile,
      width: this._options.width ?? 20,
      visibleRange: this.visibleRange!,
    };
  }

  /**
   * Schedules an update with requestAnimationFrame
   */
  public update(): void {
    if (!this._pendingUpdate) {
      this._pendingUpdate = true;
      requestAnimationFrame(() => {
        super.requestUpdate();
        this.updateAllViews();

        // or if you just have "this.updateAllViews();"
        console.log("VolumeProfile updated p1=", this.p1, "p2=", this.p2);
        this._pendingUpdate = false;
      });
    }
  }

  public updateAllViews(): void {
    // If you want a direct forced re-render
    this._paneViews.forEach((pv) => pv.update());
  }

  /**
   * ISeriesPrimitive: returns your pane views
   */
  public paneViews(): ISeriesPrimitivePaneView[] {
    return this._paneViews;
  }

  /**
   * If you want autoscaling, define it
   */
  public autoscaleInfo(start: Logical, end: Logical): AutoscaleInfo | null {
    if (!this._vpData.profile.length) return null;
    return {
      priceRange: {
        minValue: this._vpData.profile[0].minPrice,
        maxValue:
          this._vpData.profile[this._vpData.profile.length - 1].maxPrice,
      },
    };
  }

  /**
   * Applies updated VolumeProfile options, re-slices data, recalculates the profile, and updates the view.
   *
   * @param updatedOptions - A partial object containing one or more VolumeProfileOptions to update.
   */
  public applyOptions(updatedOptions: Partial<VolumeProfileOptions>): void {
    // Merge the new options into the existing options object.
    this._options = {
      ...this._options,
      ...updatedOptions,
    };

    // Re-slice the data based on the updated p1 and p2 points.
    this.sliceData();

    // Recompute the volume profile bins with the updated options.
    this._vpData = this.calculateVolumeProfile();

    // Trigger an update to re-render the pane views.
    this.update();
  }
}

/**
 * The VolumeProfilePaneView => transforms bins => screen coords, returns a renderer
 */
class VolumeProfilePaneView implements ISeriesPrimitivePaneView {
  private _source: VolumeProfile;
  private _x: Coordinate | null = null;
  private _width: number = 0;
  private _items: VolumeProfileItem[] = [];
  private _rightSide: boolean;
  private _maxVolume: number;
  public visibleRange: Range | null = null;
  _p1: ViewPoint = { x: null, y: null };
  _p2: ViewPoint = { x: null, y: null };

  constructor(source: VolumeProfile) {
    this._source = source;
    this._rightSide = this._source._options.rightSide ?? true;
    // compute maxVolume from the profile
    this._maxVolume = this._source._vpData.profile.reduce((acc, bin) => {
      return Math.max(acc, bin.upData + bin.downData);
    }, 0);
  }

  public update(): void {
    if (!this._source.p1 || !this._source.p2) return;

    const data = this._source._vpData;
    const chart = this._source.chart_;
    const series = this._source.series_;
    const timeScale = chart.timeScale();

    // Convert data.time => x
    this._x = timeScale.timeToCoordinate(data.time) ?? null;

    const barSpacing = timeScale.options().barSpacing ?? 1;

    const start = Math.max(
      0,
      Math.min(this._source.p1.logical, this._source.p2.logical)
    );
    const end = Math.min(
      Math.max(this._source.p1.logical, this._source.p2.logical),
      this._source._originalData.length - 1
    );

    this._width =
      (data.width && data.width !== 0 ? data.width : (end - start) / 3) *
      barSpacing;

    // Convert p1/p2 => canvas coords
    this._p1 = convertPoint(this._source.p1, chart, series) as ViewPoint;
    this._p2 = convertPoint(this._source.p2, chart, series) as ViewPoint;

    // Rebuild items from bins
    this._items = [];
    if (!data.profile.length) return;

    // Possibly re-check maxVolume if slice changed
    this._maxVolume = data.profile.reduce((acc, bin) => {
      return Math.max(acc, bin.upData + bin.downData);
    }, 0);

    for (const bin of data.profile) {
      const y1 = series.priceToCoordinate(bin.maxPrice);
      const y2 = series.priceToCoordinate(bin.minPrice);
      if (y1 == null || y2 == null) {
        this._items.push({
          y1: null,
          y2: null,
          combinedWidth: 0,
          upWidth: 0,
          downWidth: 0,
          color: bin.color,
          borderColor: bin.borderColor,
        });
        continue;
      }
      const rawVolume = bin.upData + bin.downData;
      const combinedWidth =
        this._maxVolume > 0 ? this._width * (rawVolume / this._maxVolume) : 0;

      let upWidth = 0,
        downWidth = 0;
      if (rawVolume > 0) {
        upWidth = (bin.upData / rawVolume) * combinedWidth;
        downWidth = (bin.downData / rawVolume) * combinedWidth;
      }
      this._items.push({
        y1,
        y2,
        combinedWidth,
        upWidth,
        downWidth,
        color: bin.color,
        borderColor: bin.borderColor,
      });
    }
  }

  public renderer(): ISeriesPrimitivePaneRenderer {
    return new VolumeProfileRenderer(
      {
        x: this._x,
        width: this._width,
        items: this._items,
        visibleRange: {
          from: this._source.chart
            .timeScale()
            .logicalToCoordinate(
              Math.max(0, this._source.visibleRange!.from) as Logical
            ) as number as Logical,

          to: this._source.chart
            .timeScale()
            .logicalToCoordinate(
              Math.min(
                this._source.series.data().length - 1,
                this._source.visibleRange!.to
              ) as Logical
            ) as number as Logical
        },
        maxVolume: this._maxVolume,
        maxBars: this._source.series.data().length
      },
      this._p1,
      this._p2,
      this._source._options,
      false
    );
}

  zOrder() {
    return 'bottom' as SeriesPrimitivePaneViewZOrder;
}

}

/**
 * The VolumeProfileRenderer => draws bins, extends TwoPointDrawingPaneRenderer
 */
export class VolumeProfileRenderer
  extends TwoPointDrawingPaneRenderer
  implements ISeriesPrimitivePaneRenderer
{
  private _data: VolumeProfileRendererData;
  private options: VolumeProfileOptions;
  public p1: ViewPoint;
  public p2: ViewPoint;
  constructor(
    data: VolumeProfileRendererData,
    p1: ViewPoint,
    p2: ViewPoint,
    options: VolumeProfileOptions,
    hovered: boolean
  ) {
    super(p1, p2, options, hovered);
    this._data = data;
    this.options = options;
    this.p1 = p1;
    this.p2 = p2;
  }

  draw(target: CanvasRenderingTarget2D): void {}

  drawBackground(target: CanvasRenderingTarget2D): void {
    console.log(
      `[VolumeProfileRenderer] draw() called with rightSide: ${this.options.rightSide}`
    );
    target.useBitmapCoordinateSpace((scope) => {
      let ctx = scope.context;

      // Draw grid lines
      this._drawGrid(ctx, scope);
      setLineStyle(ctx, this.options.lineStyle);

      // Draw the volume profile bars
      this._data.items.forEach((row, index) => {
        if (row.y1 === null || row.y2 === null) return;
        if (this._data.x === null) return; // Ensure x-coordinate is valid

        // Calculate rectangle position and dimensions
        const rectY = Math.min(row.y1, row.y2) * scope.verticalPixelRatio;
        const rectHeight = Math.abs(row.y2 - row.y1) * scope.verticalPixelRatio;
        const combinedWidth = row.upWidth + row.downWidth;
        const rectWidth = combinedWidth * scope.horizontalPixelRatio;

        // Determine rectX based on rightSide
        let rectX: number;
        if (this.options.rightSide) {
          // Render on the right side
          rectX = (this._data.x - combinedWidth) * scope.horizontalPixelRatio;
        } else {
          // Render on the left side
          rectX = this._data.x * scope.horizontalPixelRatio;
        }

        // Dynamic radius calculation
        const minRadius = 2; // Minimum radius in pixels
        const maxRadius = 25; // Maximum radius in pixels
        const percentage = 0.25; // 25% of the bar's height
        const radius = Math.min(
          Math.max(rectHeight * percentage, minRadius),
          maxRadius
        );

        if (rectHeight > 0) {
          // Draw the border rectangle
          ctx.beginPath();
          this._drawRoundedRect(
            ctx,
            rectX,
            rectY,
            rectWidth,
            rectHeight,
            radius
          );
          ctx.strokeStyle = row.borderColor;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Calculate fill dimensions
          const fillWidth =
            Math.max(row.upWidth, row.downWidth) * scope.horizontalPixelRatio;
          let fillX: number;

          if (!this.options.rightSide) {
            // Fill starts from the left of the bar
            fillX = rectX;
          } else {
            // Fill starts from the left minus fillWidth (i.e., from the right side)
            fillX = rectX + (combinedWidth - fillWidth);
          }

          // Draw the filled rectangle representing greater volume
          ctx.beginPath();
          this._drawRoundedRect(
            ctx,
            fillX,
            rectY,
            fillWidth,
            rectHeight,
            radius
          );
          ctx.fillStyle = row.color;
          ctx.fill();
        }
      });
    });
  }
  /**
   * Draw a grid within the volume profile region, aligning grid rows with sections.
   */
  private _drawGrid(
    ctx: CanvasRenderingContext2D,
    scope: BitmapCoordinatesRenderingScope
  ): void {
    const { items, x } = this._data;

    if (!items || items.length === 0 || x === null) return;

    // Check if grid drawing is enabled
    if (!this.options.drawGrid) return;

    // Determine the grid width
    let gridWidth: number;

    if (this.options.gridWidth !== undefined && this.options.gridWidth !== 1) {
      // Use the specified gridWidth from options
      gridWidth = this.options.gridWidth * scope.horizontalPixelRatio;
    } else {
        
        gridWidth = (this._data.visibleRange.to -this._data.visibleRange.from) * scope.horizontalPixelRatio;;
    }

    // Set grid line color
    ctx.strokeStyle = this.options.visible
      ? this.options.gridColor || "rgba(255, 255, 255, 0.2)"
      : "rgba(0,0,0,0)"; // Use gridColor from options or default

    // Use setLineStyle to configure grid line style
    setLineStyle(ctx, this.options.gridLineStyle || LineStyle.Solid);

    // Loop through each item to draw the grid lines individually with correct offset
    items.forEach((item) => {
        if (item.y1 === null || item.y2 === null) return;

        // Calculate per-item X shift amount based on its upWidth and downWidth
        const shiftAmount = (item.upWidth + item.downWidth) * scope.horizontalPixelRatio;

    let gridStartX: number;
    let gridEndX: number;

    if (this.options.rightSide) {
            gridStartX = (x - gridWidth);
            gridEndX = x - shiftAmount;
    } else {
            gridStartX = x + shiftAmount;
            gridEndX = x + gridWidth ;
        }

        // Scale Y-axis positions
        const y1 = item.y1 * scope.verticalPixelRatio;
        const y2 = item.y2 * scope.verticalPixelRatio;

        // Draw horizontal grid lines per item
        ctx.beginPath();
        ctx.moveTo(gridStartX, y1);
        ctx.lineTo(gridEndX, y1);
        ctx.stroke();

      ctx.beginPath();
        ctx.moveTo(gridStartX, y2);
        ctx.lineTo(gridEndX, y2);
      ctx.stroke();
    });


  }

  /**
   * Draws a rounded rectangle on the canvas context.
   * Rounds left corners if rightSide is true, otherwise rounds right corners.
   * @param ctx - Canvas rendering context.
   * @param x - The x-coordinate of the rectangle's starting point.
   * @param y - The y-coordinate of the rectangle's starting point.
   * @param w - The width of the rectangle.
   * @param h - The height of the rectangle.
   * @param r - The radius for the rounded corners.
   * @param rightSide - Determines which corners to round.
   */
  private _drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const rFinal = Math.min(r, w / 2, h / 2); // Ensure radius doesn't exceed dimensions
    ctx.beginPath();
    if (this.options.rightSide) {
      // Round top-left and bottom-left corners
      ctx.moveTo(x + rFinal, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + rFinal, y + h);
      ctx.arcTo(x, y + h, x, y + h - rFinal, rFinal);
      ctx.lineTo(x, y + rFinal);
      ctx.arcTo(x, y, x + rFinal, y, rFinal);
    } else {
      // Round top-right and bottom-right corners
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - rFinal, y);
      ctx.arcTo(x + w, y, x + w, y + rFinal, rFinal);
      ctx.lineTo(x + w, y + h - rFinal);
      ctx.arcTo(x + w, y + h, x + w - rFinal, y + h, rFinal);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}
