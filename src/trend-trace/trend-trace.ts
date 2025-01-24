// TrendTrace.ts
import {
  BitmapCoordinatesRenderingScope,
  CanvasRenderingTarget2D,
} from "fancy-canvas";
import {
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  Time,
  Logical,
  SeriesAttachedParameter,
  Point as CanvasPoint,
  MouseEventParams,
  Point,
  AreaSeriesOptions,
  BarSeriesOptions,
  BaselineSeriesOptions,
  CandlestickSeriesOptions,
  CustomSeriesOptions,
  HistogramSeriesOptions,
  LineSeriesOptions,
  LineStyle,
  SeriesType,
} from "lightweight-charts";
import { PluginBase } from "../plugin-base";
import { setOpacity } from "../helpers/colors";
import { convertPoint } from "../helpers/formatting";
import { Handler } from "../general";
import { ViewPoint } from "../drawing/pane-view";
import { DrawingOptions } from "../drawing/options";
import { CandleShape, parseCandleShape } from "../ohlc-series/data";
import {
  ohlcRectangle,
  ohlcRounded,
  ohlcEllipse,
  ohlcArrow,
  ohlc3d,
  ohlcPolygon,
} from "../ohlc-series/shapes";
import { InteractionState } from "../drawing/drawing";
import {
  _measureLogicalRange,
  _measurePriceRange,
  isPointCloseCanvas,
} from "../helpers/general";
import { Point as LogicalPoint } from "../drawing/data-source";
import { TwoPointDrawingPaneRenderer } from "../drawing/pane-renderer";
import {
  ensureExtendedSeries,
  ISeriesApiExtended,
  pickCommonOptions,
} from "../helpers/series";
import { setLineStyle } from "../helpers/canvas-rendering";
import {
  Sequence,
  SequenceOptions,
  defaultSequenceOptions,
  Spatial,
  DataPoint,
} from "./sequence";

/* ============================================================================
  TYPE & INTERFACE DEFINITIONS
============================================================================ */

/* ============================================================================
  TRENDTRACE PLUGIN CLASS
============================================================================ */
export class TrendTrace extends PluginBase implements ISeriesPrimitive<Time> {
  static type = "TrendTrace";

  _paneViews: TrendTracePaneView[];
  _sequence: Sequence;
  _options: SequenceOptions;
  _state: InteractionState = InteractionState.NONE;
  _handler: Handler;
  _source: ISeriesApiExtended;
  _originalP1: LogicalPoint;
  _originalP2: LogicalPoint;
  p1: LogicalPoint;
  p2: LogicalPoint;
  protected _points: (Point | null)[] = [];
  public title: string = "";

  protected _startDragPoint: LogicalPoint | null = null;
  protected _latestHoverPoint: any | null = null;

  protected static _mouseIsDown: boolean = false;

  public static hoveredObject: TrendTrace | null = null;
  public static lastHoveredObject: TrendTrace | null = null;

  protected _listeners: any[] = [];

  public _hovered: boolean = false;
  constructor(
    handler: Handler,
    source: ISeriesApiExtended,
    p1: LogicalPoint,
    p2: LogicalPoint,
    options?: Partial<SequenceOptions>
  ) {
    super();
    this._handler = handler;
    this._source = source;

    // Initialize original points
    this._originalP1 = { ...p1 };
    this._originalP2 = { ...p2 };
    const sourceOptions: Readonly<
      | BarSeriesOptions
      | CandlestickSeriesOptions
      | AreaSeriesOptions
      | BaselineSeriesOptions
      | LineSeriesOptions
      | HistogramSeriesOptions
      | CustomSeriesOptions
    > = this._source.options();
    // Step 2. Filter both seriesOpts and the explicit options to include only keys
    // that exist in our default options.
    const filteredSeriesOpts = pickCommonOptions(
      defaultSequenceOptions,
      sourceOptions
    ) as SequenceOptions;

    // Merge in order: defaults < series options < explicit options.
    this._options = {
      ...filteredSeriesOpts,
      ...options,
    };

    // Create and store the sequence
    this._sequence = this._createSequence(p1, p2);
    this.p1 = this._sequence.p1;
    this.p2 = this._sequence.p2;
    // Initialize pane views
    // this._hovered = false
    // Subscribe to chart or global events
    this._subscribeEvents();
    this._paneViews = [new TrendTracePaneView(this)];
  }

