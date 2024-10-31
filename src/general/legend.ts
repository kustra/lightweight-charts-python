import {AreaData, BarData, HistogramData, ISeriesApi, LineData, Logical, MouseEventParams, PriceFormatBuiltIn, PriceFormat, SeriesType } from "lightweight-charts";
import { Handler } from "./handler";

// Interfaces for the legend elements
interface LineElement {
    name: string;
    div: HTMLDivElement;
    row: HTMLDivElement;
    toggle: HTMLDivElement;
    series: ISeriesApi<SeriesType>;
    solid: string;
    legendSymbol: string; // Add legend symbol for individual series
}

// Interface for a group of series in the legend
interface LegendGroup {
    name: string;
    seriesList: ISeriesApi<SeriesType>[];
    div: HTMLDivElement;
    row: HTMLDivElement;
    toggle: HTMLDivElement;
    solidColors: string[];
    names: string[];
    legendSymbols: string[]; // Add array of legend symbols for grouped series
}
// Define the SVG path data
const openEye = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="16" viewBox="0 0 24 24">
    <path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:#FFF;stroke-opacity:1;stroke-miterlimit:4;" 
          d="M 21.998437 12 C 21.998437 12 18.998437 18 12 18 
             C 5.001562 18 2.001562 12 2.001562 12 
             C 2.001562 12 5.001562 6 12 6 
             C 18.998437 6 21.998437 12 21.998437 12 Z" />
    <path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:#FFF;stroke-opacity:1;stroke-miterlimit:4;" 
          d="M 15 12 
             C 15 13.654687 13.654687 15 12 15 
             C 10.345312 15 9 13.654687 9 12 
             C 9 10.345312 10.345312 9 12 9 
             C 13.654687 9 15 10.345312 15 12 Z" />
</svg>
`;

const closedEye = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="16" viewBox="0 0 24 24">
    <path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:#FFF;stroke-opacity:1;stroke-miterlimit:4;" 
          d="M 3 3 L 21 21" />
    <path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:#FFF;stroke-opacity:1;stroke-miterlimit:4;" 
          d="M 21.998437 12 
             C 21.998437 12 18.998437 18 12 18 
             C 5.001562 18 2.001562 12 2.001562 12 
             C 2.001562 12 5.001562 6 12 6 
             C 14.211 6 16.106 6.897 17.7 8.1" />
    <path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:#FFF;stroke-opacity:1;stroke-miterlimit:4;" 
          d="M 9.9 9.9 
             C 9.367 10.434 9 11.178 9 12 
             C 9 13.654687 10.345312 15 12 15 
             C 12.822 15 13.566 14.633 14.1 14.1" />
</svg>
`;
export class Legend {
    private handler: Handler;
    public div: HTMLDivElement;
    public seriesContainer: HTMLDivElement;

    private ohlcEnabled: boolean = false;
    private percentEnabled: boolean = false;
    private linesEnabled: boolean = false;
    private colorBasedOnCandle: boolean = false;

    private text: HTMLSpanElement;
    private candle: HTMLDivElement;
    public _lines: LineElement[] = [];
    public _groups: LegendGroup[] = [];

    constructor(handler: Handler) {
        this.handler = handler;
        this.div = document.createElement('div');
        this.div.classList.add("legend");
        this.seriesContainer = document.createElement("div");
        this.text = document.createElement('span');
        this.candle = document.createElement('div');
        
        this.setupLegend();
        this.legendHandler = this.legendHandler.bind(this);
        handler.chart.subscribeCrosshairMove(this.legendHandler);
    }

    private setupLegend() {
        this.div.style.maxWidth = `${(this.handler.scale.width * 100) - 8}vw`;
        this.div.style.display = 'none';

        const seriesWrapper = document.createElement('div');
        seriesWrapper.style.display = 'flex';
        seriesWrapper.style.flexDirection = 'row';

        this.seriesContainer.classList.add("series-container");
        this.text.style.lineHeight = '1.8';

        seriesWrapper.appendChild(this.seriesContainer);
        this.div.appendChild(this.text);
        this.div.appendChild(this.candle);
        this.div.appendChild(seriesWrapper);
        this.handler.div.appendChild(this.div);
    }

