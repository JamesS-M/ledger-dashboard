// LiveView hooks for chart initialization
import * as echarts from "echarts"

export const ChartHook = {
  mounted() {
    const chartType = this.el.dataset.chartType
    const chartData = JSON.parse(this.el.dataset.chartData || "{}")

    const container = this.el.querySelector(".chart-container")
    if (!container) {
      console.error("Chart container not found")
      return
    }

    // Ensure container has dimensions before initializing
    requestAnimationFrame(() => {
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        setTimeout(() => {
          this.initializeChart(container, chartType, chartData)
        }, 100)
      } else {
        this.initializeChart(container, chartType, chartData)
      }
    })
  },

  initializeChart(container, chartType, chartData) {
    // Double-check dimensions before initializing
    if (container.clientWidth === 0 || container.clientHeight === 0) {
      console.warn("Chart container has no dimensions, retrying...")
      setTimeout(() => {
        this.initializeChart(container, chartType, chartData)
      }, 50)
      return
    }

    // Dispose existing chart if any
    if (this.chart) {
      this.chart.dispose()
    }

    this.chart = echarts.init(container)
    const option = this.getChartConfig(chartType, chartData)
    this.chart.setOption(option)

    // Handle legend click to update borderRadius when series visibility changes
    if (chartType === "stacked_bar") {
      this.chart.on("legendselectchanged", () => {
        // Get current option to see which series are visible
        const currentOption = this.chart.getOption()
        const series = currentOption.series || []
        
        // Find visible series in stack order (last in array is on top)
        const visibleSeries = series
          .map((s, index) => ({ ...s, originalIndex: index }))
          .filter((s) => !s.hidden)
        
        if (visibleSeries.length === 0) return
        
        // The last visible series is on top, first is on bottom
        const topSeriesIndex = visibleSeries[visibleSeries.length - 1].originalIndex
        const bottomSeriesIndex = visibleSeries[0].originalIndex
        const isSingleBar = visibleSeries.length === 1
        
        // Update all series with appropriate borderRadius
        const updatedSeries = series.map((s, index) => {
          if (!s.data || s.hidden) return s
          
          const isTop = index === topSeriesIndex
          
          return {
            ...s,
            data: s.data.map((item) => {
              // Only the top bar gets rounded corners (top only, bottom is always 0)
              const borderRadius = isTop ? [8, 8, 0, 0] : [0, 0, 0, 0]
              
              return {
                ...item,
                itemStyle: {
                  ...item.itemStyle,
                  borderRadius,
                },
              }
            }),
          }
        })
        
        this.chart.setOption({ series: updatedSeries }, { replaceMerge: ["series"] })
      })
    }

    // Handle window resize
    this.handleResize = () => {
      if (this.chart) {
        this.chart.resize()
      }
    }
    window.addEventListener("resize", this.handleResize)
  },

  updated() {
    const container = this.el.querySelector(".chart-container")
    if (!container) {
      return
    }

    const chartData = JSON.parse(this.el.dataset.chartData || "{}")
    const chartType = this.el.dataset.chartType

    // If chart doesn't exist or was disposed, re-initialize
    if (!this.chart || this.chart.isDisposed()) {
      requestAnimationFrame(() => {
        this.initializeChart(container, chartType, chartData)
      })
    } else {
      // Update existing chart
      const option = this.getChartConfig(chartType, chartData)
      // Use replaceMerge to ensure borderRadius is properly updated when series visibility changes
      this.chart.setOption(option, { replaceMerge: ['series'] })
    }
  },

  destroyed() {
    if (this.handleResize) {
      window.removeEventListener("resize", this.handleResize)
    }
    if (this.chart) {
      this.chart.dispose()
    }
  },

  getChartConfig(chartType, data) {
    // Tailwind color palette
    const tailwindBlue = [
      "#3b82f6", // blue-500
      "#2563eb", // blue-600
      "#1d4ed8", // blue-700
      "#1e40af", // blue-800
      "#1e3a8a", // blue-900
    ]
    const tailwindSlate = [
      "#64748b", // slate-500
      "#475569", // slate-600
      "#334155", // slate-700
      "#1e293b", // slate-800
      "#0f172a", // slate-900
    ]
    const tailwindRed = [
      "#ef4444", // red-500
      "#dc2626", // red-600
      "#b91c1c", // red-700
      "#991b1b", // red-800
      "#7f1d1d", // red-900
    ]
    // Combined blue/slate palette for positive values
    const positivePalette = [
      ...tailwindBlue,
      ...tailwindSlate,
      "#60a5fa", // blue-400
      "#93c5fd", // blue-300
      "#818cf8", // indigo-400
      "#a78bfa", // violet-400
    ]

    if (chartType === "sunburst") {
      const tree = data.tree || { name: "Data", value: 0, children: [] }
      return {
        color: positivePalette,
        series: [
          {
            type: "sunburst",
            data: [tree],
            radius: [0, "90%"],
            label: {
              show: true,
              formatter: function (params) {
                return params.name
              },
            },
            itemStyle: {
              borderColor: "#fff",
              borderWidth: 2,
              borderRadius: 4, // Slight rounding for sunburst segments
            },
            emphasis: {
              focus: "ancestor",
            },
            levels: [
              {},
              {
                r0: "15%",
                r: "35%",
                itemStyle: {
                  borderWidth: 2,
                },
                label: {
                  rotate: "tangential",
                },
              },
              {
                r0: "35%",
                r: "70%",
                label: {
                  align: "right",
                },
              },
              {
                r0: "70%",
                r: "90%",
                label: {
                  position: "outside",
                  padding: 3,
                  silent: false,
                },
                itemStyle: {
                  borderWidth: 3,
                },
              },
            ],
          },
        ],
        tooltip: {
          trigger: "item",
          formatter: function (params) {
            const value = params.value || 0
            const name = params.name || "Unknown"
            return `${name}<br/>$${value.toFixed(2)}`
          },
        },
      }
    }

    if (chartType === "bar") {
      return {
        xAxis: {
          type: "category",
          data: data.labels || [],
        },
        yAxis: {
          type: "value",
          axisLabel: {
            formatter: function (value) {
              return "$" + value.toFixed(2)
            },
          },
        },
        series: [
          {
            type: "bar",
            barBorderRadius: [8, 8, 0, 0], // Top-left, top-right, bottom-right, bottom-left
            data: (data.values || []).map((val) => {
              return {
                value: val,
                itemStyle: {
                  color: val < 0 ? tailwindRed[0] : tailwindBlue[0], // red-500 for negative, blue-500 for positive
                  borderRadius: [8, 8, 0, 0],
                },
              }
            }),
          },
        ],
        tooltip: {
          trigger: "axis",
          formatter: function (params) {
            const param = params[0]
            return `${param.name}<br/>$${param.value.toFixed(2)}`
          },
        },
      }
    }

    if (chartType === "line") {
      return {
        xAxis: {
          type: "category",
          data: data.dates || [],
          boundaryGap: false,
        },
        yAxis: {
          type: "value",
          axisLabel: {
            formatter: function (value) {
              return "$" + value.toFixed(2)
            },
          },
        },
        series: [
          {
            name: "Expenses",
            type: "line",
            data: data.expenses || [],
            itemStyle: { color: tailwindRed[0] }, // red-500
            lineStyle: { color: tailwindRed[0] },
            smooth: true,
          },
          {
            name: "Income",
            type: "line",
            data: data.income || [],
            itemStyle: { color: tailwindBlue[0] }, // blue-500
            lineStyle: { color: tailwindBlue[0] },
            smooth: true,
          },
          {
            name: "Net Worth",
            type: "line",
            data: data.net_worth || [],
            itemStyle: { color: tailwindSlate[1] }, // slate-600
            lineStyle: { color: tailwindSlate[1] },
            smooth: true,
          },
        ],
        tooltip: {
          trigger: "axis",
          formatter: function (params) {
            let result = params[0].name + "<br/>"
            params.forEach(function (param) {
              result += `${param.seriesName}: $${param.value.toFixed(2)}<br/>`
            })
            return result
          },
        },
        legend: {
          data: ["Expenses", "Income", "Net Worth"],
          top: 10,
        },
      }
    }

    if (chartType === "stacked_bar") {
      // Helper function to determine initial borderRadius based on position in stack
      const getInitialBorderRadius = (seriesIndex, totalSeries, hasValue) => {
        if (!hasValue) return [0, 0, 0, 0]
        
        const isLast = seriesIndex === totalSeries - 1
        
        // Only the top bar (last in stack) gets rounded top corners
        // Bottom is always 0 (never rounded)
        return isLast ? [8, 8, 0, 0] : [0, 0, 0, 0]
      }
      
      const incomeData = data.income || []
      const expensesData = data.expenses || []
      const totalSeries = 2 // Income and Expenses
      
      return {
        xAxis: {
          type: "category",
          data: data.months || [],
        },
        yAxis: {
          type: "value",
          axisLabel: {
            formatter: function (value) {
              return "$" + value.toFixed(2)
            },
          },
        },
        series: [
          {
            name: "Income",
            type: "bar",
            stack: "total",
            data: incomeData.map((val) => {
              return {
                value: val,
                itemStyle: {
                  color: tailwindBlue[0], // blue-500
                  borderRadius: getInitialBorderRadius(0, totalSeries, val > 0),
                },
              }
            }),
          },
          {
            name: "Expenses",
            type: "bar",
            stack: "total",
            data: expensesData.map((val) => {
              return {
                value: val,
                itemStyle: {
                  color: tailwindRed[0], // red-500
                  borderRadius: getInitialBorderRadius(1, totalSeries, val > 0),
                },
              }
            }),
          },
        ],
        tooltip: {
          trigger: "axis",
          formatter: function (params) {
            let result = params[0].name + "<br/>"
            params.forEach(function (param) {
              result += `${param.seriesName}: $${param.value.toFixed(2)}<br/>`
            })
            return result
          },
        },
        legend: {
          data: ["Income", "Expenses"],
          top: 10,
        },
      }
    }

    if (chartType === "treemap") {
      const tree = data.tree || { name: "Data", value: 0, children: [] }
      // Helper function to assign colors based on account type
      const assignTreemapColors = (node) => {
        const result = { ...node }
        // Use red for liabilities, blue for assets
        if (result.name === "Liabilities") {
          result.itemStyle = { color: tailwindRed[1] } // red-600
        } else if (result.name === "Assets") {
          result.itemStyle = { color: tailwindBlue[1] } // blue-600
        } else if (result.name === "Financial Position") {
          result.itemStyle = { color: tailwindSlate[2] } // slate-700
        }
        
        if (result.children && result.children.length > 0) {
          result.children = result.children.map((child, index) => {
            const colored = assignTreemapColors(child)
            // If child doesn't have a color, assign from palette
            if (!colored.itemStyle) {
              colored.itemStyle = { 
                color: positivePalette[index % positivePalette.length],
                borderRadius: 8,
              }
            } else {
              // Ensure borderRadius is set even if color is already set
              colored.itemStyle.borderRadius = 8
            }
            return colored
          })
        }
        
        // Set borderRadius for root level items too
        if (result.itemStyle && !result.itemStyle.borderRadius) {
          result.itemStyle.borderRadius = 8
        }
        return result
      }
      const coloredTree = assignTreemapColors(tree)
      
      return {
        series: [
          {
            type: "treemap",
            data: [coloredTree],
            roam: false,
            nodeClick: "zoomToNode",
            breadcrumb: {
              show: true,
            },
            label: {
              show: true,
              formatter: function (params) {
                return params.name + "\n$" + params.value.toFixed(2)
              },
            },
            upperLabel: {
              show: true,
              height: 30,
            },
            itemStyle: {
              borderColor: "#fff",
              borderWidth: 2,
              gapWidth: 2,
              borderRadius: 8, // Rounded corners for treemap items
            },
            emphasis: {
              itemStyle: {
                borderColor: tailwindSlate[2], // slate-700
                borderRadius: 8,
              },
            },
          },
        ],
        tooltip: {
          trigger: "item",
          formatter: function (params) {
            const value = params.value || 0
            const name = params.name || "Unknown"
            return `${name}<br/>$${value.toFixed(2)}`
          },
        },
      }
    }

    // Default
    return {
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: [] }],
    }
  },
}