  attached(params: SeriesAttachedParameter): SeriesAttachedParameter {
    super.attached(params);
    this._createSequence(this._originalP1, this._originalP2);
    this._source = ensureExtendedSeries(params.series, this._handler.legend);
    this.title = params.series.options().title;
    return {
      chart: params.chart,
      series: params.series,
      requestUpdate: params.requestUpdate,
    };
  }

  paneViews() {
    return this._paneViews;
  }

  detached(): void {
    super.detached();
    this._paneViews = [];
  }

  private _createSequence(p1: LogicalPoint, p2: LogicalPoint): Sequence {
    const sequence = new Sequence(
      this._handler,
      this._source,
      p1,
      p2,
      this._options,
      undefined
    );
    sequence.onComplete = () => this.updateViewFromSequence();
    this.updateViewFromSequence();
    return sequence;
  }
  public applyOptions(
    options: Partial<SequenceOptions>,
  ): void {
    // Destructure to separate spatial properties from all other options.
    // We assume that the spatial properties (if any) are provided under the keys "scale" and "shift".
    // The rest of the properties are our sequence options.
   

    // Update our options: only the explicitly provided fields are merged.
    this._options = {
      ...this._options,
      ...options,
    };

    // Relay the changes to our underlying sequence.
    if (this._sequence) {
      this._sequence.applyOptions(this._options);
    }

    // Finally, trigger an update (or reprocess the sequence).
    this.requestUpdate();
  }

  private _pendingUpdate: boolean = false;

  public updateViewFromSequence(): void {
    if (!this._pendingUpdate) {
      this._pendingUpdate = true;
      requestAnimationFrame(() => {
        super.requestUpdate();
        console.log("Updating view with sequence data:", this._sequence?.data);
        this._pendingUpdate = false;
      });
    }
  }

  getOptions(): SequenceOptions {
    return this._options;
  }

  /**
   * Subscribe to relevant events, e.g. crosshair move, chart click.
   * If your framework differs, adapt accordingly.
   */
  private _subscribeEvents() {
    this._handler.chart.subscribeCrosshairMove(this._handleMouseMove);
    this._handler.chart.subscribeClick(this._handleMouseDownOrUp);
  }

  /** Use the local methods to subscribe/unsubscribe from DOM events if needed. */
  protected _subscribe(name: keyof DocumentEventMap, listener: any) {
    document.body.addEventListener(name, listener);
    this._listeners.push({ name, listener });
  }

  protected _unsubscribe(name: keyof DocumentEventMap, callback: any) {
    document.body.removeEventListener(name, callback);

    const toRemove = this._listeners.find(
      (x) => x.name === name && x.listener === callback
    );
    this._listeners.splice(this._listeners.indexOf(toRemove), 1);
  }

  _handleHoverInteraction(param: MouseEventParams) {
    this._latestHoverPoint = param.point;
    if (TrendTrace._mouseIsDown) {
      this._handleDragInteraction(param);
    } else {
      if (this._mouseIsOverSequence(param)) {
        if (this._state != InteractionState.NONE) return;
        this._moveToState(InteractionState.HOVERING);
        TrendTrace.hoveredObject = TrendTrace.lastHoveredObject = this;
      } else {
        if (this._state == InteractionState.NONE) return;
        this._moveToState(InteractionState.NONE);
        if (TrendTrace.hoveredObject === this) TrendTrace.hoveredObject = null;
      }
    }
  }
  /**
   * A pseudo-click handler that toggles mouseDown state
   * If user is already down, we finalize a mouse up, etc.
   */
  private _handleMouseDownOrUp = () => {
    // If we're not "over" anything, do nothing
    if (!this._latestHoverPoint) {
      return;
    }
    TrendTrace._mouseIsDown = !TrendTrace._mouseIsDown;

    if (TrendTrace._mouseIsDown) {
      // Mouse just went down => set DRAGGING or DRAGGING_P1 or DRAGGING_P2
      this._onMouseDown();
    } else {
      // Mouse just went up => finalize the drag
      this._onMouseUp();
    }
  };

