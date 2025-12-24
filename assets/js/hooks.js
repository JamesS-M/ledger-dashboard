// LiveView hooks for chart initialization
import * as echarts from "echarts"

// Global chart registry to link charts together
const chartRegistry = new Map()

// Helper function to handle brush selection and update sunburst charts
function handleBrushSelection(params, hook, transactions, dates) {
  if (!params || !params.areas || params.areas.length === 0) {
    // No selection, show all data
    hook.hasActiveBrush = false
    hook.currentHoverMonth = null
    updateSunburstCharts(hook.linkedSunburstIds, null)
    return
  }
  
  const area = params.areas[0]
  if (!area || !area.coordRange) {
    hook.hasActiveBrush = false
    hook.currentHoverMonth = null
    updateSunburstCharts(hook.linkedSunburstIds, null)
    return
  }
  
  hook.hasActiveBrush = true
  
  // Get selected month range
  const [startIndex, endIndex] = area.coordRange[0]
  const startMonth = dates[Math.floor(startIndex)]
  const endMonth = dates[Math.ceil(endIndex)]
  
  // Filter transactions by month range
  const filteredTransactions = transactions.filter(t => {
    if (!t) return false
    // Use month field if available, otherwise extract from date
    const tMonth = t.month || (t.date ? (typeof t.date === 'string' ? t.date.substring(0, 7) : String(t.date).substring(0, 7)) : null)
    if (!tMonth) return false
    return tMonth >= startMonth && tMonth <= endMonth
  })
  
  // Update sunburst charts with filtered data
  updateSunburstCharts(hook.linkedSunburstIds, filteredTransactions)
}

// Helper function to update sunburst charts with filtered transactions
function updateSunburstCharts(sunburstIds, filteredTransactions) {
  if (!sunburstIds || sunburstIds.length === 0) {
    console.log("updateSunburstCharts: No sunburst IDs provided")
    return
  }
  
  console.log(`updateSunburstCharts: Updating ${sunburstIds.length} charts with ${filteredTransactions ? filteredTransactions.length : 0} transactions`)
  
  sunburstIds.forEach(sunburstId => {
    const registryEntry = chartRegistry.get(sunburstId)
    if (!registryEntry || !registryEntry.chart) {
      console.warn(`updateSunburstCharts: No registry entry for ${sunburstId}`)
      return
    }
    
    let treeData
    if (filteredTransactions === null || filteredTransactions.length === 0) {
      // Show all data - restore original
      const originalData = registryEntry.originalData || registryEntry.data
      treeData = originalData.tree
      console.log(`Restoring original data for ${sunburstId}:`, treeData)
    } else {
      // Recalculate from filtered transactions
      console.log(`Calculating tree for ${sunburstId} from ${filteredTransactions.length} transactions`)
      if (sunburstId === "expense-breakdown") {
        treeData = calculateExpenseTree(filteredTransactions)
      } else if (sunburstId === "income-breakdown") {
        treeData = calculateIncomeTree(filteredTransactions)
      } else {
        console.warn(`Unknown sunburst ID: ${sunburstId}`)
        return
      }
      console.log(`Calculated tree for ${sunburstId}:`, treeData)
      
      // If the filtered tree is empty (no data for this type in this period),
      // restore the original data instead of showing blank
      if (treeData && treeData.value === 0 && (!treeData.children || treeData.children.length === 0)) {
        console.log(`No data for ${sunburstId} in filtered period, restoring original`)
        const originalData = registryEntry.originalData || registryEntry.data
        treeData = originalData.tree
      }
    }
    
    // Ensure treeData is valid
    if (!treeData || !treeData.name) {
      console.warn(`Invalid treeData for ${sunburstId}:`, treeData)
      // Use empty tree instead
      treeData = {
        name: sunburstId.includes("expense") ? "Expenses" : "Income",
        value: 0,
        children: []
      }
    }
    
    // Update chart - preserve all series properties and only update data
    const currentOption = registryEntry.chart.getOption()
    const currentSeries = currentOption.series && currentOption.series[0] ? currentOption.series[0] : {}
    
    // Preserve all series properties (type, radius, label, etc.) and only update data
    const updatedSeries = {
      ...currentSeries,
      data: [treeData]
    }
    
    const option = {
      series: [updatedSeries]
    }
    
    console.log(`Updating chart ${sunburstId} with treeData value: ${treeData.value}, children: ${treeData.children ? treeData.children.length : 0}`)
    if (treeData.children && treeData.children.length > 0) {
      console.log(`First child:`, treeData.children[0])
    }
    
    // Use notMerge: false to merge with existing options, preserving colors and other config
    registryEntry.chart.setOption(option, { notMerge: false, replaceMerge: ['series'] })
    
    // Force a resize to ensure the chart updates
    registryEntry.chart.resize()
  })
}

