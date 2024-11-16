import {AreaData, BarData, HistogramData, ISeriesApi, LineData, Logical, MouseEventParams, PriceFormatBuiltIn, SeriesType } from "lightweight-charts";
import { ohlcSeriesData } from "../ohlc-series/ohlc-series";
import { Handler } from "./handler";
import { LegendItem } from "./global-params";
type LegendEntry = LegendSeries | LegendGroup;



interface LegendGroup {
    name: string;
    seriesList: LegendItem[];  // Each `LegendItem` contains `colors`, `legendSymbol`, and `seriesType`
    div: HTMLDivElement;
    row: HTMLDivElement;
    toggle: HTMLDivElement;
}

interface LegendSeries extends LegendItem {
    div: HTMLDivElement;
    row: HTMLDivElement;
    toggle: HTMLDivElement;
}
const lastSeriesDataCache = new Map<ISeriesApi<SeriesType>, any>();
const lastGroupDataCache = new Map<string, any[]>();


function getLastData(series: ISeriesApi<SeriesType>) {
    return lastSeriesDataCache.get(series) || null;
}


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
    private _items: LegendEntry[] = [];
    public _lines: LegendSeries[] = [];
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
    legendItemFormat(num: number | undefined, decimal: number): string {
        if (typeof num !== 'number' || isNaN(num)) {
            return '-';  // Default display when data is missing
        }
        return num.toFixed(decimal).toString().padStart(8, ' ');
    }
    

    shorthandFormat(num: number) {
        const absNum = Math.abs(num);
        return absNum >= 1000000 ? (num / 1000000).toFixed(1) + 'M' :
               absNum >= 1000 ? (num / 1000).toFixed(1) + 'K' :
               num.toString().padStart(8, ' ');
    }
    makeSeriesRow(line: LegendItem): HTMLDivElement {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
    
        const div = document.createElement('div');
        const displayOCvalues = ['Bar', 'ohlc'].includes(line.seriesType || '');
    
        if (displayOCvalues) {
            const openPrice = '-';
            const closePrice = '-';
    
            const upSymbol = line.legendSymbol[0] || '▨';
            const downSymbol = line.legendSymbol[1] || upSymbol;
            const upColor = line.colors[0] || '#00FF00';
            const downColor = line.colors[1] || '#FF0000';
    
            div.innerHTML = `
                <span style="color: ${upColor};">${upSymbol}</span>
                <span style="color: ${downColor};">${downSymbol}</span>
                ${line.name}: <span style="color: ${downColor};">O ${openPrice}</span>, 
                <span style="color: ${upColor};">C ${closePrice}</span>
            `;
        } else {
            div.innerHTML = line.legendSymbol
                .map((symbol, index) => `<span style="color: ${line.colors[index] || line.colors[0]};">${symbol}</span>`)
                .join(' ') + ` ${line.name}`;
        }
    
        // Toggle visibility icon
        const toggle = document.createElement('div');
        toggle.classList.add('legend-toggle-switch');
    
        const onIcon = this.createSvgIcon(openEye);
        const offIcon = this.createSvgIcon(closedEye);
        toggle.appendChild(onIcon.cloneNode(true));
    
        let visible = true;
        toggle.addEventListener('click', () => {
            visible = !visible;
            line.series.applyOptions({ visible });
            toggle.innerHTML = '';
            toggle.appendChild(visible ? onIcon.cloneNode(true) : offIcon.cloneNode(true));
        });
    
        row.appendChild(div);
        row.appendChild(toggle);
        this.seriesContainer.appendChild(row);
    
        // Add row, div, and toggle to line (LegendItem)
        const legendSeries: LegendSeries = {
            ...line,
            div,
            row,
            toggle,
        };
    
        this._lines.push(legendSeries);
    
        return row;
    }
    
    addLegendItem(item: LegendItem): HTMLDivElement {
        let entry: LegendEntry;
    
        if (item.group) {
            // Check if the group already exists
            let group = this._groups.find(g => g.name === item.group);
            if (group) {
                // Add the item to the existing group
                group.seriesList.push(item);
                this._items.push(item as LegendSeries);

                // Update the group's div content
                entry = group;
                return group.row;
            } else {
                // Create a new group with the item
                const groupRow = this.makeSeriesGroup(item.group, [item]);
                entry = this._groups[this._groups.length - 1]; // Get the newly added group
                return groupRow;
            }
        } else {
            // Add as an individual series
            const seriesRow = this.makeSeriesRow(item);
            entry = this._lines[this._lines.length - 1]; // Get the newly added series
            this._items.push(item as LegendSeries);

            return seriesRow;
        }
    
        // Add the entry to _items
        this._items.push(entry);
    }
    deleteLegendEntry(seriesName?: string, groupName?: string): void {
        if (groupName && !seriesName) {
            // Remove entire group
            const groupIndex = this._groups.findIndex(group => group.name === groupName);
            if (groupIndex !== -1) {
                const legendGroup = this._groups[groupIndex];
    
                // Remove the group's DOM elements
                this.seriesContainer.removeChild(legendGroup.row);
    
                // Optionally, remove all series in the group from the chart
                // legendGroup.seriesList.forEach(item => item.series.remove());
    
                // Remove from the _groups array
                this._groups.splice(groupIndex, 1);
    
                // Also remove from _items array
                this._items = this._items.filter(entry => entry !== legendGroup);
    
                //console.log(`Group "${groupName}" removed.`);
            } else {
                console.warn(`Legend group with name "${groupName}" not found.`);
            }
        } else if (seriesName) {
            // Remove individual series
            let removed = false;
    
            if (groupName) {
                // Remove from specific group
                const group = this._groups.find(g => g.name === groupName);
                if (group) {
                    const itemIndex = group.seriesList.findIndex(item => item.name === seriesName);
                    if (itemIndex !== -1) {
                        const seriesItem = group.seriesList[itemIndex];
    
                        // Remove from the group's seriesList
                        group.seriesList.splice(itemIndex, 1);
    
                        // Update the group's legend content
    
                        // If the group is now empty, remove it
                        if (group.seriesList.length === 0) {
                            this.seriesContainer.removeChild(group.row);
                            this._groups = this._groups.filter(g => g !== group);
                            this._items = this._items.filter(entry => entry !== group);
                            console.log(`Group "${groupName}" is empty and has been removed.`);
                        }
    
                        // Optionally, remove the series from the chart
                        // seriesItem.series.remove();
    
                        removed = true;
                        console.log(`Series "${seriesName}" removed from group "${groupName}".`);
                    }
                } else {
                    console.warn(`Legend group with name "${groupName}" not found.`);
                }
            }
    
            if (!removed) {
                // Remove from _lines (individual legend items)
                const seriesIndex = this._lines.findIndex(series => series.name === seriesName);
                if (seriesIndex !== -1) {
                    const legendSeries = this._lines[seriesIndex];
    
                    // Remove the DOM elements
                    this.seriesContainer.removeChild(legendSeries.row);
    
                    // Remove from the _lines array
                    this._lines.splice(seriesIndex, 1);
    
                    // Also remove from _items array
                    this._items = this._items.filter(entry => entry !== legendSeries);
    
                    // Optionally, remove the series from the chart
                    // legendSeries.series.remove();
    
                    removed = true;
                    console.log(`Series "${seriesName}" removed.`);
                }
            }
    
            if (!removed) {
                console.warn(`Legend item with name "${seriesName}" not found.`);
            }
        } else {
            console.warn(`No seriesName or groupName provided for deletion.`);
        }
    }
    
    makeSeriesGroup(groupName: string, items: LegendItem[]): HTMLDivElement {
        // Check if the group already exists
        let group = this._groups.find(g => g.name === groupName);

        if (group) {
            // Add items to the existing group
            group.seriesList.push(...items);
            return group.row;
        } else {
            // Create a new group
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';

            const div = document.createElement('div');
            div.innerHTML = `<span style="font-weight: bold;">${groupName}:</span>`;

            const toggle = document.createElement('div');
            toggle.classList.add('legend-toggle-switch');
            const onIcon = this.createSvgIcon(openEye);
            const offIcon = this.createSvgIcon(closedEye);
            toggle.appendChild(onIcon.cloneNode(true));

            let visible = true;
            toggle.addEventListener('click', () => {
                visible = !visible;
                items.forEach(item => item.series.applyOptions({ visible }));
                toggle.innerHTML = '';
                toggle.appendChild(visible ? onIcon.cloneNode(true) : offIcon.cloneNode(true));
            });

            items.forEach(item => {
                
                const displayOCvalues = item.seriesType === 'Bar' || item.seriesType === 'ohlc';

                if (displayOCvalues) {
                    const [upSymbol, downSymbol] = item.legendSymbol;
                    const [upColor, downColor] = item.colors;
                    // Dummy values (to be updated dynamically in the legend handler)
                    const openPrice = '-';
                    const closePrice = '-';
                    div.innerHTML += `
                    <span style="color: ${upColor};">${upSymbol}</span>
                    <span style="color: ${downColor};">${downSymbol}</span>
                    <span>${name}: 
                        <span style="color: ${downColor};">O ${openPrice}</span>, 
                        <span style="color: ${upColor};">C ${closePrice}</span>
                    </span>
                `;
                } else {
                    const color = item.colors[0] || '#000';
                    const symbol = item.legendSymbol[0] || '▨';
                    const price = '-'; // Dummy price
    
                    div.innerHTML += `
                    <span style="color: ${color};">${symbol}</span>
                    <span>${name}: ${price}</span>
                `;                }
            });

            row.appendChild(div);
            row.appendChild(toggle);
            this.seriesContainer.appendChild(row);

            // Add the new group to `_groups`
            const newGroup: LegendGroup = {
                name: groupName,
                seriesList: items,
                div,
                row,
                toggle
            };
            this._groups.push(newGroup);

            return row;
        }
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
    
        // Update the main candle legend content
        let str = '<span style="line-height: 1.8;">';
        if (data) {
            if (this.ohlcEnabled) {
                str += `O ${this.legendItemFormat(data.open, this.handler.precision)} `;
                str += `| H ${this.legendItemFormat(data.high, this.handler.precision)} `;
                str += `| L ${this.legendItemFormat(data.low, this.handler.precision)} `;
                str += `| C ${this.legendItemFormat(data.close, this.handler.precision)} `;
            }
    
            // Display percentage move if enabled
            if (this.percentEnabled) {
                const percentMove = ((data.close - data.open) / data.open) * 100;
                const color = percentMove > 0 ? options['upColor'] : options['downColor'];
                const percentStr = `${percentMove >= 0 ? '+' : ''}${percentMove.toFixed(2)} %`;
                str += this.colorBasedOnCandle ? `| <span style="color: ${color};">${percentStr}</span>` : `| ${percentStr}`;
            }
        }
    
        this.candle.innerHTML = str + '</span>';
    
        // Update group legend and series legend
        this.updateGroupDisplay(param, logical, usingPoint);
        this.updateSeriesDisplay(param, logical, usingPoint);
    }
    
    private updateGroupDisplay(param: MouseEventParams, logical: Logical | null, usingPoint: boolean) {
        this._groups.forEach((group) => {
            if (!this.linesEnabled) {
                group.row.style.display = 'none';
                return;
            }
            group.row.style.display = 'flex';
    
            let legendText = `<span style="font-weight: bold;">${group.name}:</span> `;
    
            group.seriesList.forEach((seriesItem) => {
                const data = param.seriesData.get(seriesItem.series) || getLastData(seriesItem.series);
                if (!data) return;

                const seriesType = seriesItem.seriesType || 'Line';
                const name = seriesItem.name;
                const priceFormat = seriesItem.series.options().priceFormat as PriceFormatBuiltIn;

                // Check if the series type supports OHLC values
                const isOHLC = seriesType === 'Bar' || seriesType === 'ohlc' || seriesType === 'htfCandle';
                if (isOHLC) {
                                // Ensure properties are available or skip
                    const { open, close, high, low } = data;
                    if (open == null || close == null || high == null || low == null) return;
    
                    //const { open, close } = data as ohlcSeriesData || {};
                    if (open == null || close == null) {
                        legendText += `${name}: - `;
                        return;
                    }
    
                    const openPrice = this.legendItemFormat(open, priceFormat.precision);
                    const closePrice = this.legendItemFormat(close, priceFormat.precision);
                    const isUp = close > open;
                    const color = isUp ? seriesItem.colors[0] : seriesItem.colors[1];
                    const symbol = isUp ? seriesItem.legendSymbol[0] : seriesItem.legendSymbol[1];
    
                    legendText += `
                        <span style="color: ${color};">${symbol || '▨'}</span>
                        <span>${name}: 
                            <span style="color: ${color};">O ${openPrice}</span>, 
                            <span style="color: ${color};">C ${closePrice}</span>
                        </span> `;
                } else {
                    // Handle series types with a single 'value' property
                    const valueData = data as LineData | AreaData | HistogramData || {};
                    const value = valueData.value;
                    if (value == null) {
                        legendText += `${name}: - `;
                        return;
                    }
    
                    const priceFormat = seriesItem.series.options().priceFormat as PriceFormatBuiltIn;
                    const formattedValue = this.legendItemFormat(value, priceFormat.precision);
                    const color = seriesItem.colors[0];
                    const symbol = seriesItem.legendSymbol[0] || '▨';
    
                    legendText += `
                        <span style="color: ${color};">${symbol}</span>
                        <span>${name}: ${formattedValue}</span> `;
                }
            });
    
            // Update the group's div content
            group.div.innerHTML = legendText;
        });
    }
    private updateSeriesDisplay(param: MouseEventParams, logical: Logical | null, usingPoint: boolean) {
        if (!this._lines || !this._lines.length) {
            console.error("No lines available to update legend.");
            return;
        }
    
        this._lines.forEach((e) => {
            if (!this.linesEnabled) {
                e.row.style.display = 'none';
                return;
            }
            e.row.style.display = 'flex';
    
            const data = param.seriesData.get(e.series) || getLastData(e.series);
            if (!data) {
                e.div.innerHTML = `${e.name}: -`;
                return;
            }
    
            const seriesType = e.seriesType || 'Line';
    
            // Check if the series type supports OHLC values
            const isOHLC = ['Bar', 'ohlc', 'htfCandle'].includes(seriesType);
    
            if (isOHLC) {
                const { open, close } = data as ohlcSeriesData;
                if (open == null || close == null) {
                    e.div.innerHTML = `${e.name}: -`;
                    return;
                }
    
                const priceFormat = e.series.options().priceFormat as PriceFormatBuiltIn;
                const openPrice = this.legendItemFormat(open, priceFormat.precision);
                const closePrice = this.legendItemFormat(close, priceFormat.precision);
                const isUp = close > open;
                const color = isUp ? e.colors[0] : e.colors[1];
                const symbol = isUp ? e.legendSymbol[0] : e.legendSymbol[1];
    
                e.div.innerHTML = `
                    <span style="color: ${color};">${symbol || '▨'}</span>
                    ${e.name}: 
                    <span style="color: ${color};">O ${openPrice}</span>, 
                    <span style="color: ${color};">C ${closePrice}</span>
                `;
            } else if (seriesType === 'Histogram') {
                const histogramData = data as HistogramData;
                if (histogramData.value == null) {
                    e.div.innerHTML = `${e.name}: -`;
                    return;
                }
    
                const price = this.shorthandFormat(histogramData.value);
                e.div.innerHTML = `
                    <span style="color: ${e.colors[0]};">${e.legendSymbol[0] || '▨'}</span> 
                    ${e.name}: ${price}`;
            } else {
                // Handle series types with a single 'value' property
                const valueData = data as LineData | AreaData;
                if (valueData.value == null) {
                    e.div.innerHTML = `${e.name}: -`;
                    return;
                }
    
                const priceFormat = e.series.options().priceFormat as PriceFormatBuiltIn;
                const value = this.legendItemFormat(valueData.value, priceFormat.precision);
                e.div.innerHTML = `
                    <span style="color: ${e.colors[0]};">${e.legendSymbol[0] || '▨'}</span> 
                    ${e.name}: ${value}`;
            }
        });
    }
}    