  /**
   * A pseudo-mouse-move/crosshair-move handler
   * We do hover detection or if mouse is down, do drag.
   */
  private _handleMouseMove = (param: MouseEventParams) => {
    const mousePoint = this._eventToPoint(param, this._source);
    this._latestHoverPoint = mousePoint;

    if (TrendTrace._mouseIsDown) {
      // If user is dragging
      this._handleDragInteraction(param);
    } else {
      // Check if user is near p1/p2 or inside the "body"
      if (
        this._mouseIsOverPoint(param, 1) ||
        this._mouseIsOverPoint(param, 2)
      ) {
        if (this._state === InteractionState.NONE) {
          this._moveToState(InteractionState.HOVERING);
        }
      } else if (this._mouseIsOverSequence(param)) {
        if (this._state === InteractionState.NONE) {
          this._moveToState(InteractionState.HOVERING);
        }
      } else {
        // Not over anything
        if (this._state !== InteractionState.NONE) {
          this._moveToState(InteractionState.NONE);
        }
      }
    }
  };

  private _onMouseUp() {
    TrendTrace._mouseIsDown = false;
    this.chart.applyOptions({ handleScroll: true });

    this._moveToState(InteractionState.HOVERING);
    this._startDragPoint = null;
  }

  private _handleDragInteraction(param: MouseEventParams): void {
    if (
      this._state !== InteractionState.DRAGGING &&
      this._state !== InteractionState.DRAGGINGP1 &&
      this._state !== InteractionState.DRAGGINGP2
    ) {
      return;
    }
    const mousePoint = this._eventToPoint(param, this.series);
    if (!mousePoint || !this._startDragPoint) return;

    // Compute difference
    const diff = this._getDiff(mousePoint, this._startDragPoint);

    // Apply the difference to p1 or p2 or entire shape
    this._onDrag(diff);

    this._startDragPoint = mousePoint; // update reference
    this.requestUpdate();
  }

  private _mouseIsOverPoint(param: MouseEventParams, which: 1 | 2): boolean {
    // Define a tolerance factor (e.g., 5% of the pane width/height)
    const toleranceFactor = 0.05;

    // Determine which target canvas point to check (p1 or p2)
    const targetCanvasPoint: ViewPoint =
      which === 1
        ? { x: this._paneViews[0]._p1.x, y: this._paneViews[0]._p1.y }
        : { x: this._paneViews[0]._p2.x, y: this._paneViews[0]._p2.y };

    // Ensure chart is defined.
    if (!this.chart) return false;

    // Use the isPointCloseCanvas function
    return isPointCloseCanvas(
      param,
      targetCanvasPoint as CanvasPoint,
      toleranceFactor,
      this.chart
    );
  }

  protected _mouseIsOverSequence(param: MouseEventParams): boolean {
    if (!param.logical || !param.point) {
      return false;
    }

    const mousePrice = this._source.coordinateToPrice?.(param.point.y);

    if (mousePrice == null) {
      return false;
    }
    let bar;
    // For a more robust approach, you might search for the bar whose .logical matches param.logical.
    // Or find the nearest bar to param.logical if there's no direct match.
    // Here's a simplistic approach:
    if (param.logical) {
      bar = this._sequence.data.find(
        (d) => Math.round(d.x1) === Math.round(param.logical!)
      );
    }
    if (!bar) {
      return false;
    }

    // If it’s OHLC data, check (low..high)
    if (bar.low !== (0 || undefined) && bar.high !== (0 || undefined)) {
      return mousePrice >= bar.low && mousePrice <= bar.high;
    }
    // If single-value data
    if (bar.value !== (0 || undefined)) {
      // For example, we can define a small tolerance of ±(bar.value*0.02)
      const tolerance = bar.value * 0.05;
      return (
        mousePrice > bar.value - tolerance && mousePrice < bar.value + tolerance
      );
    }
    return false;
  }

  _moveToState(state: InteractionState) {
    switch (state) {
      case InteractionState.NONE:
        document.body.style.cursor = "default";
        this._hovered = false;
        this.requestUpdate();
        this._unsubscribe("mousedown", this._handleMouseDownInteraction);
        break;

      case InteractionState.HOVERING:
        document.body.style.cursor = "pointer";
        this._hovered = true;
        this.requestUpdate();
        this._subscribe("mousedown", this._handleMouseDownInteraction);
        this._unsubscribe("mouseup", this._handleMouseDownInteraction);
        this.chart.applyOptions({ handleScroll: true });
        break;

      case InteractionState.DRAGGINGP1:
      case InteractionState.DRAGGINGP2:
      case InteractionState.DRAGGING:
        document.body.style.cursor = "grabbing";
        this._subscribe("mouseup", this._handleMouseUpInteraction);
        this.chart.applyOptions({ handleScroll: false });
        break;
    }
    this._state = state;
  }