// Calculate expense tree from transactions
function calculateExpenseTree(transactions) {
  if (!transactions || transactions.length === 0) {
    return { name: "Expenses", value: 0, children: [] }
  }
  
  console.log("calculateExpenseTree: Sample transaction:", transactions[0])
  
  const expenseTransactions = transactions.filter(t => 
    t && t.account && t.account.startsWith("Expenses")
  )
  
  console.log(`calculateExpenseTree: Found ${expenseTransactions.length} expense transactions out of ${transactions.length} total`)
  
  if (expenseTransactions.length === 0) {
    console.log("calculateExpenseTree: No expense transactions found. Sample accounts:", 
      transactions.slice(0, 5).map(t => t.account))
    return { name: "Expenses", value: 0, children: [] }
  }
  
  const categoryMap = new Map()
  
  expenseTransactions.forEach(t => {
    const account = t.account
    const amount = Math.abs(t.amount || 0)
    
    if (amount > 0 && account && account.includes(":")) {
      const parts = account.split(":").slice(1) // Remove "Expenses" prefix
      const categoryPath = parts.join(":")
      
      if (categoryPath) {
        const current = categoryMap.get(categoryPath) || 0
        categoryMap.set(categoryPath, current + amount)
      }
    } else {
      console.log("calculateExpenseTree: Skipping transaction:", { account, amount, hasColon: account && account.includes(":") })
    }
  })
  
  console.log(`calculateExpenseTree: Category map has ${categoryMap.size} entries:`, Array.from(categoryMap.entries()).slice(0, 5))
  
  if (categoryMap.size === 0) {
    return { name: "Expenses", value: 0, children: [] }
  }
  
  const tree = buildHierarchyTree(categoryMap, "Expenses")
  console.log("calculateExpenseTree: Built tree:", tree)
  return tree
}

// Calculate income tree from transactions
function calculateIncomeTree(transactions) {
  if (!transactions || transactions.length === 0) {
    return { name: "Income", value: 0, children: [] }
  }
  
  console.log("calculateIncomeTree: Sample transaction:", transactions[0])
  
  const incomeTransactions = transactions.filter(t => 
    t && t.account && t.account.startsWith("Income")
  )
  
  console.log(`calculateIncomeTree: Found ${incomeTransactions.length} income transactions out of ${transactions.length} total`)
  
  if (incomeTransactions.length === 0) {
    console.log("calculateIncomeTree: No income transactions found. Sample accounts:", 
      transactions.slice(0, 5).map(t => t.account))
    return { name: "Income", value: 0, children: [] }
  }
  
  const categoryMap = new Map()
  
  incomeTransactions.forEach(t => {
    const account = t.account
    const amount = Math.abs(t.amount || 0)
    
    if (amount > 0 && account && account.includes(":")) {
      const parts = account.split(":").slice(1) // Remove "Income" prefix
      const categoryPath = parts.join(":")
      
      if (categoryPath) {
        const current = categoryMap.get(categoryPath) || 0
        categoryMap.set(categoryPath, current + amount)
      }
    } else {
      console.log("calculateIncomeTree: Skipping transaction:", { account, amount, hasColon: account && account.includes(":") })
    }
  })
  
  console.log(`calculateIncomeTree: Category map has ${categoryMap.size} entries:`, Array.from(categoryMap.entries()).slice(0, 5))
  
  if (categoryMap.size === 0) {
    return { name: "Income", value: 0, children: [] }
  }
  
  const tree = buildHierarchyTree(categoryMap, "Income")
  console.log("calculateIncomeTree: Built tree:", tree)
  return tree
}

