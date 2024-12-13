import asyncio
import json
import os
from base64 import b64decode
from datetime import datetime
from typing import Callable, Union, Literal, List, Optional, Dict
import pandas as pd

from .table import Table
from .toolbox import ToolBox
from .drawings import Box, HorizontalLine, RayLine, TrendLine, TwoPointDrawing, VerticalLine, VerticalSpan, Candle, ChandelierSeries
from .topbar import TopBar
from .util import (
    BulkRunScript, Pane, Events, IDGen, as_enum, jbool, js_json, TIME, NUM, FLOAT,
    LINE_STYLE, MARKER_POSITION, MARKER_SHAPE, CROSSHAIR_MODE,
    PRICE_SCALE_MODE,CANDLE_SHAPE, marker_position, marker_shape, js_data,
)

current_dir = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(current_dir, 'js', 'index.html')


class Window:
    _id_gen = IDGen()
    handlers = {}

    def __init__(
        self,
        script_func: Optional[Callable] = None,
        js_api_code: Optional[str] = None,
        run_script: Optional[Callable] = None
    ):
        self.loaded = False
        self.script_func = script_func
        self.scripts = []
        self.final_scripts = []
        self.bulk_run = BulkRunScript(script_func)

        if run_script:
            self.run_script = run_script

        if js_api_code:
            self.run_script(f'window.callbackFunction = {js_api_code}')

    def on_js_load(self):
        if self.loaded:
            return
        self.loaded = True

        if hasattr(self, '_return_q'):
            while not self.run_script_and_get('document.readyState == "complete"'):
                continue    # scary, but works

        initial_script = ''
        self.scripts.extend(self.final_scripts)
        for script in self.scripts:
            initial_script += f'\n{script}'
        self.script_func(initial_script)

    def run_script(self, script: str, run_last: bool = False):
        """
        For advanced users; evaluates JavaScript within the Webview.
        """
        if self.script_func is None:
            raise AttributeError("script_func has not been set")
        if self.loaded:
            if self.bulk_run.enabled:
                self.bulk_run.add_script(script)
            else:
                self.script_func(script)
        elif run_last:
            self.final_scripts.append(script)
        else:
            self.scripts.append(script)

    def run_script_and_get(self, script: str):
        self.run_script(f'_~_~RETURN~_~_{script}')
        return self._return_q.get()

    def create_table(
        self,
        width: NUM,
        height: NUM,
        headings: tuple,
        widths: Optional[tuple] = None,
        alignments: Optional[tuple] = None,
        position: FLOAT = 'left',
        draggable: bool = False,
        background_color: str = '#121417',
        border_color: str = 'rgb(70, 70, 70)',
        border_width: int = 1,
        heading_text_colors: Optional[tuple] = None,
        heading_background_colors: Optional[tuple] = None,
        return_clicked_cells: bool = False,
        func: Optional[Callable] = None
    ) -> 'Table':
        return Table(*locals().values())

    def create_subchart(
        self,
        position: FLOAT = 'left',
        width: float = 0.5,
        height: float = 0.5,
        sync_id: Optional[str] = None,
        scale_candles_only: bool = False,
        sync_crosshairs_only: bool = False,
        toolbox: bool = False
    ) -> 'AbstractChart':
        subchart = AbstractChart(
            self,
            width,
            height,
            scale_candles_only,
            toolbox,
            position=position
        )
        if not sync_id:
            return subchart
        self.run_script(f'''
            Lib.Handler.syncCharts(
                {subchart.id},
                {sync_id},
                {jbool(sync_crosshairs_only)}
            )
        ''', run_last=True)
        return subchart

    def style(
        self,
        background_color: str = '#0c0d0f',
        hover_background_color: str = '#3c434c',
        click_background_color: str = '#50565E',
        active_background_color: str = 'rgba(0, 122, 255, 0.7)',
        muted_background_color: str = 'rgba(0, 122, 255, 0.3)',
        border_color: str = '#3C434C',
        color: str = '#d8d9db',
        active_color: str = '#ececed'
    ):
        self.run_script(f'Lib.Handler.setRootStyles({js_json(locals())});')