    legendItemFormat(num: number, decimal: number) {
        return num.toFixed(decimal).toString().padStart(8, ' ');
    }

    shorthandFormat(num: number) {
        const absNum = Math.abs(num);
        return absNum >= 1000000 ? (num / 1000000).toFixed(1) + 'M' :
               absNum >= 1000 ? (num / 1000).toFixed(1) + 'K' :
               num.toString().padStart(8, ' ');
    }
    makeSeriesRow(
        name: string,
        series: ISeriesApi<SeriesType>,
        legendSymbol: string[] = ['▨'],
        colors: string[]
    ): HTMLDivElement {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
    
        const div = document.createElement('div');
        // Iterate over colors and symbols for multi-color support
        div.innerHTML = legendSymbol
            .map((symbol, index) => `<span style="color: ${colors[index] || colors[0]};">${symbol}</span>`)
            .join(' ') + ` ${name}`;
    
        const toggle = document.createElement('div');
        toggle.classList.add('legend-toggle-switch');
    
        const onIcon = this.createSvgIcon(openEye);
        const offIcon = this.createSvgIcon(closedEye);
        toggle.appendChild(onIcon.cloneNode(true));
    
        let visible = true;
        toggle.addEventListener('click', () => {
            visible = !visible;
            series.applyOptions({ visible });
            toggle.innerHTML = '';
            toggle.appendChild(visible ? onIcon.cloneNode(true) : offIcon.cloneNode(true));
        });
    
        row.appendChild(div);
        row.appendChild(toggle);
        this.seriesContainer.appendChild(row);
    
        // Push the row and related information to the `_lines` array
        this._lines.push({
            name,
            div,
            row,
            toggle,
            series,
            solid: colors[0],  // Assume the first color is the main color for the series
            legendSymbol: legendSymbol[0],  // Store the primary legend symbol
        });
    
        return row;
    }
    
    makeSeriesGroup(
        groupName: string,
        names: string[],
        seriesList: ISeriesApi<SeriesType>[],
        colors: string[],
        legendSymbols: string[]
    ): HTMLDivElement {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
    
        const div = document.createElement('div');
        div.innerHTML = `<span style="font-weight: bold;">${groupName}:</span>`;
    
        const toggle = document.createElement('div');
        toggle.classList.add('legend-toggle-switch');
    
        const onIcon = this.createSvgIcon(openEye);
        const offIcon = this.createSvgIcon(closedEye);
        toggle.appendChild(onIcon.cloneNode(true)); // Default to visible
    
        let visible = true;
        toggle.addEventListener('click', () => {
            visible = !visible;
            seriesList.forEach(series => series.applyOptions({ visible }));
            toggle.innerHTML = ''; // Clear toggle before appending new icon
            toggle.appendChild(visible ? onIcon.cloneNode(true) : offIcon.cloneNode(true));
        });
    
        // Build the legend content for each series in the group
        let colorIndex = 0;  // Separate index for colors and symbols to account for bar pairs
        names.forEach((name, index) => {
        const series = seriesList[index];
        const isBarSeries = series && series.seriesType() === 'Bar';
    
            if (isBarSeries) {
                // Use current color index for the up symbol/color, then increment to down symbol/color
                const upSymbol = legendSymbols[colorIndex] || '▨';
                const downSymbol = legendSymbols[colorIndex + 1] || '▨';
                const upColor = colors[colorIndex];
                const downColor = colors[colorIndex + 1];
    
                // Dual symbol and color formatting for bar series
                div.innerHTML += `
                    <span style="color: ${upColor};">${upSymbol}</span>
                    <span style="color: ${downColor};">${downSymbol}</span>
                    <span style="color: white; font-weight: normal;">${name}: -</span>
                `;
    
                // Increment color index by 2 for bar series (to account for up/down pair)
                colorIndex += 2;
            } else {
                // Single symbol and color for non-bar series
                const singleSymbol = legendSymbols[colorIndex] || '▨';
                const singleColor = colors[colorIndex];
    
                div.innerHTML += `
                    <span style="color: ${singleColor};">${singleSymbol}</span>
                    <span style="font-weight: normal;">${name}: -</span>
                `;
    
                // Increment color index by 1 for non-bar series
                colorIndex += 1;
            }
        });
    
        // Add div and toggle to row
        row.appendChild(div);
        row.appendChild(toggle);
    
        // Append row to the series container
        this.seriesContainer.appendChild(row);
    
        // Store group data
        this._groups.push({
            name: groupName,
            seriesList,
            div,
            row,
            toggle,
            solidColors: colors,
            names,
            legendSymbols,
        });
    
        return row;
    }
    
    