// Build hierarchical tree structure from flat category map
function buildHierarchyTree(categoryMap, rootName) {
  const tree = {}
  
  categoryMap.forEach((amount, path) => {
    const parts = path.split(":")
    let current = tree
    
    parts.forEach((part, index) => {
      if (!current[part]) {
        current[part] = index === parts.length - 1 ? amount : {}
      } else if (index === parts.length - 1) {
        // Leaf node - add to existing value
        if (typeof current[part] === "number") {
          current[part] += amount
        } else {
          current[part]._value = (current[part]._value || 0) + amount
        }
      }
      current = typeof current[part] === "object" ? current[part] : {}
    })
  })
  
  return convertToSunburstFormat(tree, rootName)
}

// Convert nested object to sunburst format
function convertToSunburstFormat(tree, rootName) {
  if (!tree || Object.keys(tree).length === 0) {
    return {
      name: rootName,
      value: 0,
      children: []
    }
  }
  
  const children = []
  let totalValue = 0
  
  Object.entries(tree).forEach(([name, valueOrChildren]) => {
    if (typeof valueOrChildren === "number") {
      if (valueOrChildren > 0) {
        children.push({ name, value: valueOrChildren })
        totalValue += valueOrChildren
      }
    } else if (typeof valueOrChildren === "object" && valueOrChildren !== null) {
      // Check if this node has both a direct value (_value) and children
      const directValue = valueOrChildren._value || 0
      const childMap = { ...valueOrChildren }
      delete childMap._value
      
      const childTree = convertToSunburstFormat(childMap, name)
      const childValue = childTree.value || 0
      const combinedValue = directValue + childValue
      
      if (combinedValue > 0) {
        totalValue += combinedValue
        children.push({
          name,
          value: combinedValue,
          children: childTree.children || []
        })
      }
    }
  })
  
  return {
    name: rootName,
    value: totalValue,
    children: children.filter(c => c.value > 0)
  }
}

