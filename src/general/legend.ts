import { ISeriesApi, LineData, Logical, MouseEventParams, PriceFormatBuiltIn, SeriesType } from "lightweight-charts";
import { Handler } from "./handler";

// Interfaces for the legend elements
interface LineElement {
    name: string;
    div: HTMLDivElement;
    row: HTMLDivElement;
    toggle: HTMLDivElement;
    series: ISeriesApi<SeriesType>;
    solid: string;
}

interface LegendGroup {
    name: string;
    seriesList: ISeriesApi<SeriesType>[];
    div: HTMLDivElement;
    row: HTMLDivElement;
    toggle: HTMLDivElement;
    solidColors: string[];
    names: string[];
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

    makeSeriesRow(name: string, series: ISeriesApi<SeriesType>): HTMLDivElement {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
    
        const div = document.createElement('div');
        div.innerText = name;
    
        const toggle = document.createElement('div');
        toggle.classList.add('legend-toggle-switch');
    
        const color = (series.options() as any).color || 'rgba(255,0,0,1)'; // Use a default color
        const solidColor = color.startsWith('rgba') ? color.replace(/[^,]+(?=\))/, '1') : color;
    
        const onIcon = this.createSvgIcon(openEye);
        const offIcon = this.createSvgIcon(closedEye);
        toggle.appendChild(onIcon.cloneNode(true)); // Clone nodes to avoid duplication

        let visible = true;
        toggle.addEventListener('click', () => {
            visible = !visible;
            series.applyOptions({ visible });
            toggle.innerHTML = ''; // Clear current icon
            toggle.appendChild(visible ? onIcon.cloneNode(true) : offIcon.cloneNode(true));
        });
    
        row.appendChild(div);
        row.appendChild(toggle);
    
        this._lines.push({
            name,
            div,
            row,
            toggle,
            series,
            solid: solidColor,
        });
        this.seriesContainer.appendChild(row);

        return row;
    }
    makeSeriesGroup(groupName: string, names: string[], seriesList: ISeriesApi<SeriesType>[], solidColors: string[]) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
    
        const div = document.createElement('div');
        div.style.color = '#FFF'; // Keep group name text in white
        div.innerText = `${groupName}:`;
    
        const toggle = document.createElement('div');
        toggle.classList.add('legend-toggle-switch');
    
        const onIcon = this.createSvgIcon(openEye);
        const offIcon = this.createSvgIcon(closedEye);
        toggle.appendChild(onIcon.cloneNode(true));  // Default to visible
    
        let visible = true;
        toggle.addEventListener('click', () => {
            visible = !visible;
            seriesList.forEach(series => series.applyOptions({ visible }));
            toggle.innerHTML = '';  // Clear toggle before appending new icon
            toggle.appendChild(visible ? onIcon.cloneNode(true) : offIcon.cloneNode(true));
        });
    
        // Build the legend text with only colored squares and regular-weight line names
        let legendText = `<span style="font-size: 1em; color: #FFF;">${groupName}:</span>`;
        names.forEach((name, index) => {
            const color = solidColors[index];
            legendText += ` <span style="color: ${color};">▨</span> <span style="color: white; font-size: 1em; font-weight: normal;">${name}: -</span>`;
        });
    
        div.innerHTML = legendText; // Set HTML content to maintain colored squares and regular font for line names
    
        this._groups.push({
            name: groupName,
            seriesList,
            div,
            row,
            toggle,
            solidColors,
            names,
        });
    
        row.appendChild(div);
        row.appendChild(toggle);
        this.seriesContainer.appendChild(row);
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

            let legendText = `<span style="font-weight: bold;">${group.name}:</span>`;
            group.seriesList.forEach((series, index) => {
                const data = usingPoint && logical
                    ? series.dataByIndex(logical) as LineData
                    : param.seriesData.get(series) as LineData;

                if (!data?.value) return;

                const priceFormat = series.options().priceFormat;
                const price = 'precision' in priceFormat
                    ? this.legendItemFormat(data.value, (priceFormat as PriceFormatBuiltIn).precision)
                    : this.legendItemFormat(data.value, 2); // Default precision
            
                const color = group.solidColors ? group.solidColors[index] : 'inherit';
                const name = group.names[index];
            
                // Include `price` in legendText
                legendText += ` <span style="color: ${color};">▦</span> <span style="color: white;">${name}: ${price}</span>`;
            });

            group.div.innerHTML = legendText;
        });
    }
    private updateSeriesLegend(param: MouseEventParams, logical: Logical | null, usingPoint: boolean) {
        this._lines.forEach((line) => {
            if (!this.linesEnabled) {
                line.row.style.display = 'none';
                return;
            }
            line.row.style.display = 'flex';

            const data = usingPoint && logical
                ? line.series.dataByIndex(logical) as LineData
                : param.seriesData.get(line.series) as LineData;

            if (data?.value !== undefined) {
                const priceFormat = line.series.options().priceFormat as PriceFormatBuiltIn;
                const price = 'precision' in priceFormat
                    ? this.legendItemFormat(data.value, priceFormat.precision)
                    : this.legendItemFormat(data.value, 2);

                line.div.innerHTML = `<span style="color: ${line.solid};">▨</span> ${line.name}: ${price}`;
            } else {
                line.div.innerHTML = `${line.name}: -`;
            }
        });
    }
}