    private createSvgIcon(svgContent: string): SVGElement {
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = svgContent.trim();
        const svgElement = tempContainer.querySelector('svg');
        return svgElement as SVGElement;
    }

    legendHandler(param: MouseEventParams, usingPoint = false) {
        if (!this.ohlcEnabled && !this.linesEnabled && !this.percentEnabled) return;

        const options: any = this.handler.series.options();
        if (!param.time) {
            this.candle.style.color = 'transparent';
            this.candle.innerHTML = this.candle.innerHTML.replace(options['upColor'], '').replace(options['downColor'], '');
            return;
        }

        let data: any;
        let logical: Logical | null = null;

        if (usingPoint) {
            const timeScale = this.handler.chart.timeScale();
            const coordinate = timeScale.timeToCoordinate(param.time);
            if (coordinate) logical = timeScale.coordinateToLogical(coordinate.valueOf());
            if (logical) data = this.handler.series.dataByIndex(logical.valueOf());
        } else {
            data = param.seriesData.get(this.handler.series);
        }

        let str = '<span style="line-height: 1.8;">';
        if (data) {
            // OHLC Data
            if (this.ohlcEnabled) {
                str += `O ${this.legendItemFormat(data.open, this.handler.precision)} `;
                str += `| H ${this.legendItemFormat(data.high, this.handler.precision)} `;
                str += `| L ${this.legendItemFormat(data.low, this.handler.precision)} `;
                str += `| C ${this.legendItemFormat(data.close, this.handler.precision)} `;
            }

            // Percentage Movement
            if (this.percentEnabled) {
                const percentMove = ((data.close - data.open) / data.open) * 100;
                const color = percentMove > 0 ? options['upColor'] : options['downColor'];
                const percentStr = `${percentMove >= 0 ? '+' : ''}${percentMove.toFixed(2)} %`;
                str += this.colorBasedOnCandle ? `| <span style="color: ${color};">${percentStr}</span>` : `| ${percentStr}`;
            }
        }
        this.candle.innerHTML = str + '</span>';

        this.updateGroupLegend(param, logical, usingPoint);
        this.updateSeriesLegend(param, logical, usingPoint);
    }
    