export const ChartHook = {
  mounted() {
    const chartType = this.el.dataset.chartType
    const chartData = JSON.parse(this.el.dataset.chartData || "{}")
    const chartId = this.el.id
    const linkedSunburstIds = this.el.dataset.linkedSunburstIds
      ? JSON.parse(this.el.dataset.linkedSunburstIds)
      : []

    const container = this.el.querySelector(".chart-container")
    if (!container) {
      console.error("Chart container not found")
      return
    }

    // Store chart metadata
    this.chartId = chartId
    this.linkedSunburstIds = linkedSunburstIds

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
    const option = this.getChartConfig(chartType, chartData, this)
    this.chart.setOption(option)
    
    // Register chart for linking
    if (this.chartId) {
      chartRegistry.set(this.chartId, {
        chart: this.chart,
        hook: this,
        type: chartType,
        data: chartData
      })
    }

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
      const option = this.getChartConfig(chartType, chartData, this)
      // Use replaceMerge to ensure borderRadius is properly updated when series visibility changes
      this.chart.setOption(option, { replaceMerge: ['series'] })
      
      // Update stored data
      if (this.chartId) {
        const registryEntry = chartRegistry.get(this.chartId)
        if (registryEntry) {
          registryEntry.data = chartData
        }
      }
    }
  },

  destroyed() {
    if (this.handleResize) {
      window.removeEventListener("resize", this.handleResize)
    }
    if (this.chart) {
      this.chart.dispose()
    }
    // Remove from registry
    if (this.chartId) {
      chartRegistry.delete(this.chartId)
    }
  },


  getChartConfig(chartType, data, hook) {
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
      
      // Store original data for restoration
      if (hook && hook.chartId) {
        const registryEntry = chartRegistry.get(hook.chartId)
        if (registryEntry) {
          registryEntry.originalData = { tree }
        }
      }
      
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

    if (chartType === "category_lines") {
      const dates = data.dates || []
      const series = data.series || []
      const transactions = data.transactions || []
      
      // Generate colors for each category using the positive palette
      const categorySeries = series.map((cat, index) => {
        const color = positivePalette[index % positivePalette.length]
        return {
          name: cat.name,
          type: "line",
          data: cat.data || [],
          smooth: true,
          itemStyle: { color: color },
          lineStyle: { color: color, width: 2 },
          symbol: "circle",
          symbolSize: 6,
        }
      })
      
      const config = {
        xAxis: {
          type: "category",
          data: dates,
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
        axisPointer: {
          show: true,
          type: "line",
          snap: true,
        },
        series: categorySeries,
        tooltip: {
          trigger: "axis",
          formatter: function (params) {
            let result = params[0].name + "<br/>"
            params.forEach(function (param) {
              if (param.value !== null && param.value !== undefined && param.value !== 0) {
                result += `${param.seriesName}: $${param.value.toFixed(2)}<br/>`
              }
            })
            return result
          },
        },
        legend: {
          data: series.map((s) => s.name),
          top: 10,
          type: "scroll",
          orient: "horizontal",
        },
        grid: {
          left: "3%",
          right: "4%",
          bottom: "15%",
          top: "15%",
          containLabel: true,
        },
        brush: {
          id: "category_lines_brush",
          xAxisIndex: 0,
          brushType: "lineX",
          brushMode: "single",
          transformable: true,
          brushStyle: {
            borderWidth: 1,
            color: "rgba(120,140,180,0.3)",
            borderColor: "rgba(120,140,180,0.8)",
          },
        },
      }
      
      // Store transactions for filtering
      if (hook) {
        hook.allTransactions = transactions
        hook.allDates = dates
      }
      
      // Add brush selection and hover event handlers
      if (hook && hook.linkedSunburstIds && hook.linkedSunburstIds.length > 0) {
        setTimeout(() => {
          // Track brush state
          hook.hasActiveBrush = false
          
          // Handle brush selection (drag to select range)
          hook.chart.on("brush", function (params) {
            hook.hasActiveBrush = params && params.areas && params.areas.length > 0
            handleBrushSelection(params, hook, transactions, dates)
          })
          
          hook.chart.on("brushEnd", function (params) {
            hook.hasActiveBrush = params && params.areas && params.areas.length > 0
            handleBrushSelection(params, hook, transactions, dates)
          })
          
          // Use ECharts built-in updateAxisPointer event (like the example)
          hook.chart.on("updateAxisPointer", function (event) {
            // Only update if there's no active brush selection
            if (hook.hasActiveBrush) {
              return
            }
            
            const xAxisInfo = event.axesInfo && event.axesInfo[0]
            if (xAxisInfo && xAxisInfo.value !== undefined) {
              const monthIndex = Math.round(xAxisInfo.value)
              const hoverMonth = dates[monthIndex]
              
              console.log("updateAxisPointer:", {
                value: xAxisInfo.value,
                monthIndex,
                hoverMonth,
                totalDates: dates.length,
                totalTransactions: transactions.length
              })
              
              if (hoverMonth) {
                // Filter transactions to this specific month
                const filteredTransactions = transactions.filter(t => {
                  if (!t) return false
                  
                  // Try month field first
                  if (t.month) {
                    const tMonth = typeof t.month === 'string' ? t.month : String(t.month)
                    return tMonth === hoverMonth
                  }
                  
                  // Fallback: extract month from date if month field not available
                  if (t.date) {
                    const dateStr = typeof t.date === 'string' ? t.date : String(t.date)
                    const monthFromDate = dateStr.substring(0, 7) // "YYYY-MM-DD" -> "YYYY-MM"
                    return monthFromDate === hoverMonth
                  }
                  
                  return false
                })
                
                console.log(`Filtered to ${filteredTransactions.length} transactions for month ${hoverMonth}`)
                if (filteredTransactions.length > 0) {
                  console.log("Sample filtered transaction:", filteredTransactions[0])
                } else {
                  console.log("Sample original transaction:", transactions[0])
                  console.log("Available months in transactions:", 
                    [...new Set(transactions.map(t => t.month || (t.date ? t.date.substring(0, 7) : null)))]
                  )
                }
                
                updateSunburstCharts(hook.linkedSunburstIds, filteredTransactions)
              }
            }
          })
          
          // Restore original data when mouse leaves chart area
          hook.chart.on("globalout", function () {
            // Only restore if there's no active brush selection
            if (!hook.hasActiveBrush) {
              updateSunburstCharts(hook.linkedSunburstIds, null)
            }
          })
        }, 100)
      }
      
      return config
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
