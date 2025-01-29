import { Point } from './data-source';
import { DrawingOptions, defaultOptions } from './options';
import { Drawing } from './drawing';
import { TwoPointDrawingPaneView } from './pane-view';
import { PluginBase } from '../plugin-base';
import { ensureExtendedSeries, ISeriesApiExtended } from '../helpers/series';


export abstract class TwoPointDrawing extends Drawing {
    _paneViews: TwoPointDrawingPaneView[] = [];

    protected _hovered: boolean = false;

    public linkedObjects: PluginBase[] = []
    constructor(
        p1: Point,
        p2: Point,
        options?: Partial<DrawingOptions>
    ) {
        super()
        this.points.push(p1);
        this.points.push(p2);
        this._options = {
            ...defaultOptions,
            ...options,
        };
    }

    setFirstPoint(point: Point) {
        this.updatePoints(point);
    }

    setSecondPoint(point: Point) {
        this.updatePoints(null, point);
    }
    public detach(): void {
        this.linkedObjects.forEach((primitive:PluginBase) => {
            const series = primitive.series
            if (series){
            (series as ISeriesApiExtended).detachPrimitive(primitive)
            
            }
        });
        this.linkedObjects = [];  // Clear linked objects after detaching
        super.detach()

    }

    get p1() { return this.points[0]; }
    get p2() { return this.points[1]; }

    get hovered() { return this._hovered; }
}