    private updateGroupLegend(param: MouseEventParams, logical: Logical | null, usingPoint: boolean) {
        this._groups.forEach((group) => {
            if (!this.linesEnabled) {
                group.row.style.display = 'none';
                return;
            }
            group.row.style.display = 'flex';
    
            // Start building the legend text with the group name
            let legendText = `<span style="font-weight: bold;">${group.name}:</span>`;
    
            // Track color index for bar-specific colors and symbols
            let colorIndex = 0;
    
            // Iterate over each series in the group
            group.seriesList.forEach((series, idx) => {
                const seriesType = series.seriesType();
                let data;
    
                // Get data based on the current logical point or series data
                if (usingPoint && logical) {
                    data = series.dataByIndex(logical);
                } else {
                    data = param.seriesData.get(series);
                }
    
                if (!data) return;  // Skip if no data is available for this series
    
                // Retrieve price format for precision
                const priceFormat = series.options().priceFormat as PriceFormatBuiltIn;
                const name = group.names[idx];
    
                if (seriesType === 'Bar') {
                    // Handle Bar series with open and close values and separate up/down symbols and colors
                    const barData = data as BarData;
                    const openPrice = this.legendItemFormat(barData.open, priceFormat.precision);
                    const closePrice = this.legendItemFormat(barData.close, priceFormat.precision);
    
                    const upSymbol = group.legendSymbols[colorIndex] || '▨';
                    const downSymbol = group.legendSymbols[colorIndex + 1] || '▨';
                    const upColor = group.solidColors[colorIndex];
                    const downColor = group.solidColors[colorIndex + 1];
    
                    // Append Bar series info with open and close prices, and separate symbols/colors
                    legendText += `
                        <span style="color: ${upColor};">${upSymbol}</span>
                        <span style="color: ${downColor};">${downSymbol}</span>
                        <span>${name}: O ${openPrice}, C ${closePrice}</span>
                    `;
                    
                    colorIndex += 2;  // Increment color index by 2 for Bar series
                } else {
                    // Handle other series types that use a single `value`
                    const otherData = data as LineData | AreaData | HistogramData;
                    const price = this.legendItemFormat(otherData.value, priceFormat.precision);
    
                    const symbol = group.legendSymbols[colorIndex] || '▨';
                    const color = group.solidColors[colorIndex];
    
                    // Append non-Bar series info with single symbol and color
                    legendText += `
                    <span style="color: ${color};">${symbol}</span>
                    <span>${name}: ${price}</span>
                    `;
                    colorIndex += 1;  // Increment color index by 1 for non-Bar series
                }
            });
    
            // Update the group legend div with the constructed legend text
            group.div.innerHTML = legendText;
        });
    }
    private updateSeriesLegend(param: MouseEventParams, logical: Logical | null, usingPoint: boolean) {
        if (!this._lines || !this._lines.length) {
            console.error("No lines available to update legend.");
            return;
        }
    
        this._lines.forEach((e) => {
            // Check if the line row should be displayed
            if (!this.linesEnabled) {
                e.row.style.display = 'none';
                return;
            }
            e.row.style.display = 'flex';
        
            // Determine series type and get the appropriate data
            const seriesType = e.series.seriesType();
            let data;
        
            if (usingPoint && logical) {
                data = e.series.dataByIndex(logical);
            } else {
                data = param.seriesData.get(e.series);
            }
        
            // If no data is available, show a placeholder and continue
            if (!data) {
                e.div.innerHTML = `${e.name}: -`;
                return;
            }
        
            const priceFormat = e.series.options().priceFormat as PriceFormatBuiltIn;
            let legendContent: string;
            console.log(`Series: ${e.name}, Type: ${seriesType}, Data:`, data);

            if (seriesType === 'Bar') {
                // Handle Bar series with open and close values
                const barData = data as BarData;
                const openPrice = this.legendItemFormat(barData.open, priceFormat.precision);
                const closePrice = this.legendItemFormat(barData.close, priceFormat.precision);
        
                // Use specific symbols and colors for Bar series open/close display
                const upSymbol = e.legendSymbol[0] || '▨';
                const downSymbol = e.legendSymbol[1] || '▨';
                const upColor = e.solid[0];
                const downColor = e.solid[1];
        
                legendContent = `
                    <span style="color: ${upColor};">${upSymbol}</span>
                    <span style="color: ${downColor};">${downSymbol}</span>
                    ${e.name}: O ${openPrice}, C ${closePrice}
                `;
            } else if (seriesType === 'Histogram') {
                // Handle Histogram with shorthand format
                const histogramData = data as HistogramData;
                const price = this.shorthandFormat(histogramData.value);
        
                legendContent = `<span style="color: ${e.solid};">${e.legendSymbol || '▨'}</span> ${e.name}: ${price}`;
            } else {
                // Handle Line, Area, and other series types with a single value
                const otherData = data as LineData | AreaData;
                const price = this.legendItemFormat(otherData.value, priceFormat.precision);
        
                legendContent = `<span style="color: ${e.solid};">${e.legendSymbol || '▨'}</span> ${e.name}: ${price}`;
            }
        
            // Update the legend row content
            e.div.innerHTML = legendContent;
        });
    }}
    