  protected _addDiffToPoint(
    point: LogicalPoint | null,
    logicalDiff: number,
    priceDiff: number
  ) {
    if (!point) return;
    point.logical = (point.logical + logicalDiff) as Logical;
    point.price = point.price + priceDiff;
    point.time = this.series.dataByIndex(point.logical)?.time || null;
  }

  _onDrag(diff: any) {
    if (
      this._state == InteractionState.DRAGGING ||
      this._state == InteractionState.DRAGGINGP1
    ) {
      this._addDiffToPoint(
        this._sequence.p1,
        this._options.xScaleLock && this._state == InteractionState.DRAGGINGP1
          ? 0
          : diff.logical,
        this._options.yScaleLock && this._state == InteractionState.DRAGGINGP1
          ? 0
          : diff.price
      );
    }
    if (
      this._state == InteractionState.DRAGGING ||
      this._state == InteractionState.DRAGGINGP2
    ) {
      this._addDiffToPoint(
        this._sequence.p2,
        this._options.xScaleLock && this._state == InteractionState.DRAGGINGP2
          ? 0
          : diff.logical,
        this._options.yScaleLock && this._state == InteractionState.DRAGGINGP2
          ? 0
          : diff.price
      );
    }
  }

  protected _onMouseDown() {
    this._startDragPoint = null;
    const hoverPoint = this._latestHoverPoint;
    if (!hoverPoint) return;
    const p1 = this._paneViews[0]._p1;
    const p2 = this._paneViews[0]._p2;

    if (!p1.x || !p2.x || !p1.y || !p2.y)
      return this._moveToState(InteractionState.DRAGGING);

    const tolerance = 20;
    if (
      Math.abs(hoverPoint.x - p1.x) < tolerance &&
      Math.abs(hoverPoint.y - p1.y) < tolerance
    ) {
      this.chart.applyOptions({ handleScroll: false });

      this._moveToState(InteractionState.DRAGGINGP1);
    } else if (
      Math.abs(hoverPoint.x - p2.x) < tolerance &&
      Math.abs(hoverPoint.y - p2.y) < tolerance
    ) {
      this.chart.applyOptions({ handleScroll: false });

      this._moveToState(InteractionState.DRAGGINGP2);
    } else {
      this.chart.applyOptions({ handleScroll: false });

      this._moveToState(InteractionState.DRAGGING);
    }
  }

  private _handleMouseDownInteraction = () => {
    this._onMouseDown();
  };
  private _handleMouseUpInteraction = () => {
    this._onMouseUp();
  };

  /**
   * Utility: diff in logical & price between two points
   */
  private _getDiff(p1: LogicalPoint, p2: LogicalPoint) {
    return {
      logical: p1.logical - p2.logical,
      price: p1.price - p2.price,
    };
  }

  /**
   * Convert the mouse event to a LogicalPoint (with price).
   */
  private _eventToPoint(
    param: MouseEventParams,
    series: ISeriesApi<any>
  ): LogicalPoint | null {
    if (!series || !param.point || !param.logical) return null;
    const barPrice = series.coordinateToPrice(param.point.y);
    if (barPrice == null) return null;
    return {
      time: param.time || null,
      logical: param.logical,
      price: barPrice.valueOf(),
    };
  }
}

/* ============================================================================
  TRENDTRACE PANE VIEW
============================================================================ */
export class TrendTracePaneView implements ISeriesPrimitivePaneView {
  _p1: ViewPoint = { x: null, y: null };
  _p2: ViewPoint = { x: null, y: null };
  _plugin: TrendTrace;

  constructor(plugin: TrendTrace) {
    this._plugin = plugin;
  }

  renderer(): TrendTracePaneRenderer {
    if (!this._plugin._sequence) {
      throw new Error("No sequence available for rendering.");
    }
    return new TrendTracePaneRenderer(
      this._plugin,
      this._plugin._options,
      false
    );
  }
}

