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
      this.chart.setOption(option, true)
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
    if (chartType === "sunburst") {
      const tree = data.tree || { name: "Data", value: 0, children: [] }
      return {
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
            data: data.values || [],
            itemStyle: {
              color: "#3b82f6",
            },
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
            itemStyle: { color: "#ef4444" },
            smooth: true,
          },
          {
            name: "Income",
            type: "line",
            data: data.income || [],
            itemStyle: { color: "#10b981" },
            smooth: true,
          },
          {
            name: "Net Worth",
            type: "line",
            data: data.net_worth || [],
            itemStyle: { color: "#3b82f6" },
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
            data: data.income || [],
            itemStyle: { color: "#10b981" },
          },
          {
            name: "Expenses",
            type: "bar",
            stack: "total",
            data: data.expenses || [],
            itemStyle: { color: "#ef4444" },
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
      return {
        series: [
          {
            type: "treemap",
            data: [tree],
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
            },
            emphasis: {
              itemStyle: {
                borderColor: "#333",
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
