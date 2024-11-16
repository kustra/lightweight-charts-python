import {
	CanvasRenderingTarget2D,
	BitmapCoordinatesRenderingScope,
} from 'fancy-canvas';
import {
	ICustomSeriesPaneRenderer,
	PaneRendererCustomData,
	PriceToCoordinateConverter,
	Range,
	Time,
	
} from 'lightweight-charts';
import { ohlcSeriesOptions, ohlcSeriesData } from './ohlc-series';
import { setOpacity, darkenColor } from './helpers';
import { setLineStyle } from '../helpers/canvas-rendering';
interface BarItem {
	open: number;
	high: number;
	low: number;
	close: number;
	x: number;
	isUp: boolean;
	startIndex: number;
	endIndex: number;
	isInProgress?: boolean;
	color: string;
	borderColor: string;
	wickColor: string;
	originalData?: {       
		open: number;
		high: number;
		low: number;
		close: number;
	};
}

import { gridAndCrosshairMediaWidth } from '../helpers/dimensions/crosshair-width';

export class ohlcSeriesRenderer<TData extends ohlcSeriesData>
	implements ICustomSeriesPaneRenderer {
	_data: PaneRendererCustomData<Time, TData> | null = null;
	_options: ohlcSeriesOptions | null = null;

	draw(
		target: CanvasRenderingTarget2D,
		priceConverter: PriceToCoordinateConverter
	): void {
		target.useBitmapCoordinateSpace(scope =>
			this._drawImpl(scope, priceConverter)
		);
	}

	update(
		data: PaneRendererCustomData<Time, TData>,
		options: ohlcSeriesOptions
	): void {
		this._data = data;
		this._options = options;
	}

	private _seggregate(data: BarItem[], priceToCoordinate: (price: number) => number | null): BarItem[] {
		const groupSize = this._options?.chandelierSize || 1;
		const seggregatedBars: BarItem[] = [];
	
		for (let i = 0; i < data.length; i += groupSize) {
			const bucket = data.slice(i, i + groupSize);
			const isInProgress = bucket.length < groupSize && i + bucket.length === data.length;
			
			const aggregatedBar = this._chandelier(bucket, i, i + bucket.length - 1, priceToCoordinate, isInProgress);
			seggregatedBars.push(aggregatedBar);
		}
	
		return seggregatedBars;
	}
	private _chandelier(
		bucket: BarItem[],
		startIndex: number,
		endIndex: number,
		priceToCoordinate: (price: number) => number | null,
		isInProgress = false
	): BarItem {
		// Calculate the open and close prices with coordinate conversion
		const openPrice = bucket[0].originalData?.open ?? bucket[0].open ?? 0;
		const closePrice = bucket[bucket.length - 1].originalData?.close ?? bucket[bucket.length - 1].close ?? 0;
	
		// Convert to coordinates, with fallbacks to 0 for safe rendering
		const open = priceToCoordinate(openPrice) ?? 0;
		const close = priceToCoordinate(closePrice) ?? 0;
		const highPrice = Math.max(...bucket.map(bar => bar.originalData?.high ?? bar.high));
		const lowPrice = Math.min(...bucket.map(bar => bar.originalData?.low ?? bar.low));
		const high = priceToCoordinate(highPrice) ?? 0;
		const low = priceToCoordinate(lowPrice) ?? 0;
	
		// Center x position for HTF
		const x = bucket[0].x
	
		// Determine if the candle is up or down
		const isUp = closePrice > openPrice;
	
		// Explicitly map colors based on `isUp` status
		const color = isUp
			? (this._options?.upColor || 'rgba(0,255,0,.333)')
			: (this._options?.downColor || 'rgba(255,0,0,.333)');
	
		const borderColor = isUp
			? (this._options?.borderUpColor || setOpacity(color, 1))
			: (this._options?.borderDownColor || setOpacity(color, 1));
	
		const wickColor = isUp
			? (this._options?.wickUpColor || borderColor)
			: (this._options?.wickDownColor || borderColor);

	
	
	
		return {
			open,
			high,
			low,
			close,
			x,
			isUp,
			startIndex,
			endIndex,
			isInProgress,
			color,
			borderColor,
			wickColor,

		};
	}
	
	
	
	_drawImpl(
		renderingScope: BitmapCoordinatesRenderingScope,
		priceToCoordinate: PriceToCoordinateConverter
	): void {
		if (
			this._data === null ||
			this._data.bars.length === 0 ||
			this._data.visibleRange === null ||
			this._options === null
		) {
			return;
		}
	
		let lastClose = -Infinity;
		const bars: BarItem[] = this._data.bars.map((bar, index) => {
			const isUp = bar.originalData.close >= bar.originalData.open;
			lastClose = bar.originalData.close ?? lastClose;
	
			// Convert price to coordinate2
			const open = (bar.originalData.open as number) ?? 0;
			const high = (bar.originalData.high as number) ?? 0;
			const low = (bar.originalData.low as number) ?? 0;
			const close = (bar.originalData.close as number) ?? 0;
	
			// Determine colors based on isUp status
			const color = !isUp ? this._options?.upColor || 'rgba(0,0,0,0)' : this._options?.downColor || 'rgba(0,0,0,0)';
			const borderColor = !isUp ? this._options?.borderUpColor || color : this._options?.borderDownColor || color;
			const wickColor = !isUp ? this._options?.wickUpColor || color : this._options?.wickDownColor || color;

			return {
				open,
				high,
				low,
				close,
				x: bar.x,
				isUp,
				startIndex: index,
				endIndex: index,
				color,        // Add color
				borderColor,  // Add border color
				wickColor,     // Add wick color
			};
		});
	
		// Continue with rendering logic
		// ...
	

		const seggregatedBars =  this._seggregate(bars, priceToCoordinate)
	

		const radius = this._options.radius(this._data.barSpacing);
		const { horizontalPixelRatio, verticalPixelRatio } = renderingScope;
		const candleWidth = this._data!.barSpacing * horizontalPixelRatio ; // Adjusted width

		this._drawCandles(renderingScope, seggregatedBars, this._data.visibleRange, radius, candleWidth, horizontalPixelRatio, verticalPixelRatio);
		this._drawWicks(renderingScope,seggregatedBars,this._data.visibleRange)
	}
	private _drawWicks(
		renderingScope: BitmapCoordinatesRenderingScope,
		bars: readonly BarItem[],
		visibleRange: Range<number>,
		
	): void {
		if (this._data === null || this._options === null || !this._options?.wickVisible) {
			return;
		}
	
		// Skip wick drawing if the shape is '3d'
		if (this._options.shape === '3d') {
			return;
		}
	
		const { context: ctx, horizontalPixelRatio, verticalPixelRatio } = renderingScope;
		const candleWidth = this._data.barSpacing * horizontalPixelRatio;
		const wickWidth = gridAndCrosshairMediaWidth(horizontalPixelRatio);
	
		for (const bar of bars) {
			// Check if the bar is within the visible range
			if (bar.startIndex < visibleRange.from || bar.endIndex > visibleRange.to) {
				continue;
			}
          

			// Set wick color from bar's wickColor property
			ctx.fillStyle = bar.wickColor;
	
			// Calculate positions in pixels for high, low, open, and close
			const low = bar.low * verticalPixelRatio;
			const high = bar.high * verticalPixelRatio;
			const openCloseTop = Math.min(bar.open, bar.close) * verticalPixelRatio;
			const openCloseBottom = Math.max(bar.open, bar.close) * verticalPixelRatio;
			const barSpace = this._options?.barSpacing ?? 0.8

			// Set wick X position
			let wickX = bar.x * horizontalPixelRatio;
			const groupSize = bar.endIndex - bar.startIndex;
			if (groupSize && groupSize > 1) {
					wickX= wickX+((candleWidth) * Math.max(1, groupSize )/2) - ((1-barSpace) * candleWidth) 
				}
	
			// Adjust wick heights for the 'Polygon' shape
			let upperWickTop = high;
			let upperWickBottom = openCloseTop;
			let lowerWickTop = openCloseBottom;
			let lowerWickBottom = low;
			ctx.save();
			ctx.lineWidth=  this._options?.lineWidth??1
			if (this._options.shape === 'Polygon') {
				// Set halfway points for 'Polygon' shape
				upperWickBottom = (high + openCloseTop) / 2;
				lowerWickTop = (low + openCloseBottom) / 2;
			}
	
			// Draw the upper wick (from high to halfway point for 'Polygon')
			const upperWickHeight = upperWickBottom - upperWickTop;
			if (upperWickHeight > 0) {
				ctx.strokeRect(
					wickX - Math.floor(wickWidth / 2),
					upperWickTop,
					wickWidth,
					upperWickHeight
				);
			}
	
			// Draw the lower wick (from halfway point for 'Polygon' to low)
			const lowerWickHeight = lowerWickBottom - lowerWickTop;
			if (lowerWickHeight > 0) {
				ctx.strokeRect(
					wickX - Math.floor(wickWidth / 2),
					lowerWickTop,
					wickWidth,
					lowerWickHeight
				);
			}        		
			ctx.restore();

		}
	}
	
	
	private _drawCandles(
		renderingScope: BitmapCoordinatesRenderingScope,
		bars: readonly BarItem[],
		visibleRange: Range<number>,
		radius: number,
		candleWidth: number,
		horizontalPixelRatio: number,
		verticalPixelRatio: number
	): void {
		const { context: ctx } = renderingScope;
		const barSpace = this._options?.barSpacing ?? 0.8
		for (const bar of bars) {
			const groupSize = bar.endIndex - bar.startIndex;
			let barHorizontalSpan = this._options?.chandelierSize !== 1
				? (candleWidth) * (Math.max(1, groupSize + 1)) - ((1-barSpace) * candleWidth) 
				: (candleWidth * barSpace);
				const barHorizontalPos = bar.x * horizontalPixelRatio;
				const candleBodyWidth = candleWidth * barSpace;

			if (bar.startIndex < visibleRange.from || bar.endIndex > visibleRange.to) {
					continue;
				}
			// Calculate vertical positions
				const barVerticalMax = Math.min(bar.open, bar.close) * verticalPixelRatio;
				const barVerticalMin = Math.max(bar.open, bar.close) * verticalPixelRatio;
				const barVerticalSpan = barVerticalMax - barVerticalMin;
				const barY= (barVerticalMax+ barVerticalMin)/2
				ctx.save();

				// Set fill and stroke styles from bar properties
				ctx.fillStyle = bar.color;
				ctx.strokeStyle = bar.borderColor;
				ctx.lineWidth = 1.5;
                setLineStyle(ctx,this._options?.lineStyle??1 )
				ctx.lineWidth=  this._options?.lineWidth??1 
				
			// Draw based on shape type
				switch (this._options?.shape) {
					case 'Rectangle':
						this._drawCandle(ctx, barHorizontalPos, barY, candleBodyWidth, barHorizontalSpan, barVerticalSpan);
						break;
					case 'Rounded':
						this._drawRounded(ctx, barHorizontalPos, barVerticalMin, candleBodyWidth, barHorizontalSpan, barVerticalSpan, radius, horizontalPixelRatio);
						break;
					case 'Ellipse':
					this._drawEllipse(ctx, barHorizontalPos, barY, candleBodyWidth, barHorizontalSpan, barVerticalSpan);
						break;
					case 'Arrow':
					this._drawArrow(ctx, barHorizontalPos, barVerticalMax, barVerticalMin, candleBodyWidth, barHorizontalSpan, bar.high * verticalPixelRatio, bar.low * verticalPixelRatio, bar.isUp);
						break;
					case '3d':
					this._draw3d(ctx, barHorizontalPos, bar.high * verticalPixelRatio, bar.low * verticalPixelRatio, bar.open * verticalPixelRatio, bar.close * verticalPixelRatio, candleBodyWidth, barHorizontalSpan, bar.color, bar.borderColor, bar.isUp, barSpace);
						break;
					case 'Polygon':
					this._drawPolygon(ctx, barHorizontalPos, barVerticalMin + barVerticalSpan, barVerticalMin, candleBodyWidth, barHorizontalSpan, bar.high * verticalPixelRatio, bar.low * verticalPixelRatio, bar.isUp);
						break;

					default:
						// Optional: fallback for unknown shapes
						this._drawCandle(ctx, barHorizontalPos, barY, candleBodyWidth, barHorizontalSpan, barVerticalSpan);
						break;
					}
				
        		// Restore the state
        		ctx.restore();
				}
			}
	
		private _drawCandle(
			ctx: CanvasRenderingContext2D,
			xCenter: number,
			yCenter: number,
			candleWidth: number,
			combinedWidth: number,
			candleHeight: number
		): void {
			// Calculate the left and right edges of the candle based on xCenter and combined width
			const leftEdge = xCenter - candleWidth / 2;
			const rightEdge = xCenter -  (candleWidth/2) + combinedWidth;
			const topEdge = yCenter - candleHeight / 2;
			const bottomEdge = yCenter + candleHeight / 2;
		

			// Begin drawing the candle rectangle
			ctx.beginPath();
			ctx.moveTo(leftEdge, topEdge);
			ctx.lineTo(leftEdge, bottomEdge);
			ctx.lineTo(rightEdge, bottomEdge);
			ctx.lineTo(rightEdge, topEdge);
			ctx.closePath();
		
			// Fill and stroke the rectangle
			ctx.fill();
			ctx.stroke();
		}
		
	//private _drawXShape(ctx: CanvasRenderingContext2D, xCenter: number, openCloseTop: number, openCloseBottom: number, candleWidth: number, combinedWidth: number, candleHeight: number): void {
	//	const controlOffsetX = candleWidth / 3;
	//	const controlOffsetY = candleHeight / 3;
	//
	//	ctx.beginPath();
	//	ctx.moveTo(xCenter - candleWidth / 2, openCloseTop);
	//	ctx.bezierCurveTo(xCenter - controlOffsetX, openCloseTop + controlOffsetY, xCenter + controlOffsetX, openCloseTop + controlOffsetY, xCenter + combinedWidth / 2, openCloseTop);
	//	ctx.bezierCurveTo(xCenter + combinedWidth / 2 - controlOffsetX, (openCloseTop + openCloseBottom) / 2, xCenter + combinedWidth / 2 - controlOffsetX, (openCloseTop + openCloseBottom) / 2, xCenter + combinedWidth / 2, openCloseBottom);
	//	ctx.bezierCurveTo(xCenter + controlOffsetX, openCloseBottom - controlOffsetY, xCenter - controlOffsetX, openCloseBottom - controlOffsetY, xCenter - combinedWidth / 2, openCloseBottom);
	//	ctx.bezierCurveTo(xCenter - candleWidth / 2 + controlOffsetX, (openCloseTop + openCloseBottom) / 2, xCenter - combinedWidth / 2 + controlOffsetX, (openCloseTop + openCloseBottom) / 2, xCenter - combinedWidth / 2, openCloseTop);
	//	ctx.closePath();
	//	ctx.stroke();
	//	ctx.fill();
	//}
	private _drawEllipse(
		ctx: CanvasRenderingContext2D,
		xCenter: number,
		yCenter: number,
		candleWidth: number,
		combinedWidth: number,
		candleHeight: number,
	): void {
		// Calculate x and y radii based on the group size and bar spacing
		const xRadius = combinedWidth/2
		const yRadius = candleHeight / 2;
	
		// Shift xCenter to the right by half the total group width + one candleWidth for HTF candles
		const adjustedXCenter = xCenter-(candleWidth/2) + (combinedWidth/2)
	
		ctx.beginPath();
		ctx.ellipse(
			adjustedXCenter,  // Shifted center only for HTF candles
			yCenter,
			Math.abs(xRadius),
			Math.abs(yRadius),
			0,
			0,
			Math.PI * 2
		);
		ctx.fill();
		ctx.stroke();
	}
	
	
	
	
	private _drawRounded(ctx: CanvasRenderingContext2D, xCenter: number, openCloseTop: number, candleWidth: number, combinedWidth: number, candleHeight: number, radius: number,horizontalPixelRatio:number): void {
		if (ctx.roundRect) {
			const effectiveRadius = Math.abs(Math.min(radius, 0.1 * Math.min(candleWidth, candleHeight), 5))*horizontalPixelRatio;
			ctx.beginPath();
			ctx.roundRect(xCenter - candleWidth / 2, openCloseTop, combinedWidth, candleHeight, effectiveRadius);
			ctx.stroke();
			ctx.fill();
		} else {
			ctx.strokeRect(xCenter - candleWidth / 2, openCloseTop, combinedWidth, candleHeight);
			ctx.fillRect(xCenter - candleWidth / 2, openCloseTop, combinedWidth, candleHeight);
		}
	}
	
	private _draw3d(
		ctx: CanvasRenderingContext2D,
		xCenter: number,
		high: number,
		low: number,
		open: number,
		close: number,
		candleWidth: number,
		combinedWidth: number,
		fillColor: string,
		borderColor: string,
		isUp: boolean,
		barSpacing:number
	): void {
		const xOffset = -Math.max(combinedWidth,1) * (1-barSpacing) ;
		const insideColor = darkenColor(fillColor, 0.666); // Darker side color
		const sideColor = darkenColor(fillColor,0.333)
		const topColor = darkenColor(fillColor, 0.2);  // Slightly lighter top face
	
		// Calculate front face X coordinates using candleWidth
		const frontLeftX = xCenter - candleWidth/2 ;
		const frontRightX = (xCenter-candleWidth/2) + (combinedWidth)+xOffset;
	
		// Calculate back face X coordinates with combined width for depth effect
		const backLeftX = frontLeftX - xOffset;
		const backRightX = frontRightX - xOffset;
	
		// Set Y coordinates for front and back faces based on candle direction
		let frontTop, frontBottom, backTop, backBottom;
	
		if (!isUp) {
			// Up candle: front face uses open/high, back face uses low/close
			frontTop = open;
			frontBottom = high;
			backTop = low;
			backBottom = close;
		} else {
			// Down candle: front face uses open/low, back face uses high/close
			frontTop = open;
			frontBottom = low;
			backTop = high;
			backBottom = close;
		}
	
		// Draw back (shadow) rectangle
		ctx.fillStyle = sideColor;
		ctx.strokeStyle = borderColor;
		//ctx.beginPath();
		//ctx.rect(backLeftX, backTop, (combinedWidth)+xOffset-(candleWidth/2), backBottom - backTop);
		//ctx.fill();
		//ctx.stroke();
	
		// Draw top face between front and back
		ctx.fillStyle = topColor;
		


			if (isUp) {
				// Draw bottom face first for up candles
				ctx.fillStyle = insideColor;
				ctx.beginPath();
				ctx.moveTo(frontLeftX, frontBottom);   // Bottom-left corner at the front
				ctx.lineTo(backLeftX, backBottom);     // Bottom-left corner at the back
				ctx.lineTo(backRightX, backBottom);    // Bottom-right corner at the back
				ctx.lineTo(frontRightX, frontBottom);  // Bottom-right corner at the front
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
		
				// Draw left side face for up candles
				ctx.fillStyle = insideColor;
				ctx.beginPath();
				ctx.moveTo(frontLeftX, frontTop);      // Top-left corner at the front
				ctx.lineTo(backLeftX, backTop);        // Top-left corner at the back
				ctx.lineTo(backLeftX, backBottom);     // Bottom-left corner at the back
				ctx.lineTo(frontLeftX, frontBottom);   // Bottom-left corner at the front
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
		
				// Draw right side face for up candles
				ctx.fillStyle = insideColor;
				ctx.beginPath();
				ctx.moveTo(frontRightX, frontTop);     // Top-right corner at the front
				ctx.lineTo(backRightX, backTop);       // Top-right corner at the back
				ctx.lineTo(backRightX, backBottom);    // Bottom-right corner at the back
				ctx.lineTo(frontRightX, frontBottom);  // Bottom-right corner at the front
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
		
				// Draw top face last for up candles
				ctx.fillStyle = topColor;
				ctx.beginPath();
				ctx.moveTo(frontLeftX, frontTop);      // Top-left corner at the front
				ctx.lineTo(backLeftX, backTop);        // Top-left corner at the back
				ctx.lineTo(backRightX, backTop);       // Top-right corner at the back
				ctx.lineTo(frontRightX, frontTop);     // Top-right corner at the front
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
			} else {
				// Draw top face first for down candles
				ctx.fillStyle = topColor;
				ctx.beginPath();
				ctx.moveTo(frontLeftX, frontTop);      // Top-left corner at the front
				ctx.lineTo(backLeftX, backTop);        // Top-left corner at the back
				ctx.lineTo(backRightX, backTop);       // Top-right corner at the back
				ctx.lineTo(frontRightX, frontTop);     // Top-right corner at the front
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
		
				// Draw right side face for down candles
				ctx.fillStyle = sideColor;
				ctx.beginPath();
				ctx.moveTo(frontRightX, frontTop);     // Top-right corner at the front
				ctx.lineTo(backRightX, backTop);       // Top-right corner at the back
				ctx.lineTo(backRightX, backBottom);    // Bottom-right corner at the back
				ctx.lineTo(frontRightX, frontBottom);  // Bottom-right corner at the front
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
		
				// Draw left side face for down candles
				ctx.fillStyle = sideColor;
				ctx.beginPath();
				ctx.moveTo(frontLeftX, frontTop);      // Top-left corner at the front
				ctx.lineTo(backLeftX, backTop);        // Top-left corner at the back
				ctx.lineTo(backLeftX, backBottom);     // Bottom-left corner at the back
				ctx.lineTo(frontLeftX, frontBottom);   // Bottom-left corner at the front
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
		
				// Draw bottom face last for down candles
				ctx.fillStyle = sideColor;
				ctx.beginPath();
				ctx.moveTo(frontLeftX, frontBottom);   // Bottom-left corner at the front
				ctx.lineTo(backLeftX, backBottom);     // Bottom-left corner at the back
				ctx.lineTo(backRightX, backBottom);    // Bottom-right corner at the back
				ctx.lineTo(frontRightX, frontBottom);  // Bottom-right corner at the front
				ctx.closePath();
				ctx.fill();
				ctx.stroke();
			}
		}
		
	
	
	

		private _drawPolygon(
			ctx: CanvasRenderingContext2D,
			xCenter: number,
			openCloseTop: number,
			openCloseBottom: number,
			candleWidth: number,
			combinedWidth: number,
			high: number,
			low: number,
			isUp: boolean,
			//topColor?: string,
			//bottomColor?: string,
		): void
		  {
			
			ctx.beginPath();
				if (isUp) {
			ctx.moveTo(xCenter - candleWidth / 2, openCloseTop);
			ctx.lineTo(xCenter + combinedWidth - candleWidth/2, high);
			ctx.lineTo(xCenter + combinedWidth - candleWidth/2, openCloseBottom);
			ctx.lineTo(xCenter - candleWidth / 2, low);
				} else {
			ctx.moveTo(xCenter - candleWidth / 2, high);
			ctx.lineTo(xCenter + combinedWidth - candleWidth/2, openCloseTop);
			ctx.lineTo(xCenter + combinedWidth - candleWidth/2, low);
			ctx.lineTo(xCenter - candleWidth / 2, openCloseBottom);
				}
		
			ctx.closePath();
			ctx.stroke();
			ctx.fill();
			//// Draw the top overlay if topColor is provided
			//if (topColor) {
			//	ctx.lineWidth = ctx.lineWidth*1.1
			//	ctx.strokeStyle = setOpacity(topColor, 1);         // Fully opaque border
			//	ctx.fillStyle = topColor;         // Semi-transparent fill
			//	ctx.beginPath();
			//	if (isUp) {
			//		// For up candles, bottom is between openCloseBottom and low
			//		ctx.moveTo(leftSide, openCloseBottom);
			//		ctx.lineTo(rightSide, openCloseBottom);
			//		ctx.lineTo(leftSide, low);
			//		ctx.lineTo(leftSide, openCloseBottom);
//
			//	} else {
			//		// For down candles, bottom is between openCloseBottom and low
			//		ctx.moveTo(leftSide, openCloseBottom);
			//		ctx.lineTo(rightSide, openCloseBottom);
			//		ctx.lineTo(rightSide, low);
			//		ctx.lineTo(leftSide, openCloseBottom);
//
			//	}
			//	
			//	ctx.closePath();
			//	ctx.fill();
			//	ctx.stroke();
			//}
//
			//// Draw the bottom overlay if bottomColor is provided
			//if (bottomColor) {
			//	ctx.lineWidth = ctx.lineWidth*1.1
//
			//	ctx.strokeStyle = setOpacity(bottomColor, 1);      // Fully opaque border
			//	ctx.fillStyle = bottomColor;      // Semi-transparent fill
			//	ctx.beginPath();
			//	if (isUp) {
			//		// For up candles, top is between openCloseTop and high
			//		ctx.moveTo(leftSide, openCloseTop);
			//		ctx.lineTo(rightSide, high);
			//		ctx.lineTo(rightSide, openCloseTop);
			//		ctx.lineTo(leftSide, openCloseTop);
//
			//	} else {
			//		// For down candles, top is between high and openCloseTop
			//		ctx.moveTo(leftSide, high);
			//		ctx.lineTo(rightSide, openCloseTop);
			//		ctx.lineTo(leftSide, openCloseTop);
			//		ctx.lineTo(leftSide, high);
//
			//	}
			//	ctx.closePath();
			//	ctx.fill();
			//	ctx.stroke();
			//
			}
		
	
	
		private _drawArrow(ctx: CanvasRenderingContext2D, xCenter: number,
			 openCloseTopY: number, openCloseBottomY: number, candleBodyWidth: number,combinedBodyWidth:number,
			  highY: number, lowY: number, isUp: boolean): void {
			ctx.beginPath();

			const left = xCenter - candleBodyWidth / 2
			const right = left + combinedBodyWidth 
			const middle = left + combinedBodyWidth/2
			if (isUp) {
				ctx.moveTo(left, lowY);
				ctx.lineTo(left, openCloseTopY);
				ctx.lineTo(middle, highY);
				ctx.lineTo(right, openCloseTopY);
				ctx.lineTo(right, lowY);
				ctx.lineTo(middle, openCloseBottomY);
				ctx.lineTo(left, lowY);

			} else {
				ctx.moveTo(left, highY);
				ctx.lineTo(left, openCloseBottomY);
				ctx.lineTo(middle, lowY);
				ctx.lineTo(right, openCloseBottomY);
				ctx.lineTo(right, highY);
				ctx.lineTo(middle, openCloseTopY);
				ctx.lineTo(left, highY);

			}
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
		}
	}
	