export class TrendTracePaneRenderer
  extends TwoPointDrawingPaneRenderer
  implements ISeriesPrimitivePaneRenderer
{
  private _source: TrendTrace;
  public _options: SequenceOptions;
  constructor(source: TrendTrace, options: SequenceOptions, hovered: boolean) {
    super(
      convertPoint(
        source._sequence.p1,
        source.chart,
        source._source
      ) as ViewPoint,
      convertPoint(
        source._sequence.p2,
        source.chart,
        source._source
      ) as ViewPoint,
      options,
      hovered
    );
    this._source = source;
    this._options = options;
  }

  public draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(
      (scope: BitmapCoordinatesRenderingScope) => {
        const ctx = scope.context;
        const { chart } = this._source;

        ctx.save();

        const { horizontalPixelRatio } = scope;
        const data = this._source._sequence!.data;
        const timeScale = this._source.chart.timeScale();
        const series = this._source._source;
        const visibleRange = chart.timeScale().getVisibleLogicalRange();
        const barSpace =
          chart.options().width /
          ((visibleRange?.to ?? data.length) - (visibleRange?.from ?? 0));
        console.log("barSpace:", barSpace);

        if (!series || !timeScale || data.length === 0) {
          ctx.restore();
          return;
        }

        const firstX1 = data[0].x1 as Logical;
        const lastX1 = data[data.length - 1].x1 as Logical;
        const canvasX1 = chart.timeScale().logicalToCoordinate(firstX1) ?? 0;
        const canvasX2 =
          chart.timeScale().logicalToCoordinate(lastX1) ?? canvasX1;

        const _firstX1 = canvasX1 * horizontalPixelRatio;
        const _lastX1 = canvasX2 * horizontalPixelRatio;
        const inverted =
          (this._source._sequence._originalP2.logical >
            this._source._sequence._originalP1.logical &&
            this._source._sequence.p2.logical >
              this._source._sequence.p1.logical) ||
          (this._source._sequence._originalP2.logical <
            this._source._sequence._originalP1.logical &&
            this._source._sequence.p2.logical <
              this._source._sequence.p1.logical);
        const scaledBars = data
          .map((bar, index) => {
            const scaledX1 =
              _firstX1 +
              (inverted ? 1 : -1) *
                (index *
                  ((_lastX1 - _firstX1) / data.length) *
                  this._source._sequence.spatial.scale.x);
            const scaledX2 =
              _firstX1 +
              (inverted ? 1 : -1) *
                ((index + 1) *
                  ((_lastX1 - _firstX1) / data.length) *
                  this._source._sequence.spatial.scale.x);
            const color = !bar.isUp
              ? inverted
                ? this._options.downColor
                : this._options.upColor
              : inverted
              ? this._options.upColor
              : this._options.downColor;

            const borderColor = !bar.isUp
              ? inverted
                ? this._options.borderDownColor
                : this._options.borderUpColor
              : inverted
              ? this._options.borderUpColor
              : this._options.borderDownColor;

            const wickColor = !bar.isUp
              ? inverted
                ? this._options.wickDownColor
                : this._options.wickUpColor
              : inverted
              ? this._options.wickUpColor
              : this._options.wickDownColor;

            // Include all required properties in the returned object
            return {
              ...bar,
              scaledX1,
              scaledX2,
              color,
              borderColor,
              wickColor,
            };
          })
          .filter(
            (
              bar
            ): bar is DataPoint & {
              scaledX1: number;
              scaledX2: number;
              color: string | undefined;
              borderColor: string | undefined;
              wickColor: string | undefined;
            } => bar !== null
          );
        console.log("Scaled bars:", scaledBars);

        // Continue with drawing logic using `scaledBars`...

        //const firstPoint = scaledBars[0];
        //const lastPoint = scaledBars[scaledBars.length - 1];

        if (this.isOHLCData(data)) {
          if (this._options.wickVisible) {
            this._drawWicks(scope, scaledBars);
          }
          this._drawCandles(scope, scaledBars, barSpace);

          //// Draw end circles
          //this._drawEndCircle(
          //	scope,
          //	firstPoint.scaledX1,
          //	series.priceToCoordinate(lastPoint.open??lastPoint.close??lastPoint.value??0) ??0 * verticalPixelRatio				);
          //this._drawEndCircle(
          //	scope,
          //	lastPoint.scaledX2,
          //	series.priceToCoordinate(lastPoint.close??lastPoint.open??lastPoint.value??0) ??0 * verticalPixelRatio
          //);
        } else if (this.isSingleValueData(data)) {
          this._drawSingleValueData(scope, scaledBars);

          //// Draw end circles
          //this._drawEndCircle(
          //	scope,
          //	firstPoint.scaledX1,
          //	series.priceToCoordinate(firstPoint.value!) ?? 0 * verticalPixelRatio
          //);
          //this._drawEndCircle(
          //	scope,
          //	lastPoint.scaledX2,
          //	series.priceToCoordinate(lastPoint.value!) ?? 0 * verticalPixelRatio
          //);
        }

        ctx.restore();
      }
    );
  }
  /**
   * Draws data points and connecting lines on the bitmap canvas.
   * Each point is drawn at its scaledX1 coordinate and the lines connect consecutive
   * points directly from scaledX1 to scaledX1.
   *
   * @param scope - Contains the canvas context and pixel ratios.
   * @param data - Array of data points with pre-calculated scaled coordinates.
   */
  private _drawSingleValueData(
    scope: BitmapCoordinatesRenderingScope,
    data: (DataPoint & { scaledX1: number; scaledX2: number })[]
  ): void {
    const { context: ctx, horizontalPixelRatio, verticalPixelRatio } = scope;
    let previousBar:
      | (DataPoint & { scaledX1: number; scaledX2: number })
      | null = null;

    // Set the line appearance once, before drawing
    ctx.lineWidth = this._options.lineWidth ?? 1;
    setLineStyle(ctx, (this._options.lineStyle ?? 1) as LineStyle);
    ctx.strokeStyle = this._options.visible
      ? this._options.lineColor ?? "#ffffff"
      : "rgba(0,0,0,0)";
    ctx.beginPath();

    data.forEach((point) => {
      // Skip point if there's no valid logical x value.
      if (point.x1 === null || point.x1 === undefined) return;

      // Calculate the current point's coordinates using scaledX1.
      const scaledX1: number = point.scaledX1 * horizontalPixelRatio;
      const scaledValue: number =
        (this._source._source?.priceToCoordinate(point.value ?? 0) ?? 0) *
        verticalPixelRatio;

      ctx.lineTo(scaledX1, scaledValue);
      ctx.stroke();

      // Update previousBar to be the current point.
      previousBar = point;
    });
  }

  private _drawWicks(
    scope: BitmapCoordinatesRenderingScope,
    bars: (DataPoint & {
      scaledX1: number;
      scaledX2: number;
      wickColor: string | undefined;
    })[]
  ): void {
    const { context: ctx, verticalPixelRatio } = scope;
    const inverted =
      (this._source._sequence._originalP2.price >
        this._source._sequence._originalP1.price &&
        this._source._sequence.p2.price > this._source._sequence.p1.price) ||
      (this._source._sequence._originalP2.price <
        this._source._sequence._originalP1.price &&
        this._source._sequence.p2.price < this._source._sequence.p1.price);
    bars.forEach((bar) => {
      const scaledX = bar.scaledX1 + (bar.scaledX2 + 1 - bar.scaledX1) / 2;
      const scaledHigh =
        (this._source.series.priceToCoordinate(bar.high ?? 0) ?? 0) *
        verticalPixelRatio;
      const scaledLow =
        (this._source.series.priceToCoordinate(bar.low ?? 0) ?? 0) *
        verticalPixelRatio;

      // Calculate the top and bottom parts of the wick based on max(open, close) and min(open, close)
      const scaledOpen =
        (this._source.series.priceToCoordinate(bar.open ?? 0) ?? 0) *
        verticalPixelRatio;
      const scaledClose =
        (this._source.series.priceToCoordinate(bar.close ?? 0) ?? 0) *
        verticalPixelRatio;
      const topWick = inverted
        ? Math.min(scaledOpen, scaledClose)
        : Math.max(scaledOpen, scaledClose);
      const bottomWick = inverted
        ? Math.max(scaledOpen, scaledClose)
        : Math.min(scaledOpen, scaledClose);

      ctx.strokeStyle = this._options.visible
        ? bar.wickColor ?? "#ffffff"
        : "rgba(0,0,0,0)";

      // Draw the top wick (high to max(open, close))
      ctx.beginPath();
      ctx.moveTo(scaledX, scaledHigh);
      ctx.lineTo(scaledX, topWick);
      ctx.stroke();

      // Draw the bottom wick (min(open, close) to low)
      ctx.beginPath();
      ctx.moveTo(scaledX, bottomWick);
      ctx.lineTo(scaledX, scaledLow);
      ctx.stroke();
    });
  }
  private _drawCandles(
    scope: BitmapCoordinatesRenderingScope,
    bars: (DataPoint & {
      scaledX1: number;
      scaledX2: number;
      color: string | undefined;
      borderColor: string | undefined;
    })[],
    barSpace: number
  ): void {
    const { context: ctx, horizontalPixelRatio, verticalPixelRatio } = scope;

    ctx.save();

    bars.forEach((bar) => {
      const candleWidth = barSpace * horizontalPixelRatio;
      const candleBodyWidth = bar.scaledX2 - bar.scaledX1 + candleWidth;

      if (!bar) {
        return;
      }
      const scaledOpen =
        (this._source.series.priceToCoordinate(bar.open!) ?? 0) *
        verticalPixelRatio;
      const scaledClose =
        (this._source.series.priceToCoordinate(bar.close!) ?? 0) *
        verticalPixelRatio;
      const scaledHigh =
        (this._source.series.priceToCoordinate(bar.high!) ?? 0) *
        verticalPixelRatio;
      const scaledLow =
        (this._source.series.priceToCoordinate(bar.low!) ?? 0) *
        verticalPixelRatio;

      const isUp = scaledClose >= scaledOpen;
      const barVerticalMax = Math.min(scaledOpen, scaledClose);
      const barVerticalMin = Math.max(scaledOpen, scaledClose);
      const barVerticalSpan = barVerticalMax - barVerticalMin;
      const barY = (barVerticalMax + barVerticalMin) / 2;

      const leftSide =
        bar.scaledX1 - (1 - candleWidth * (this._options.barSpacing ?? 0.8));
      const rightSide =
        bar.scaledX2 + (1 - candleWidth * (this._options.barSpacing ?? 0.8));
      const middle = (leftSide + rightSide) / 2;

      ctx.fillStyle = this._options.visible
        ? bar.color ?? "#ffffff"
        : "rgba(0,0,0,0)";
      ctx.strokeStyle = this._options.visible
        ? (this._options.borderVisible ? bar.borderColor : bar.color) ??
          "#ffffff"
        : "rgba(0,0,0,0)";
      ctx.lineWidth = bar.lineWidth ?? 1;
      setLineStyle(ctx, bar.lineStyle as LineStyle);

      const shape = this._options?.shape 
      || CandleShape.Rounded; // Use the enum value for defaults
  
  console.log("Selected candle shape:", shape);
  
  switch (shape) {
    case CandleShape.Rectangle:
      ohlcRectangle(ctx, leftSide, rightSide, barY, barVerticalSpan);
      break;
    case CandleShape.Rounded:
      ohlcRounded(ctx, leftSide, rightSide, barY, barVerticalSpan, 5);
      break;
    case CandleShape.Ellipse:
      ohlcEllipse(ctx, leftSide, rightSide, middle, barY, barVerticalSpan);
      break;
    case CandleShape.Arrow:
      ohlcArrow(ctx, leftSide, rightSide, middle, barY, barVerticalSpan, scaledHigh, scaledLow, isUp);
      break;
    case CandleShape.Cube:
      ohlc3d(
        ctx,
        bar.scaledX1,
        scaledHigh,
        scaledLow,
        scaledOpen,
        scaledClose,
        candleBodyWidth,
        candleBodyWidth,
        ctx.fillStyle,
        ctx.strokeStyle,
        isUp,
        barSpace
      );
      break;
    case CandleShape.Polygon:
      ohlcPolygon(ctx, leftSide, rightSide, barY, barVerticalSpan, scaledHigh, scaledLow, isUp);
      break;
    default:
      console.warn(`Unknown shape '${shape}', using default Rectangle`);
      ohlcRectangle(ctx, leftSide, rightSide, barY, barVerticalSpan);
      break;
    }
  

    ctx.restore();
  })}

  public _drawEndCircle(
    scope: BitmapCoordinatesRenderingScope,
    x: number,
    y: number
  ): void {
    const ctx = scope.context;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = this._options.visible
      ? this._options?.color ?? "#FF0000"
      : "rgba(0,0,0,0)";
    ctx.fill();
    ctx.strokeStyle = this._source._sequence!._options.lineColor ?? "#000";
    ctx.stroke();
    ctx.restore();
  }

  private isOHLCData(data: DataPoint[]): data is DataPoint[] {
    return data.every(
      (point) =>
        point.open !== undefined &&
        point.high !== undefined &&
        point.low !== undefined &&
        point.close !== undefined
    );
  }

  private isSingleValueData(data: DataPoint[]): data is DataPoint[] {
    return data.every((point) => point.value !== undefined);
  }
}