class SeriesCommon(Pane):
    def __init__(self, chart: 'AbstractChart', name: str = ''):
        super().__init__(chart.win)
        self._chart = chart
        if hasattr(chart, '_interval'):
            self._interval = chart._interval
        else: 
            self._interval = 1
        self._last_bar = None
        self.name = name
        self.num_decimals = 2
        self.offset = 0
        self.data = pd.DataFrame()
        self.markers = {}
        self.primitives = {
            'ToolTip': False,
            'deltaToolTip': False
        }
        self.interval_str = self._format_interval_string()  # Initialize with a formatted string
        self.group = ''  # Default to empty string; subclasses can set this

    # ... other methods ...

    def _set_interval(self, df: pd.DataFrame):
        if not pd.api.types.is_datetime64_any_dtype(df['time']):
            df['time'] = pd.to_datetime(df['time'])
        common_interval = df['time'].diff().value_counts()
        if common_interval.empty:
            return
        self._interval = common_interval.index[0].total_seconds()

        # Set interval string after calculating interval
        self.interval_str = self._format_interval_string()

        units = [
            pd.Timedelta(microseconds=df['time'].dt.microsecond.value_counts().index[0]),
            pd.Timedelta(seconds=df['time'].dt.second.value_counts().index[0]),
            pd.Timedelta(minutes=df['time'].dt.minute.value_counts().index[0]),
            pd.Timedelta(hours=df['time'].dt.hour.value_counts().index[0]),
            pd.Timedelta(days=df['time'].dt.day.value_counts().index[0]),
        ]
        self.offset = 0
        for value in units:
            value = value.total_seconds()
            if value == 0:
                continue
            elif value >= self._interval:
                break
            self.offset = value
            break

    def _format_interval_string(self) -> str:
        """Convert the interval in seconds to a human-readable string format."""
        seconds = self._interval

        if seconds < 60:
            return f"{int(seconds)}s"
        elif seconds < 3600:
            minutes = seconds // 60
            return f"{int(minutes)}m"
        elif seconds < 86400:
            hours = seconds // 3600
            return f"{int(hours)}h"
        elif seconds < 2592000:  # About 30 days
            days = seconds // 86400
            return f"{int(days)}d"
        elif seconds < 31536000:  # About 365 days
            months = seconds // 2592000
            return f"{int(months)}mo"
        else:
            years = seconds // 31536000
            return f"{int(years)}y"

    # Other methods as before...
    @staticmethod
    def _format_labels(data, labels, index, exclude_lowercase):
        def rename(la, mapper):
            return [mapper[key] if key in mapper else key for key in la]
        if 'date' not in labels and 'time' not in labels:
            labels = labels.str.lower()
            if exclude_lowercase:
                labels = rename(labels, {exclude_lowercase.lower(): exclude_lowercase})
        if 'date' in labels:
            labels = rename(labels, {'date': 'time'})
        elif 'time' not in labels:
            data['time'] = index
            labels = [*labels, 'time']
        return labels
    @staticmethod
    def _legend_list_format(value: Union[str, List[str]]) -> List[str]:
        """
        Ensures that the input `value` has exactly two elements.
        - If `value` is a string, it duplicates it into a list of two elements.
        - If `value` is a list with one item, it duplicates that item.
        - If `value` is a list with more than two items, it truncates to the first two.
        """
        if isinstance(value, str):
            return [value, value]
        elif len(value) == 1:
            return [value[0], value[0]]
        else:
            return value[:2]
    def _df_datetime_format(self, df: pd.DataFrame, exclude_lowercase=None):
        df = df.copy()
        df.columns = self._format_labels(df, df.columns, df.index, exclude_lowercase)
        self._set_interval(df)
        if not pd.api.types.is_datetime64_any_dtype(df['time']):
            df['time'] = pd.to_datetime(df['time'])
        df['time'] = df['time'].astype('int64') // 10 ** 9
        return df

    def _series_datetime_format(self, series: pd.Series, exclude_lowercase=None):
        series = series.copy()
        series.index = self._format_labels(series, series.index, series.name, exclude_lowercase)
        series['time'] = self._single_datetime_format(series['time'])
        return series

    def _single_datetime_format(self, arg) -> float:
        if isinstance(arg, (str, int, float)) or not pd.api.types.is_datetime64_any_dtype(arg):
            try:
                arg = pd.to_datetime(arg, unit='ms')
            except ValueError:
                arg = pd.to_datetime(arg)
        arg = self._interval * (arg.timestamp() // self._interval)+self.offset
        return arg

    def set(self, df: Optional[pd.DataFrame] = None, format_cols: bool = True):
        if df is None or df.empty:
            self.run_script(f'{self.id}.series.setData([])')
            self.data = pd.DataFrame()
            return
        if format_cols:
            df = self._df_datetime_format(df, exclude_lowercase=self.name)
        if self.name:
            if self.name not in df:
                raise NameError(f'No column named "{self.name}".')
            df = df.rename(columns={self.name: 'value'})
        self.data = df.copy()
        self._last_bar = df.iloc[-1]
        self.run_script(f'{self.id}.series.setData({js_data(df)}); ')
    def set_indicator(
        self,
        function: callable,
        data: Optional[Union[pd.DataFrame, pd.Series]] = None,
        parameters: Optional[List[Dict[str, Union[str, int, float, bool]]]] = None,
        format_cols: bool = True
    ):        

        processed_data = align_length(function(data,parameters),data)
        
        
        if df is None or df.empty:
            self.run_script(f'{self.id}.series.setData([])')
            self.data = pd.DataFrame()
            return
        if format_cols:
            df = self._df_datetime_format(df, exclude_lowercase=self.name)
        if self.name:
            if self.name not in df:
                raise NameError(f'No column named "{self.name}".')
            df = df.rename(columns={self.name: 'value'})
        self.data = df.copy()
        self._last_bar = df.iloc[-1]
        self.run_script(f'{self.id}.series.setData({js_data(df)}); ')
            
    def update(self, series: pd.Series):
        series = self._series_datetime_format(series, exclude_lowercase=self.name)
        if self.name in series.index:
            series.rename({self.name: 'value'}, inplace=True)
        if self._last_bar is not None and series['time'] != self._last_bar['time']:
            self.data.loc[self.data.index[-1]] = self._last_bar
            self.data = pd.concat([self.data, series.to_frame().T], ignore_index=True)
        self._last_bar = series
        self.run_script(f'{self.id}.series.update({js_data(series)})')

    def _update_markers(self):
        self.run_script(f'{self.id}.series.setMarkers({json.dumps(list(self.markers.values()))})')

    def marker_list(self, markers: list):
        """
        Creates multiple markers.\n
        :param markers: The list of markers to set. These should be in the format:\n
        [
            {"time": "2021-01-21", "position": "below", "shape": "circle", "color": "#2196F3", "text": ""},
            {"time": "2021-01-22", "position": "below", "shape": "circle", "color": "#2196F3", "text": ""},
            ...
        ]
        :return: a list of marker ids.
        """
        markers = markers.copy()
        marker_ids = []
        for marker in markers:
            marker_id = self.win._id_gen.generate()
            self.markers[marker_id] = {
                "time": self._single_datetime_format(marker['time']),
                "position": marker_position(marker['position']),
                "color": marker['color'],
                "shape": marker_shape(marker['shape']),
                "text": marker['text'],
            }
            marker_ids.append(marker_id)
        self._update_markers()
        return marker_ids

    def marker(self, time: Optional[datetime] = None, position: MARKER_POSITION = 'below',
               shape: MARKER_SHAPE = 'arrow_up', color: str = '#2196F3', text: str = ''
               ) -> str:
        """
        Creates a new marker.\n
        :param time: Time location of the marker. If no time is given, it will be placed at the last bar.
        :param position: The position of the marker.
        :param color: The color of the marker (rgb, rgba or hex).
        :param shape: The shape of the marker.
        :param text: The text to be placed with the marker.
        :return: The id of the marker placed.
        """
        try:
            formatted_time = self._last_bar['time'] if not time else self._single_datetime_format(time)
        except TypeError:
            raise TypeError('Chart marker created before data was set.')
        marker_id = self.win._id_gen.generate()

        self.markers[marker_id] = {
            "time": formatted_time,
            "position": marker_position(position),
            "color": color,
            "shape": marker_shape(shape),
            "text": text,
        }
        self._update_markers()
        return marker_id

    def remove_marker(self, marker_id: str):
        """
        Removes the marker with the given id.\n
        """
        self.markers.pop(marker_id)
        self._update_markers()

    def horizontal_line(self, price: NUM, color: str = 'rgb(122, 146, 202)', width: int = 2,
                        style: LINE_STYLE = 'solid', text: str = '', axis_label_visible: bool = True,
                        func: Optional[Callable] = None
                        ) -> 'HorizontalLine':
        """
        Creates a horizontal line at the given price.
        """
        return HorizontalLine(self, price, color, width, style, text, axis_label_visible, func)

    def trend_line(
        self,
        start_time: TIME,
        start_value: NUM,
        end_time: TIME,
        end_value: NUM,
        round: bool = False,
        line_color: str = '#1E80F0',
        width: int = 2,
        style: LINE_STYLE = 'solid',
    ) -> TwoPointDrawing:
        return TrendLine(*locals().values())

    def box(
        self,
        start_time: TIME,
        start_value: NUM,
        end_time: TIME,
        end_value: NUM,
        round: bool = False,
        color: str = '#1E80F0',
        fill_color: str = 'rgba(255, 255, 255, 0.2)',
        width: int = 2,
        style: LINE_STYLE = 'solid',
    ) -> TwoPointDrawing:
        return Box(*locals().values())

    def ray_line(
        self,
        start_time: TIME,
        value: NUM,
        round: bool = False,
        color: str = '#1E80F0',
        width: int = 2,
        style: LINE_STYLE = 'solid',
        text: str = ''
    ) -> RayLine:
    # TODO
        return RayLine(*locals().values())

    def vertical_line(
        self,
        time: TIME,
        color: str = '#1E80F0',
        width: int = 2,
        style: LINE_STYLE ='solid',
        text: str = ''
    ) -> VerticalLine:
        return VerticalLine(*locals().values())

    def clear_markers(self):
        """
        Clears the markers displayed on the data.\n
        """
        self.markers.clear()
        self._update_markers()

    def price_line(self, label_visible: bool = True, line_visible: bool = True, title: str = ''):
        self.run_script(f'''
        {self.id}.series.applyOptions({{
            lastValueVisible: {jbool(label_visible)},
            priceLineVisible: {jbool(line_visible)},
            title: '{title}',
        }})''')

    def precision(self, precision: int):
        """
        Sets the precision and minMove.\n
        :param precision: The number of decimal places.
        """
        min_move = 1 / (10**precision)
        self.run_script(f'''
        {self.id}.series.applyOptions({{
            priceFormat: {{precision: {precision}, minMove: {min_move}}}
        }})''')
        self.num_decimals = precision

    def hide_data(self):
        self._toggle_data(False)

    def show_data(self):
        self._toggle_data(True)

    def _toggle_data(self, arg):
        self.run_script(f'''
        {self.id}.series.applyOptions({{visible: {jbool(arg)}}})
        if ('volumeSeries' in {self.id}) {self.id}.volumeSeries.applyOptions({{visible: {jbool(arg)}}})
        ''')

    def vertical_span(
        self,
        start_time: Union[TIME, tuple, list],
        end_time: Optional[TIME] = None,
        color: str = 'rgba(252, 219, 3, 0.2)',
        round: bool = False
    ):
        """
        Creates a vertical line or span across the chart.\n
        Start time and end time can be used together, or end_time can be
        omitted and a single time or a list of times can be passed to start_time.
        """
        if round:
            start_time = self._single_datetime_format(start_time)
            end_time = self._single_datetime_format(end_time) if end_time else None
        return VerticalSpan(self, start_time, end_time, color)

    def tooltip(self, line_color: str = 'rgba(0, 0, 0, 0.2)', follow_mode: str = 'top'):
        """
        Attach a tooltip primitive to the series.
        """
        if not self._chart.primitives.get('ToolTip'):
            js_code = f"""
            {self._chart.id}.attachTooltip('{self.name}', '{line_color}');
            """
            self._chart.run_script(js_code)
            self._chart.primitives['ToolTip'] = True  # Mark tooltip as attached
        else:
            self._update_tooltip_follow_mode(follow_mode)

    def detach_tooltip(self):
        """
        Detach the tooltip primitive from the series.
        """
        if self._chart.primitives.get('ToolTip'):
            js_code = f"""
            {self._chart.id}.detachTooltip('{self.name}');
            """
            self._chart.run_script(js_code)
            self._chart.primitives['ToolTip'] = False  # Mark tooltip as detached

    def delta_tooltip(self, line_color: str = 'rgba(0, 0, 0, 0.2)'):
        """
        Attach a delta tooltip primitive to the series.
        """
        if not self._chart.primitives.get('deltaToolTip'):
            js_code = f"""
            {self._chart.id}.attachDeltaTooltip('{self.name}', '{line_color}');
            """
            self._chart.run_script(js_code)
            self._chart.primitives['deltaToolTip'] = True  # Mark delta tooltip as attached

    def detach_delta_tooltip(self):
        """
        Detach the delta tooltip primitive from the series.
        """
        if self._chart.primitives.get('deltaToolTip'):
            js_code = f"""
            {self._chart.id}.detachDeltaTooltip('{self.name}');
            """
            self._chart.run_script(js_code)
            self._chart.primitives['deltaToolTip'] = False  # Mark delta tooltip as detached

            self.primitives['deltaToolTip'] = True


    def attach_probability_cone(self):
        """
        Attach a probability cone primitive to the series.
        """
        if not self._chart.primitives.get('probabilityCone'):
            js_code = f"""
            {self._chart.id}.attachprobabilityCone('{self.name}');
            """
            self._chart.run_script(js_code)
            self._chart.primitives['probabilityCone'] = True  # Mark probability cone as attached

    def detach_probability_cone(self):
        """
        Detach the probability cone primitive from the series.
        """
        if self._chart.primitives.get('probabilityCone'):
            js_code = f"""
            {self._chart.id}.detachprobabilityCone('{self.name}');
            """
            self._chart.run_script(js_code)
            self._chart.primitives['probabilityCone'] = False 

    def delete(self):
        """
        Irreversibly deletes the series and removes it from the legend and chart.
        """
        # Remove the series from the chart's internal list if it exists
        if hasattr(self._chart, '_lines') and self in self._chart._lines:
            self._chart._lines.remove(self)

        # Prepare the group name for JavaScript (handle None)
        group = self.group if self.group else ''

        self.run_script(f'''
            // Remove the series from the legend
            {self._chart.id}.legend.deleteLegendEntry('{self.name}', '{group}');
            
            // Remove the series from the chart
            {self._chart.id}.chart.removeSeries({self.id}.series);
            
            // Clean up references
            delete {self.id};
        ''')

        
    def fill_area(
        self,
        destination_series: str,
        name: str = "FillArea",
        origin_color: Optional[str] = None,
        destination_color: Optional[str] = None,
    ) -> 'FillArea':
        """
        Creates a colored region between this series and the destination series.
        
        Args:
            destination_series (SeriesCommon): The target series for the indicator.
            origin_color (str): Color for the band area where this series is above the destination.
            destination_color (str): Color for the band area where this series is below the destination.
            line_width (Optional[int]): Line width for the bands.
            name (str): Optional name for the FillArea.

        Returns:
            FillArea: The created FillArea instance.
        """

        # Default name if none is provided

        # Create the FillArea
        bands = FillArea(
            chart=self._chart,
            origin_series=self.name,
            destination_series=destination_series,
            origin_color=origin_color,
            destination_color=destination_color,
            name=name,
        )

        # Track the indicator for potential management or cleanup

        return bands
class Line(SeriesCommon):
    def __init__(
            self, chart, name, color, style, width, price_line, price_label, 
            group, legend_symbol, price_scale_id, crosshair_marker=True):
        super().__init__(chart, name)
        self.color = color
        self.group = group  # Store group for legend grouping
        self.legend_symbol = legend_symbol  # Store the legend symbol

        # Initialize series with configuration options
        self.run_script(f'''
            {self.id} = {self._chart.id}.createLineSeries(
                "{name}",
                {{
                    group: '{group}',
                    title: '{name}',                    
                    color: '{color}',
                    lineStyle: {as_enum(style, LINE_STYLE)},
                    lineWidth: {width},
                    lastValueVisible: {jbool(price_label)},
                    priceLineVisible: {jbool(price_line)},
                    crosshairMarkerVisible: {jbool(crosshair_marker)},
                    legendSymbol: '{legend_symbol}',
                    priceScaleId: {f'"{price_scale_id}"' if price_scale_id else 'undefined'}
                    {"""autoscaleInfoProvider: () => ({
                            priceRange: {
                                minValue: 1_000_000_000,
                                maxValue: 0,
                            },
                        }),
                    """ if chart._scale_candles_only else ''}
                }}
            )
        null''')
    #     if round:
    #         start_time = self._single_datetime_format(start_time)
    #         end_time = self._single_datetime_format(end_time)
    #     else:
    #         start_time, end_time = pd.to_datetime((start_time, end_time)).astype('int64') // 10 ** 9

    #     self.run_script(f'''
    #     {self._chart.id}.chart.timeScale().applyOptions({{shiftVisibleRangeOnNewBar: false}})
    #     {self.id}.series.setData(
    #         calculateTrendLine({start_time}, {start_value}, {end_time}, {end_value},
    #                             {self._chart.id}, {jbool(ray)}))
    #     {self._chart.id}.chart.timeScale().applyOptions({{shiftVisibleRangeOnNewBar: true}})
    #     ''')

    def delete(self):
        """
        Irreversibly deletes the line, as well as the object that contains the line.
        """
        self._chart._lines.remove(self) if self in self._chart._lines else None
        self.run_script(f'''
            // Check if the item is part of a named group
            if ('{self.group}' !== '' && '{self.group}' !== 'None') {{
                // Find the specific group by matching the group name
                let targetGroup = {self._chart.id}.legend._groups.find(group => group.name === '{self.group}');
                if (targetGroup) {{
                    // Locate the index of the item with the matching name in `names` array
                    let targetIndex = targetGroup.names.findIndex(name => name === '{self.name}');
                    if (targetIndex !== -1) {{
                        // Remove items at `targetIndex` from all arrays in the group
                        targetGroup.names.splice(targetIndex, 1);
                        targetGroup.seriesList.splice(targetIndex, 1);
                        targetGroup.solidColors.splice(targetIndex, 1);
                        targetGroup.legendSymbols.splice(targetIndex, 1);
                        
                        // Remove from `seriesTypes` only if it exists
                        if (targetGroup.seriesTypes) {{
                            targetGroup.seriesTypes.splice(targetIndex, 1);
                        }}

                        // If the group is now empty (e.g., `names` is empty), remove it from `_groups`
                        if (targetGroup.names.length === 0) {{
                            {self._chart.id}.legend._groups = {self._chart.id}.legend._groups.filter(group => group !== targetGroup);
                        }}
                    }}
                }}
            }} else {{
                // Otherwise, treat it as a standalone item in `_lines`
                {self.id}legendItem = {self._chart.id}.legend._lines.find((line) => line.series == {self.id}.series);
                {self._chart.id}.legend._lines = {self._chart.id}.legend._lines.filter((item) => item !== {self.id}legendItem);

                // Remove from the legend div if it's a standalone row
                if ({self.id}legendItem && {self.id}legendItem.row) {{
                    {self._chart.id}.legend.div.removeChild({self.id}legendItem.row);
                }}
            }}

            // Remove the series from the chart and clean up the references
            {self._chart.id}.chart.removeSeries({self.id}.series);
            delete {self.id}legendItem;
            delete {self.id};
        ''')

        def set(self,data):
            super().set(data)
class Histogram(SeriesCommon):
    def __init__(
            self, chart, name, color, price_line, price_label, group, legend_symbol, scale_margin_top, scale_margin_bottom):
        super().__init__(chart, name)
        self.color = color
        self.group = group  # Store group for legend grouping
        self.legend_symbol = legend_symbol  # Store legend symbol

        self.run_script(f'''
        {self.id} = {chart.id}.createHistogramSeries(
            "{name}",
            {{
                group: '{group}',
                title: '{name}',
                color: '{color}',
                lastValueVisible: {jbool(price_label)},
                priceLineVisible: {jbool(price_line)},
                legendSymbol: '{legend_symbol}',
                priceScaleId: '{self.id}',
                priceFormat: {{type: "volume"}}
            }},
            // precision: 2,
        )
        {self.id}.series.priceScale().applyOptions({{
            scaleMargins: {{top:{scale_margin_top}, bottom: {scale_margin_bottom}}}
        }})''')

    def delete(self):
        """
        Irreversibly deletes the histogram.
        """
        self.run_script(f'''
            {self.id}legendItem = {self._chart.id}.legend._lines.find((line) => line.series == {self.id}.series)
            {self._chart.id}.legend._lines = {self._chart.id}.legend._lines.filter((item) => item != {self.id}legendItem)

            if ({self.id}legendItem) {{
                {self._chart.id}.legend.div.removeChild({self.id}legendItem.row)
            }}

            {self._chart.id}.chart.removeSeries({self.id}.series)
            delete {self.id}legendItem
            delete {self.id}
        ''')

    def scale(self, scale_margin_top: float = 0.0, scale_margin_bottom: float = 0.0):
        self.run_script(f'''
        {self.id}.series.priceScale().applyOptions({{
            scaleMargins: {{top: {scale_margin_top}, bottom: {scale_margin_bottom}}}
        }})''')



class Area(SeriesCommon):
    def __init__(
            self, chart, name, top_color, bottom_color, invert, line_color,
            style, width, price_line, price_label, group, legend_symbol, price_scale_id, crosshair_marker=True):
        super().__init__(chart, name) 
        self.color = line_color
        self.topColor = top_color
        self.bottomColor = bottom_color
        self.group = group  # Store group for legend grouping
        self.legend_symbol = legend_symbol  # Store legend symbol

        self.run_script(f'''
            {self.id} = {self._chart.id}.createAreaSeries(
                "{name}",
                {{
                    group: '{group}',
                    title: '{name}',                    
                    topColor: '{top_color}',
                    bottomColor: '{bottom_color}',
                    invertFilledArea: {jbool(invert)},
                    color: '{line_color}',
                    lineColor: '{line_color}',
                    lineStyle: {as_enum(style, LINE_STYLE)},
                    lineWidth: {width},
                    lastValueVisible: {jbool(price_label)},
                    priceLineVisible: {jbool(price_line)},
                    crosshairMarkerVisible: {jbool(crosshair_marker)},
                    legendSymbol: '{legend_symbol}',
                    priceScaleId: {f'"{price_scale_id}"' if price_scale_id else 'undefined'}
                    {"""autoscaleInfoProvider: () => ({
                            priceRange: {
                                minValue: 1_000_000_000,
                                maxValue: 0,
                            },
                        }),
                    """ if chart._scale_candles_only else ''}
                }}
            )
        null''')
    def delete(self):
        """
        Irreversibly deletes the line, as well as the object that contains the line.
        """
        self._chart._lines.remove(self) if self in self._chart._lines else None
        self.run_script(f'''
            {self.id}legendItem = {self._chart.id}.legend._lines.find((line) => line.series == {self.id}.series)
            {self._chart.id}.legend._lines = {self._chart.id}.legend._lines.filter((item) => item != {self.id}legendItem)

            if ({self.id}legendItem) {{
                {self._chart.id}.legend.div.removeChild({self.id}legendItem.row)
            }}

            {self._chart.id}.chart.removeSeries({self.id}.series)
            delete {self.id}legendItem
            delete {self.id}
        ''')


class Bar(SeriesCommon):
    def __init__(
            self, chart, name, up_color, down_color, open_visible, thin_bars,
            price_line, price_label, group, legend_symbol, price_scale_id):
        super().__init__(chart, name)
        self.up_color = up_color
        self.down_color = down_color
        self.group = group  # Store group for legend grouping
        self.legend_symbol = legend_symbol if isinstance(legend_symbol, list) else [legend_symbol, legend_symbol]  # Store legend symbols

        self.run_script(f'''
        {self.id} = {chart.id}.createBarSeries(
            "{name}",
            {{
                group: '{group}',
                title: '{name}',
                color: '{up_color}',
                upColor: '{up_color}',
                downColor: '{down_color}',
                openVisible: {jbool(open_visible)},
                thinBars: {jbool(thin_bars)},
                lastValueVisible: {jbool(price_label)},
                priceLineVisible: {jbool(price_line)},
                legendSymbol: {json.dumps(self.legend_symbol)},
                priceScaleId: {f'"{price_scale_id}"' if price_scale_id else 'undefined'}
            }}
            
        )''')
    def set(self, df: Optional[pd.DataFrame] = None):
        if df is None or df.empty:
            self.run_script(f'{self.id}.series.setData([])')
            self.candle_data = pd.DataFrame()
            return
        df = self._df_datetime_format(df)
        self.data = df.copy()
        self._last_bar = df.iloc[-1]
        self.run_script(f'{self.id}.series.setData({js_data(df)})')

    def update(self, series: pd.Series, _from_tick=False):
        """
        Updates the data from a bar;
        if series['time'] is the same time as the last bar, the last bar will be overwritten.\n
        :param series: labels: date/time, open, high, low, close, volume (if using volume).
        """
        series = self._series_datetime_format(series) if not _from_tick else series
        if series['time'] != self._last_bar['time']:
            self.data.loc[self.data.index[-1]] = self._last_bar
            self.data = pd.concat([self.data, series.to_frame().T], ignore_index=True)
            self._chart.events.new_bar._emit(self)

        self._last_bar = series
        self.run_script(f'{self.id}.series.update({js_data(series)})')
    def delete(self):
        """
        Irreversibly deletes the bar series.
        """
        self.run_script(f'''
            {self.id}legendItem = {self._chart.id}.legend._lines.find((line) => line.series == {self.id}.series)
            {self._chart.id}.legend._lines = {self._chart.id}.legend._lines.filter((item) => item != {self.id}legendItem)

            if ({self.id}legendItem) {{
                {self._chart.id}.legend.div.removeChild({self.id}legendItem.row)
            }}

            {self._chart.id}.chart.removeSeries({self.id}.series)
            delete {self.id}legendItem
            delete {self.id}
        ''')
class CustomCandle(SeriesCommon):
    def __init__(
            self,
            chart,
            name: str,
            up_color: str ,
            down_color: str ,
            border_up_color: str,
            border_down_color: str ,
            wick_up_color: str ,
            wick_down_color: str ,
            wick_visible: bool = True,
            border_visible: bool= True,
            bar_width: float = 0.8,
            radius: Optional[str] = 30,
            shape: str = 'Rectangle',
            combineCandles: int = 1,
            vp_sections: int = 4,
            line_width: int = 1,
            line_style: LINE_STYLE = 'solid',
            price_line: bool = True,
            price_label: bool = True,
            group: str = '',
            legend_symbol: Union[str, List[str]] = ['⬤', '⬤'],
            price_scale_id: Optional[str] = None ):
        super().__init__(chart, name)
        self.up_color = up_color
        self.down_color = down_color
        self.group = group  # Store group for legend grouping
        self.legend_symbol = legend_symbol if isinstance(legend_symbol, list) else [legend_symbol, legend_symbol]
        radius_value = radius if radius is not None else 3

        # Define the radius function as a JavaScript function string if none provided
        radius_func = f"function(barSpacing) {{ return barSpacing < {radius_value} ? 0 : barSpacing / {radius_value}; }}"

        # Run the JavaScript to initialize the series with the provided options
        self.run_script(f'''
            {self.id} = {chart.id}.createCustomCandleSeries(
                "{name}",
                {{
                    group: '{group}',
                    title: '{name}',                    
                    upColor: '{up_color}',
                    downColor: '{down_color}',
                    borderUpColor: '{border_up_color}',
                    borderDownColor: '{border_down_color}',
                    wickUpColor: '{wick_up_color or border_up_color}',
                    wickDownColor: '{wick_down_color or border_down_color}',
                    wickVisible: {jbool(wick_visible)},
                    borderVisible: {jbool(border_visible)},
                    barSpacing: {bar_width},
                    radius: {radius_func},
                    shape: '{shape}',
                    lastValueVisible: {jbool(price_label)},
                    priceLineVisible: {jbool(price_line)},
                    legendSymbol: {json.dumps(self.legend_symbol)},
                    priceScaleId: {f'"{price_scale_id}"' if price_scale_id else 'undefined'},
                    seriesType: "customCandle",
                    chandelierSize: {combineCandles},
                    lineStyle: {as_enum(line_style, LINE_STYLE)},
                    lineWidth: {line_width},
                    vpSections: {vp_sections}

                }}
            )
        null''')

    def set(self, df: Optional[pd.DataFrame] = None):
        if df is None or df.empty:
            self.run_script(f'{self.id}.series.setData([])')
            self.data = pd.DataFrame()
            return
        df = self._df_datetime_format(df)
        self.data = df.copy()
        self._last_bar = df.iloc[-1]
        self.run_script(f'{self.id}.series.setData({js_data(df)})')

    def update(self, series: pd.Series):
        series = self._series_datetime_format(series)
        if series['time'] != self._last_bar['time']:
            self.data.loc[self.data.index[-1]] = self._last_bar
            self.data = pd.concat([self.data, series.to_frame().T], ignore_index=True)
            self._chart.events.new_bar._emit(self)

        self._last_bar = series
        self.run_script(f'{self.id}.series.update({js_data(series)})')

    def delete(self):
        """
        Irreversibly deletes the custom candle series.
        """
        self.run_script(f'''
            {self.id}legendItem = {self._chart.id}.legend._lines.find((line) => line.series == {self.id}.series)
            {self._chart.id}.legend._lines = {self._chart.id}.legend._lines.filter((item) => item != {self.id}legendItem)

            if ({self.id}legendItem) {{
                {self._chart.id}.legend.div.removeChild({self.id}legendItem.row)
            }}

            {self._chart.id}.chart.removeSeries({self.id}.series)
            delete {self.id}legendItem
            delete {self.id}
        ''')
class HTFCandle(SeriesCommon):
    def __init__(
            self,
            chart,
            name: str,
            up_color: str = '#26a69a',
            down_color: str = '#ef5350',
            border_up_color: str = '#26a69a',
            border_down_color: str = '#ef5350',
            wick_up_color: str = '#26a69a',
            wick_down_color: str = '#ef5350',
            wick_visible: bool = True,
            border_visible: bool = True,
            radius: Optional[str] = None,
            multiple: int = 5,
            price_line: bool = True,
            price_label: bool = True,
            group: str = '',
            legend_symbol: Union[str, List[str]] = ['⬤', '⬤'],
            price_scale_id: Optional[str] = None
        ):
        super().__init__(chart, name)
        self.up_color = up_color
        self.down_color = down_color
        self.group = group  # Store group for legend grouping
        self.legend_symbol = legend_symbol if isinstance(legend_symbol, list) else [legend_symbol, legend_symbol]
        radius_value = radius if radius is not None else 3

        # Define the radius function as a JavaScript function string if none provided
        radius_func = f"function(barSpacing) {{ return barSpacing < {radius_value} ? 0 : barSpacing / {radius_value}; }}"

        # Run the JavaScript to initialize the series with the provided options
       
        self.run_script(f'''
            {self.id} = {chart.id}.createHigherTFCandleSeries(
                "{name}",
                {{
                    group: '{group}',
                    title: '{name}',                    upColor: '{up_color}',
                    downColor: '{down_color}',
                    borderUpColor:'{border_up_color}',
                    borderDownColor:'{border_down_color}',
                    wickUpColor:'{border_up_color}',
                    wickDownColor:'{border_down_color}',
                    wickVisible: {jbool(wick_visible)},
                    borderVisible: {jbool(border_visible)},
                    radius: {radius_func},
                    multiple: {multiple},
                    lastValueVisible: {jbool(price_label)},
                    priceLineVisible: {jbool(price_line)},
                    legendSymbol: {json.dumps(self.legend_symbol)},
                    priceScaleId: {f'"{price_scale_id}"' if price_scale_id else 'undefined'},
                    seriesType: "htfCandle" 
                }}
            )
        null''')

    def set(self, df: Optional[pd.DataFrame] = None):
        if df is None or df.empty:
            self.run_script(f'{self.id}.series.setData([])')
            self.data = pd.DataFrame()
            return
        df = self._df_datetime_format(df)
        self.data = df.copy()
        self._last_bar = df.iloc[-1]
        self.run_script(f'{self.id}.series.setData({js_data(df)})')

    def update(self, series: pd.Series):
        series = self._series_datetime_format(series)
        if series['time'] != self._last_bar['time']:
            self.data.loc[self.data.index[-1]] = self._last_bar
            self.data = pd.concat([self.data, series.to_frame().T], ignore_index=True)
            self._chart.events.new_bar._emit(self)

        self._last_bar = series
        self.run_script(f'{self.id}.series.update({js_data(series)})')

    def delete(self):
        """
        Irreversibly deletes the custom candle series.
        """
        self.run_script(f'''
            {self.id}legendItem = {self._chart.id}.legend._lines.find((line) => line.series == {self.id}.series)
            {self._chart.id}.legend._lines = {self._chart.id}.legend._lines.filter((item) => item != {self.id}legendItem)

            if ({self.id}legendItem) {{
                {self._chart.id}.legend.div.removeChild({self.id}legendItem.row)
            }}

            {self._chart.id}.chart.removeSeries({self.id}.series)
            delete {self.id}legendItem
            delete {self.id}
        ''')

class CandleBar:
    def __init__(self, chart: 'AbstractChart', name: str, up_color='#26a69a', down_color='#ef5350', open_visible=True, thin_bars=True, **kwargs):
        # Use the existing chart (inherits from Candlestick) and data
        self._chart = chart
        self._name = name
        self.up_color = up_color
        self.down_color = down_color
        self.args_dict = kwargs

        # Create an instance of Bar using composition
        self._bar_chart = Bar(
            chart=chart,
            name=f"{name}_Bar",
            up_color=up_color,
            down_color=down_color,
            open_visible=open_visible,
            thin_bars=thin_bars,
            price_line = True,
            price_label = True, 
            group = '',
            legend_symbol =  ['┌', '└'], 
            price_scale_id = None
        )
        

        # Apply the candle_style if relevant parameters are provided in kwargs
        self._apply_candle_style_if_exists(kwargs)


    def _apply_candle_style_if_exists(self, kwargs: dict):
        """
        Checks for any candle style parameters in kwargs and applies the style if present.
        """
        relevant_keys = [
            'up_color', 'down_color', 'wick_visible', 'border_visible',
            'border_up_color', 'border_down_color', 'wick_up_color', 'wick_down_color'
        ]
        self._chart.candle_style(
            up_color=kwargs.get('up_color', self.up_color),
            down_color=kwargs.get('down_color', self.down_color),
            wick_visible=kwargs.get('wick_visible', True),
            border_visible=kwargs.get('border_visible', False),
            border_up_color=kwargs.get('border_up_color', self.up_color),
            border_down_color=kwargs.get('border_down_color', self.down_color),
            wick_up_color=kwargs.get('wick_up_color', self.up_color),
            wick_down_color=kwargs.get('wick_down_color', self.down_color)
            )
        
        self._chart.volume_config(
            up_color = self.up_color,
            down_color = self.down_color)

    def set(self, df: pd.DataFrame, condition_func: Callable[[pd.Series], bool]):
        """
        Sets the initial data for the chart.
        :param df: DataFrame with columns: date/time, open, high, low, close, volume.
        :param condition_func: A callable that defines the visibility of bars.
        """
        # Store a copy of the data
        self._condition_func = condition_func
        self._data = df.copy()
        self._candles = df.copy()
        self._bars = df.copy()

        # Determine visibility based on the condition function
        visibility_condition = condition_func(self._data)

        # Make the entire candle completely invisible if condition_func is False
        self._candles['color'] = self._candles.apply(
            lambda row: (
                self.up_color if row['close'] > row['open'] else self.down_color
            ) if visibility_condition.loc[row.name] else 'rgba(0,0,0,0)',
            axis=1
        )
        self._candles['border_color'] = self._candles.apply(
            lambda row: (
                self.up_color if row['close'] > row['open'] else self.down_color
            ) if visibility_condition.loc[row.name] else 'rgba(0,0,0,0)',
            axis=1
        )
        self._candles['wick_color'] = self._candles.apply(
            lambda row: (
                self.up_color if row['close'] > row['open'] else self.down_color
            ) if visibility_condition.loc[row.name] else 'rgba(0,0,0,0)',
            axis=1
        )

        # Define the candles DataFrame explicitly to include full OHLCV and styling columns
        candles = self._candles[['time', 'open', 'high', 'low', 'close', 'volume', 'color', 'border_color', 'wick_color']].copy()

        # Initialize the bars DataFrame, which should only be visible if condition_func is True
        bars = self._bars.copy()
        
        # Hide OHLC values for bars if not visible
        bars.loc[visibility_condition, ['open', 'high', 'low', 'close']] = None

        # Set color-related columns to fully transparent if bars should not be visible
        bars.loc[visibility_condition, ['color', 'border_color', 'wick_color']] = 'rgba(0,0,0,0)'

        # Use Candlestick class to set candlestick data
        self._chart.set(candles)

        # Use Bar class to set bar data
        self._bar_chart.set(bars)

    def update(self, series: pd.Series):
        """
        Updates the data from a bar;
        if series['time'] is the same time as the last bar, the last bar will be overwritten.
        :param series: A Pandas Series containing the new bar data.
        """
        # Append the new series to the existing data
        self._data = pd.concat([self._data, series.to_frame().T], ignore_index=True)

        # Check the condition for the new series
        condition_met = self._condition_func(self._data).iloc[-1]

        # Set colors based on whether the condition is met and price movement
        if condition_met:
            # When the condition is met, use standard colors
            candle_color = "rgba(0,255,0,1)" if series['close'] > series['open'] else "rgba(255,0,0,1)"
            border_color = candle_color
            wick_color = candle_color

            # OHLCV data for the candle is fully visible
            candle_data = {
                'time': series['time'],
                'open': series['open'],
                'high': series['high'],
                'low': series['low'],
                'close': series['close'],
                'volume': series['volume'],
                'color': candle_color,
                'border_color': border_color,
                'wick_color': wick_color,
            }

            # Hide bar data (set OHLC to None)
            bar_data = {
                'time': series['time'],
                'open': series['open'],
                'high': series['high'],
                'low': series['low'],
                'close': series['close'],
                'volume': series['volume'],
                'color': 'rgba(0,0,0,0)',
                'border_color': 'rgba(0,0,0,0)',
                'wick_color': 'rgba(0,0,0,0)',
            }
        else:
            # When the condition is not met, hide the candle
            candle_data = {
                'time': series['time'],
                'open': series['open'],
                'high': series['high'],
                'low': series['low'],
                'close': series['close'],
                'volume': series['volume'],
                'color': 'rgba(0,0,0,0)',
                'border_color': 'rgba(0,0,0,0)',
                'wick_color': 'rgba(0,0,0,0)',
            }

            # Set bar data using standard colors
            bar_color = "rgba(0,255,0,1)" if series['close'] > series['open'] else "rgba(255,0,0,1)"
            bar_data = {
                'time': series['time'],
                'open': series['open'],
                'high': series['high'],
                'low': series['low'],
                'close': series['close'],
                'volume': series['volume'],
                'color': bar_color,
                'border_color': bar_color,
                'wick_color': bar_color,
            }

        # Update candlestick and bar charts
        self._chart.update(pd.Series(candle_data))
        self._bar_chart.update(pd.Series(bar_data))
        

class Candlestick(SeriesCommon):
    def __init__(self, chart: 'AbstractChart'):
        super().__init__(chart)
        self._volume_up_color = 'rgba(83,141,131,0.8)'
        self._volume_down_color = 'rgba(200,127,130,0.8)'

        self.candle_data = pd.DataFrame()

        # self.run_script(f'{self.id}.makeCandlestickSeries()')

    def set(self, df: Optional[pd.DataFrame] = None, keep_drawings=False):
        """
        Sets the initial data for the chart.\n
        :param df: columns: date/time, open, high, low, close, volume (if volume enabled).
        :param keep_drawings: keeps any drawings made through the toolbox. Otherwise, they will be deleted.
        """
        if df is None or df.empty:
            self.run_script(f'{self.id}.series.setData([])')
            self.run_script(f'{self.id}.volumeSeries.setData([])')
            self.candle_data = pd.DataFrame()
            return
        df = self._df_datetime_format(df)
        self.candle_data = df.copy()
        self._last_bar = df.iloc[-1]
        self.run_script(f'{self.id}.series.setData({js_data(df)})')

        if 'volume' not in df:
            return
        volume = df.drop(columns=['open', 'high', 'low', 'close']).rename(columns={'volume': 'value'})
        volume['color'] = self._volume_down_color
        volume.loc[df['close'] > df['open'], 'color'] = self._volume_up_color
        self.run_script(f'{self.id}.volumeSeries.setData({js_data(volume)})')

        for line in self._lines:
            if line.name not in df.columns:
                continue
            line.set(df[['time', line.name]], format_cols=False)
        # set autoScale to true in case the user has dragged the price scale
        self.run_script(f'''
            if (!{self.id}.chart.priceScale("right").options.autoScale)
                {self.id}.chart.priceScale("right").applyOptions({{autoScale: true}})
        ''')
        # TODO keep drawings doesn't work consistenly w
        if keep_drawings:
            self.run_script(f'{self._chart.id}.toolBox?._drawingTool.repositionOnTime()')
        else:
            self.run_script(f"{self._chart.id}.toolBox?.clearDrawings()")

    def update(self, series: pd.Series, _from_tick=False):
        """
        Updates the data from a bar;
        if series['time'] is the same time as the last bar, the last bar will be overwritten.\n
        :param series: labels: date/time, open, high, low, close, volume (if using volume).
        """
        series = self._series_datetime_format(series) if not _from_tick else series
        if series['time'] != self._last_bar['time']:
            self.candle_data.loc[self.candle_data.index[-1]] = self._last_bar
            self.candle_data = pd.concat([self.candle_data, series.to_frame().T], ignore_index=True)
            self._chart.events.new_bar._emit(self)

        self._last_bar = series
        self.run_script(f'{self.id}.series.update({js_data(series)})')
        if 'volume' not in series:
            return
        volume = series.drop(['open', 'high', 'low', 'close']).rename({'volume': 'value'})
        volume['color'] = self._volume_up_color if series['close'] > series['open'] else self._volume_down_color
        self.run_script(f'{self.id}.volumeSeries.update({js_data(volume)})')

    def update_from_tick(self, series: pd.Series, cumulative_volume: bool = False):
        """
        Updates the data from a tick.\n
        :param series: labels: date/time, price, volume (if using volume).
        :param cumulative_volume: Adds the given volume onto the latest bar.
        """
        series = self._series_datetime_format(series)
        if series['time'] < self._last_bar['time']:
            raise ValueError(f'Trying to update tick of time "{pd.to_datetime(series["time"])}", which occurs before the last bar time of "{pd.to_datetime(self._last_bar["time"])}".')
        bar = pd.Series(dtype='float64')
        if series['time'] == self._last_bar['time']:
            bar = self._last_bar
            bar['high'] = max(self._last_bar['high'], series['price'])
            bar['low'] = min(self._last_bar['low'], series['price'])
            bar['close'] = series['price']
            if 'volume' in series:
                if cumulative_volume:
                    bar['volume'] += series['volume']
                else:
                    bar['volume'] = series['volume']
        else:
            for key in ('open', 'high', 'low', 'close'):
                bar[key] = series['price']
            bar['time'] = series['time']
            if 'volume' in series:
                bar['volume'] = series['volume']
        self.update(bar, _from_tick=True)

    def price_scale(
        self,
        auto_scale: bool = True,
        mode: PRICE_SCALE_MODE = 'normal',
        invert_scale: bool = False,
        align_labels: bool = True,
        scale_margin_top: float = 0.2,
        scale_margin_bottom: float = 0.2,
        border_visible: bool = False,
        border_color: Optional[str] = None,
        text_color: Optional[str] = None,
        entire_text_only: bool = False,
        visible: bool = True,
        ticks_visible: bool = False,
        minimum_width: int = 0
    ):
        self.run_script(f'''
            {self.id}.series.priceScale().applyOptions({{
                autoScale: {jbool(auto_scale)},
                mode: {as_enum(mode, PRICE_SCALE_MODE)},
                invertScale: {jbool(invert_scale)},
                alignLabels: {jbool(align_labels)},
                scaleMargins: {{top: {scale_margin_top}, bottom: {scale_margin_bottom}}},
                borderVisible: {jbool(border_visible)},
                {f'borderColor: "{border_color}",' if border_color else ''}
                {f'textColor: "{text_color}",' if text_color else ''}
                entireTextOnly: {jbool(entire_text_only)},
                visible: {jbool(visible)},
                ticksVisible: {jbool(ticks_visible)},
                minimumWidth: {minimum_width}
            }})''')

    def candle_style(
            self, up_color: str = 'rgba(39, 157, 130, 100)', down_color: str = 'rgba(200, 97, 100, 100)',
            wick_visible: bool = True, border_visible: bool = True, border_up_color: str = '',
            border_down_color: str = '', wick_up_color: str = '', wick_down_color: str = ''):
        """
        Candle styling for each of its parts.\n
        If only `up_color` and `down_color` are passed, they will color all parts of the candle.
        """
        border_up_color = border_up_color if border_up_color else up_color
        border_down_color = border_down_color if border_down_color else down_color
        wick_up_color = wick_up_color if wick_up_color else up_color
        wick_down_color = wick_down_color if wick_down_color else down_color
        self.run_script(f"{self.id}.series.applyOptions({js_json(locals())})")

    def volume_config(self, scale_margin_top: float = 0.8, scale_margin_bottom: float = 0.0,
                      up_color='rgba(83,141,131,0.8)', down_color='rgba(200,127,130,0.8)'):
        """
        Configure volume settings.\n
        Numbers for scaling must be greater than 0 and less than 1.\n
        Volume colors must be applied prior to setting/updating the bars.\n
        """
        self._volume_up_color = up_color if up_color else self._volume_up_color
        self._volume_down_color = down_color if down_color else self._volume_down_color
        self.run_script(f'''
        {self.id}.volumeSeries.priceScale().applyOptions({{
            scaleMargins: {{
            top: {scale_margin_top},
            bottom: {scale_margin_bottom},
            }}
        }})''')
class VolumeProfile:
    def __init__(self, chart, side: bool, sections: int, width: float, up_color: str, down_color: str,
                 border_up_color: str, border_down_color: str,
                 fibonacci_profile:bool, fibonacci_levels:bool, start_index: int, end_index: int):   
        """
        Initialize a VolumeProfile, which triggers the JavaScript `createVolumeProfile`
        method to calculate and display the volume profile for the specified series.

        :param chart: The chart instance.
        :param side: The side to render the volume profile on (True for left, False for right).
        :param up_color: The color for upward volume.
        :param down_color: The color for downward volume.
        """
        self.chart = chart
        self.side = False if side == 'left' else True # Now a boolean where True=left and False=right

        self.chart.run_script(f'''
                              
            {self.chart.id}.createVolumeProfile(
                {jbool(self.side)}, 
                {sections},
                {width},
                "{up_color}",
                "{down_color}",
                "{border_up_color}",
                "{border_down_color}",
                {jbool(fibonacci_profile)},
                {jbool(fibonacci_levels)},
                {start_index if start_index is not None else "undefined"},
                {end_index if end_index is not None else "undefined"}
            );
        ''')

class DeltaProfile:
    def __init__(self, chart, side:str,up_color: str, down_color: str):
                
        """
        Initialize a DeltaProfile, which triggers the JavaScript `createDeltaProfile`
        method to calculate and display the delta profile for the specified series.

        :param chart: The chart instance.
        :param size: The number of sections (bins) in the delta profile.
        :param side: The side ('right' or 'left') to display the delta profile.
        """
        self.chart = chart
        self.side = 'true' if side == 'left' else 'false'

        self.up_color = up_color
        self.down_color = down_color
        # Call JavaScript to create the delta profile
        self.create_delta_profile_js()

    def create_delta_profile_js(self):
        """
        Calls the JavaScript `createDeltaProfile` method to render the delta profile for the specified series.
        """
        self.chart.run_script(f'''
            {self.chart.id}.createDeltaProfile({{
                {f'borderColor: "{self.side}",' if border_color else ''},               
                upColor: "{self.up_color}",
                downColor: "{self.down_color}"
                
            }});
        ''')
class FillArea:
    def __init__(
        self,
        name: str,
        chart: 'AbstractChart',
        origin_series:str,
        destination_series: str,
        origin_color: Optional[str] = None,
        destination_color: Optional[str] = None,
    ):
        self.chart = chart
        self.origin_series = origin_series
        self.destination_series = destination_series
        self.origin_color = origin_color
        self.destination_color = destination_color
        self.name = name 

        # Run JavaScript to create the visual indicator
        js_code = f"""
            {self.name} = {self.chart.id}.createFillArea({{
                originSeries: '{self.origin_series}',
                destinationSeries: '{self.destination_series}',
                {f'originColor: "{self.origin_color}",' if self.origin_color else ''}
                {f'destinationColor: "{self.destination_color}",' if self.destination_color else ''}
                name: '{self.name}'
            }});
        """
               # Debugging: Print the JavaScript code
        print("Generated JavaScript Code for FillArea:", js_code)

        # Execute the JavaScript
        self.chart.run_script(js_code)

        

    def applyOptions(self, **kwargs):
        """
        Updates the FillArea options dynamically.

        Args:
            kwargs: Dictionary of options to update.
                - originColor (str): New color for the origin side of the fill.
                - destinationColor (str): New color for the destination side of the fill.
        """
        # Update options with new values
        for key, value in kwargs.items():
            if key in self.options:
                self.options[key] = value

        # Build the JavaScript options object dynamically
        js_options = []
        if self.options.get("originColor"):
            js_options.append(f'originColor: "{self.options["originColor"]}"')
        if self.options.get("destinationColor"):
            js_options.append(f'destinationColor: "{self.options["destinationColor"]}"')
        js_options_string = ", ".join(js_options)

    # Apply the updates via JavaScript
        # Apply the updates to the chart
        self.chart.run_script(f'''
            const originSeries = this.seriesMap.get(origin);
            const destinationSeries = this.seriesMap.get(destination);   
                
            originSeries.primitives['{self.name}'].applyOptions({{
                           {js_options_string}

            }})
        ''')
class AbstractChart(Candlestick, Pane):
    def __init__(self, window: Window, width: float = 1.0, height: float = 1.0,
                 scale_candles_only: bool = False, toolbox: bool = False,
                 autosize: bool = True, position: FLOAT = 'left'):
        Pane.__init__(self, window)
 
        self._lines = []
        self._scale_candles_only = scale_candles_only
        self._width = width
        self._height = height
        self.events: Events = Events(self)
        self.primitives = {
            'ToolTip': False,
            'deltaToolTip': False
        }
        from .polygon import PolygonAPI
        self.polygon: PolygonAPI = PolygonAPI(self)

        self.run_script(
            f'{self.id} = new Lib.Handler("{self.id}", {width}, {height}, "{position}", {jbool(autosize)})')

        Candlestick.__init__(self, self)

        self.topbar: TopBar = TopBar(self)
        if toolbox:
            self.toolbox: ToolBox = ToolBox(self)

    def fit(self):
        """
        Fits the maximum amount of the chart data within the viewport.
        """
        self.run_script(f'{self.id}.chart.timeScale().fitContent()')

    from typing import Union, List, Optional


    def create_line(
            self, 
            name: str = '', 
            color: str = 'rgba(214, 237, 255, 0.6)',
            style: LINE_STYLE = 'solid', 
            width: int = 2,
            price_line: bool = True, 
            price_label: bool = True, 
            group: str = '',
            legend_symbol: str = '', 
            price_scale_id: Optional[str] = None
        ) -> Line:
        """
        Creates and returns a Line object.
        """
        
        symbol_styles = {
            'solid':'―',
            'dotted':'··',
            'dashed':'--',
            'large_dashed':'- -',
            'sparse_dotted':"· ·",
        }
        if legend_symbol == '':
            legend_symbol = symbol_styles.get(style, '━')  # Default to 'solid' if style is unrecognized

        if not isinstance(legend_symbol, str):
            raise TypeError("legend_symbol must be a string for Line series.")
        
        self._lines.append(Line(
            self, name, color, style, width, price_line, price_label, 
            group, legend_symbol, price_scale_id
        ))
        return self._lines[-1]

    def create_histogram(
            self, 
            name: str = '', 
            color: str = 'rgba(214, 237, 255, 0.6)',
            price_line: bool = True, 
            price_label: bool = True,
            group: str = '', 
            legend_symbol: str = '▥',
            scale_margin_top: float = 0.0, 
            scale_margin_bottom: float = 0.0
        ) -> Histogram:
        """
        Creates and returns a Histogram object.
        """
        if not isinstance(legend_symbol, str):
            raise TypeError("legend_symbol must be a string for Histogram series.")
        
        return Histogram(
            self, name, color, price_line, price_label, 
            group, legend_symbol, scale_margin_top, scale_margin_bottom
        )

    def create_area(
            self, 
            name: str = '', 
            top_color: str = 'rgba(0, 100, 0, 0.5)',
            bottom_color: str = 'rgba(138, 3, 3, 0.5)', 
            invert: bool = False, 
            color: str = 'rgba(0,0,255,1)', 
            style: LINE_STYLE = 'solid',
            width: int = 2, 
            price_line: bool = True, 
            price_label: bool = True, 
            group: str = '', 
            legend_symbol: str = '◪', 
            price_scale_id: Optional[str] = None
        ) -> Area:
        """
        Creates and returns an Area object.
        """
        if not isinstance(legend_symbol, str):
            raise TypeError("legend_symbol must be a string for Area series.")
        
        self._lines.append(Area(
            self, name, top_color, bottom_color, invert, color, style, 
            width, price_line, price_label, group, legend_symbol, price_scale_id
        ))
        return self._lines[-1]

    def create_bar(
            self, 
            name: str = '', 
            up_color: str = '#26a69a', 
            down_color: str = '#ef5350',
            open_visible: bool = True, 
            thin_bars: bool = True,
            price_line: bool = True, 
            price_label: bool = True,
            group: str = '', 
            legend_symbol: Union[str, List[str]] = ['┌', '└'],
            price_scale_id: Optional[str] = None
        ) -> Bar:
        """
        Creates and returns a Bar object.
        """
        if not isinstance(legend_symbol, (str, list)):
            raise TypeError("legend_symbol must be a string or list of strings for Bar series.")
        if isinstance(legend_symbol, list) and not all(isinstance(symbol, str) for symbol in legend_symbol):
            raise TypeError("Each item in legend_symbol list must be a string for Bar series.")
        
        return Bar(
            self, name, up_color, down_color, open_visible, thin_bars, 
            price_line, price_label, group, legend_symbol, price_scale_id
        )
 
    def create_custom_candle(
            self,
            name: str = '',
            up_color: str = None,
            down_color: str = None,
            border_up_color='rgba(0,255,0,1)',
            border_down_color='rgba(255,0,0,1)',
            wick_up_color='rgba(0,255,0,1)',
            wick_down_color='rgba(255,0,0,1)',
            wick_visible: bool = True,
            border_visible: bool = True,
            bar_width: float = 0.8,
            rounded_radius: Union[float, int] = 100,
            shape: Literal[CANDLE_SHAPE] = "Rectangle",
            combineCandles: int = 1,
            vp_sections: int = 4,
            line_width: int = 1,
            line_style: LINE_STYLE = 'solid', 
            price_line: bool = True,
            price_label: bool = True,
            group: str = '',
            legend_symbol: Union[str, List[str]] = ['⑃', '⑂'],
            price_scale_id: Optional[str] = None,
        ) -> CustomCandle:
        """
        Creates and returns a CustomCandle object.
        """
        # Validate that legend_symbol is either a string or a list of two strings
        if not isinstance(legend_symbol, (str, list)):
            raise TypeError("legend_symbol must be a string or list of strings for CustomCandle series.")
        if isinstance(legend_symbol, list) and len(legend_symbol) != 2:
            raise ValueError("legend_symbol list must contain exactly two symbols for CustomCandle series.")

        return CustomCandle(
            self,
            name=name,
            up_color=up_color or border_up_color,
            down_color=down_color or border_down_color,
            border_up_color=border_up_color or up_color,
            border_down_color=border_down_color or down_color,
            wick_up_color=wick_up_color or border_up_color or border_up_color,
            wick_down_color=wick_down_color or border_down_color or border_down_color,
            wick_visible=wick_visible,
            border_visible=border_visible,
            bar_width=bar_width,
            radius=rounded_radius,
            shape=shape,
            combineCandles=combineCandles,
            vp_sections = vp_sections,
            line_style= line_style,
            line_width= line_width,
            price_line=price_line,
            price_label=price_label,
            group=group,
            legend_symbol=legend_symbol,
            price_scale_id=price_scale_id,
        )
    def create_htf_candle(
            self,
            name: str = '',
            up_color: str = None,
            down_color: str = None,
            border_up_color =  'rgba(0,255,0,1)',
            border_down_color = 'rgba(255,0,0,1)',
            wick_up_color = None,
            wick_down_color = None,
            wick_visible: bool = True,
            border_visible: bool = True,
            radius:  Union[float,int] = 3,
            multiple: int = 5,
            price_line: bool = True,
            price_label: bool = True,
            group: str = '',
            legend_symbol: Union[str, List[str]] =['⑃', '⑂'],
            price_scale_id: Optional[str] = None
        ) -> CustomCandle:
        """
        Creates and returns a CustomCandle object.
        """
        # Validate that legend_symbol is either a string or a list of two strings
        if not isinstance(legend_symbol, (str, list)):
            raise TypeError("legend_symbol must be a string or list of strings for CustomCandle series.")
        if isinstance(legend_symbol, list) and len(legend_symbol) != 2:
            raise ValueError("legend_symbol list must contain exactly two symbols for CustomCandle series.")

        return HTFCandle(
            self,
            name=name,
            up_color=up_color or border_up_color,
            down_color=down_color or border_down_color,
            border_up_color =border_up_color or up_color,
            border_down_color =border_down_color or down_color,
            wick_up_color =border_up_color or border_up_color,
            wick_down_color =border_down_color or border_down_color,
            wick_visible=wick_visible,
            border_visible=border_visible,
            radius=radius,
            multiple=multiple,
            price_line=price_line,
            price_label=price_label,
            group=group,
            legend_symbol=legend_symbol,
            price_scale_id=price_scale_id
        )
    def create_chandelier(
            self, 
            interval: int = 7,
            wick_width: int = 2, 
            wick_style: LINE_STYLE = 'solid',
            alpha: float = 1.0,
            colors: Optional[List[str]] = None,
            df: pd.DataFrame = None
        ) -> 'ChandelierSeries':
        """
        Creates and returns a ChandelierSeries object with dynamic color calculation.

        Args:
        - interval: Number of bars after which a new Chandelier candle is created.
        - wick_width: Width of the chandelier's wicks.
        - wick_style: Style of the chandelier's wicks.
        - alpha: Transparency level of the candle colors.
        - colors: Optional list of colors for dynamic gradient.
        - df: Optional DataFrame to initialize ChandelierSeries with historical data.

        Returns:
        - ChandelierSeries: A newly created ChandelierSeries object.
        """
        if df.empty: 
            if not self.candle_data.empty:
                df = self.candle_data
        # Initialize ChandelierSeries with provided parameters
       
        if len(df) > 1:
            
            chandelier_series = ChandelierSeries(
                chart=self,  # Assuming `self` is the chart or manager handling ChandelierSeries
                interval=interval,
                wick_width=wick_width,
                wick_style=wick_style,
                alpha=alpha,
                colors=colors,
                df=df  # Pass initial DataFrame if needed
            )
            return chandelier_series

    def create_candle_bar(
            self,chart, name: str = '', up_color: str = '#26a69a', down_color: str = '#ef5350',
            open_visible: bool = True, thin_bars: bool = True, price_line: bool = True, 
            price_label: bool = True, price_scale_id: Optional[str] = None
        ) -> CandleBar:
        """
        Creates and returns a CandleBar object.
        """
        return CandleBar(
            chart=self, name=name, up_color=up_color, down_color=down_color, 
            open_visible=open_visible, thin_bars=thin_bars
        ) 
    def create_volume_profile(self, side: str = 'left', sections: int = 10, width: float = 0.1,
                          up_color: str = 'rgba(0,255,0,0.333)', down_color: str = 'rgba(255,0,0,0.333)',
                          border_up_color: str = 'rgba(0,255,0,1)', border_down_color: str = 'rgba(255,0,0,1)',
                          fibonacci_profile: bool = False, fibonacci_levels: bool = False,start_index: Optional[int]= None, 
                          end_index: Optional[int]= None):
        """
        Creates a VolumeProfile for the specified series on this chart.

        :param side: Boolean indicating the side to render the profile on (True for left, False for right).
        :param sections: Number of sections in the volume profile.
        :param width: Width of each section.
        :param up_color: The color for upward volume.
        :param down_color: The color for downward volume.
        :param border_up_color: The border color for upward volume bars.
        :param border_down_color: The border color for downward volume bars.
        :return: VolumeProfile instance associated with the specified series.
        """
        print(f"[create_volume_profile] side: {side}, sections: {sections}, width: {width}, up_color: {up_color},\
              down_color: {down_color}, border_up_color: {border_up_color}, border_down_color: {border_down_color}")
        # Create and return a new VolumeProfile instance with all parameters
        return VolumeProfile(self, side, sections, width, up_color, down_color, border_up_color, 
                             border_down_color, fibonacci_profile, fibonacci_levels, start_index, end_index)

    def create_delta_profile(self, side: str ='right', up_color: str = 'rgba(0,255,0,1)', down_color: str = 'rgba(255,0,0,1)'):
        """
        Creates a DeltaProfile for the specified series on this chart.
        
        :param section_size: The number of sections (bins) in the delta profile.
        :param side: The side ('right' or 'left') to display the delta profile.
        :return: DeltaProfile instance associated with the specified series.
        """
        # Create and return a new DeltaProfile instance for the specified series
        return DeltaProfile(self, side, up_color, down_color)

    def lines(self) -> List[Line]:
        """
        Returns all lines for the chart.
        """
        return self._lines.copy()

    def set_visible_range(self, start_time: TIME, end_time: TIME):
        self.run_script(f'''
        {self.id}.chart.timeScale().setVisibleRange({{
            from: {pd.to_datetime(start_time).timestamp()},
            to: {pd.to_datetime(end_time).timestamp()}
        }})
        ''')

    def resize(self, width: Optional[float] = None, height: Optional[float] = None):
        """
        Resizes the chart within the window.
        Dimensions should be given as a float between 0 and 1.
        """
        self._width = width if width is not None else self._width
        self._height = height if height is not None else self._height
        self.run_script(f'''
        {self.id}.scale.width = {self._width}
        {self.id}.scale.height = {self._height}
        {self.id}.reSize()
        ''')

    def time_scale(self, right_offset: int = 0, min_bar_spacing: float = 0.5,
                   visible: bool = True, time_visible: bool = True, seconds_visible: bool = False,
                   border_visible: bool = True, border_color: Optional[str] = None):
        """
        Options for the timescale of the chart.
        """
        self.run_script(f'''{self.id}.chart.applyOptions({{timeScale: {js_json(locals())}}})''')

    def layout(self, background_color: str = '#000000', text_color: Optional[str] = None,
               font_size: Optional[int] = None, font_family: Optional[str] = None):
        """
        Global layout options for the chart.
        """
        self.run_script(f"""
            document.getElementById('container').style.backgroundColor = '{background_color}'
            {self.id}.chart.applyOptions({{
            layout: {{
                background: {{color: "{background_color}"}},
                {f'textColor: "{text_color}",' if text_color else ''}
                {f'fontSize: {font_size},' if font_size else ''}
                {f'fontFamily: "{font_family}",' if font_family else ''}
            }}}})""")

    def grid(self, vert_enabled: bool = True, horz_enabled: bool = True,
             color: str = 'rgba(29, 30, 38, 5)', style: LINE_STYLE = 'solid'):
        """
        Grid styling for the chart.
        """
        self.run_script(f"""
           {self.id}.chart.applyOptions({{
           grid: {{
               vertLines: {{
                   visible: {jbool(vert_enabled)},
                   color: "{color}",
                   style: {as_enum(style, LINE_STYLE)},
               }},
               horzLines: {{
                   visible: {jbool(horz_enabled)},
                   color: "{color}",
                   style: {as_enum(style, LINE_STYLE)},
               }},
           }}
           }})""")

    def crosshair(
        self,
        mode: CROSSHAIR_MODE = 'normal',
        vert_visible: bool = True,
        vert_width: int = 1,
        vert_color: Optional[str] = None,
        vert_style: LINE_STYLE = 'large_dashed',
        vert_label_background_color: str = 'rgb(46, 46, 46)',
        horz_visible: bool = True,
        horz_width: int = 1,
        horz_color: Optional[str] = None,
        horz_style: LINE_STYLE = 'large_dashed',
        horz_label_background_color: str = 'rgb(55, 55, 55)'
    ):
        """
        Crosshair formatting for its vertical and horizontal axes.
        """
        self.run_script(f'''
        {self.id}.chart.applyOptions({{
            crosshair: {{
                mode: {as_enum(mode, CROSSHAIR_MODE)},
                vertLine: {{
                    visible: {jbool(vert_visible)},
                    width: {vert_width},
                    {f'color: "{vert_color}",' if vert_color else ''}
                    style: {as_enum(vert_style, LINE_STYLE)},
                    labelBackgroundColor: "{vert_label_background_color}"
                }},
                horzLine: {{
                    visible: {jbool(horz_visible)},
                    width: {horz_width},
                    {f'color: "{horz_color}",' if horz_color else ''}
                    style: {as_enum(horz_style, LINE_STYLE)},
                    labelBackgroundColor: "{horz_label_background_color}"
                }}
            }}
        }})''')

    def watermark(self, text: str, font_size: int = 44, color: str = 'rgba(180, 180, 200, 0.5)'):
        """
        Adds a watermark to the chart.
        """
        self.run_script(f'''
          {self.id}.chart.applyOptions({{
              watermark: {{
                  visible: true,
                  horzAlign: 'center',
                  vertAlign: 'center',
                  ...{js_json(locals())}
              }}
          }})''')

    def legend(self, visible: bool = False, ohlc: bool = True, percent: bool = True, lines: bool = True,
               color: str = 'rgb(191, 195, 203)', font_size: int = 11, font_family: str = 'Monaco',
               text: str = '', color_based_on_candle: bool = False):
        """
        Configures the legend of the chart.
        """
        l_id = f'{self.id}.legend'
        if not visible:
            self.run_script(f'''
            {l_id}.div.style.display = "none"
            {l_id}.ohlcEnabled = false
            {l_id}.percentEnabled = false
            {l_id}.linesEnabled = false
            ''')
            return
        self.run_script(f'''
        {l_id}.div.style.display = 'flex'
        {l_id}.ohlcEnabled = {jbool(ohlc)}
        {l_id}.percentEnabled = {jbool(percent)}
        {l_id}.linesEnabled = {jbool(lines)}
        {l_id}.colorBasedOnCandle = {jbool(color_based_on_candle)}
        {l_id}.div.style.color = '{color}'
        {l_id}.color = '{color}'
        {l_id}.div.style.fontSize = '{font_size}px'
        {l_id}.div.style.fontFamily = '{font_family}'
        {l_id}.text.innerText = '{text}'
        ''')

    def spinner(self, visible):
        self.run_script(f"{self.id}.spinner.style.display = '{'block' if visible else 'none'}'")

    def hotkey(self, modifier_key: Literal['ctrl', 'alt', 'shift', 'meta', None],
               keys: Union[str, tuple, int], func: Callable):
        if not isinstance(keys, tuple):
            keys = (keys,)
        for key in keys:
            key = str(key)
            if key.isalnum() and len(key) == 1:
                key_code = f'Digit{key}' if key.isdigit() else f'Key{key.upper()}'
                key_condition = f'event.code === "{key_code}"'
            else:
                key_condition = f'event.key === "{key}"'
            if modifier_key is not None:
                key_condition += f'&& event.{modifier_key}Key'

            self.run_script(f'''
                    {self.id}.commandFunctions.unshift((event) => {{
                        if ({key_condition}) {{
                            event.preventDefault()
                            window.callbackFunction(`{modifier_key, keys}_~_{key}`)
                            return true
                        }}
                        else return false
                    }})''')
        self.win.handlers[f'{modifier_key, keys}'] = func

    def create_table(
        self,
        width: NUM,
        height: NUM,
        headings: tuple,
        widths: Optional[tuple] = None,
        alignments: Optional[tuple] = None,
        position: FLOAT = 'left',
        draggable: bool = False,
        background_color: str = '#121417',
        border_color: str = 'rgb(70, 70, 70)',
        border_width: int = 1,
        heading_text_colors: Optional[tuple] = None,
        heading_background_colors: Optional[tuple] = None,
        return_clicked_cells: bool = False,
        func: Optional[Callable] = None
    ) -> Table:
        args = locals()
        del args['self']
        return self.win.create_table(*args.values())

    def screenshot(self) -> bytes:
        """
        Takes a screenshot. This method can only be used after the chart window is visible.
        :return: a bytes object containing a screenshot of the chart.
        """
        serial_data = self.win.run_script_and_get(f'{self.id}.chart.takeScreenshot().toDataURL()')
        return b64decode(serial_data.split(',')[1])

    def create_subchart(self, position: FLOAT = 'left', width: float = 0.5, height: float = 0.5,
                        sync: Optional[Union[str, bool]] = None, scale_candles_only: bool = False,
                        sync_crosshairs_only: bool = False,
                        toolbox: bool = False) -> 'AbstractChart':
        if sync is True:
            sync = self.id
        args = locals()
        del args['self']
        return self.win.create_subchart(*args.values())
