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
    return
  }
  
  sunburstIds.forEach(sunburstId => {
    const registryEntry = chartRegistry.get(sunburstId)
    if (!registryEntry || !registryEntry.chart) {
      return
    }
    
    let treeData
    if (filteredTransactions === null || filteredTransactions.length === 0) {
      // Show all data - restore original
      const originalData = registryEntry.originalData || registryEntry.data
      treeData = originalData.tree
    } else {
      // Recalculate from filtered transactions
      if (sunburstId === "expense-breakdown") {
        treeData = calculateExpenseTree(filteredTransactions)
      } else if (sunburstId === "income-breakdown") {
        treeData = calculateIncomeTree(filteredTransactions)
      } else {
        return
      }
      
      // If the filtered tree is empty (no data for this type in this period),
      // restore the original data instead of showing blank
      if (treeData && treeData.value === 0 && (!treeData.children || treeData.children.length === 0)) {
        const originalData = registryEntry.originalData || registryEntry.data
        treeData = originalData.tree
      }
    }
    
    // Ensure treeData is valid
    if (!treeData || !treeData.name) {
      // Use empty tree instead
      treeData = {
        name: sunburstId.includes("expense") ? "Expenses" : "Income",
        value: 0,
        children: []
      }
    }
    
    // Get current option to preserve all settings
    const currentOption = registryEntry.chart.getOption()
    const currentSeries = currentOption.series && currentOption.series[0] ? currentOption.series[0] : {}
    
    // Update only the data, preserving all other series properties including the id
    // Use animationDurationUpdate and animationEasingUpdate for data updates
    const updatedSeries = {
      ...currentSeries,
      data: [treeData],
      animationDurationUpdate: 500,
      animationEasingUpdate: 'cubicOut'
    }
    
    const option = {
      animation: true,
      animationDuration: 500,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 500,
      animationEasingUpdate: 'cubicOut',
      series: [updatedSeries]
    }
    
    // Use notMerge: false to allow ECharts to merge and animate
    // The series id ensures ECharts matches the correct series for animation
    registryEntry.chart.setOption(option, { 
      notMerge: false,
      lazyUpdate: false
    })
  })
}

// Calculate expense tree from transactions
function calculateExpenseTree(transactions) {
  if (!transactions || transactions.length === 0) {
    return { name: "Expenses", value: 0, children: [] }
  }
  
  const expenseTransactions = transactions.filter(t => 
    t && t.account && t.account.startsWith("Expenses")
  )
  
  if (expenseTransactions.length === 0) {
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
    }
  })
  
  if (categoryMap.size === 0) {
    return { name: "Expenses", value: 0, children: [] }
  }
  
  const tree = buildHierarchyTree(categoryMap, "Expenses")
  return tree
}

// Calculate income tree from transactions
function calculateIncomeTree(transactions) {
  if (!transactions || transactions.length === 0) {
    return { name: "Income", value: 0, children: [] }
  }
  
  const incomeTransactions = transactions.filter(t => 
    t && t.account && t.account.startsWith("Income")
  )
  
  if (incomeTransactions.length === 0) {
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
    }
  })
  
  if (categoryMap.size === 0) {
    return { name: "Income", value: 0, children: [] }
  }
  
  const tree = buildHierarchyTree(categoryMap, "Income")
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
        // Create new node - if it's the final leaf, set amount directly, otherwise create object
        if (index === parts.length - 1) {
          current[part] = amount
        } else {
          current[part] = {}
        }
      } else if (index === parts.length - 1) {
        // Leaf node - add to existing value
        if (typeof current[part] === "number") {
          current[part] += amount
        } else {
          current[part]._value = (current[part]._value || 0) + amount
        }
      } else {
        // Intermediate node - if current[part] is a number, preserve it as _value
        if (typeof current[part] === "number") {
          current[part] = { _value: current[part] }
        }
      }
      
      // Descend into the node (now guaranteed to be an object)
      current = current[part]
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
      // Keep this error as it indicates a critical initialization failure
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
      setTimeout(() => {
        this.initializeChart(container, chartType, chartData)
      }, 50)
      return
    }

    // Dispose existing chart if any
    if (this.chart) {
      this.chart.dispose()
    }

    try {
      this.chart = echarts.init(container)
      const option = this.getChartConfig(chartType, chartData, this)
      
      console.log(`Initializing chart ${this.chartId} (${chartType}):`, {
        containerSize: `${container.clientWidth}x${container.clientHeight}`,
        hasOption: !!option,
        hasSeries: !!option?.series,
        seriesCount: Array.isArray(option?.series) ? option.series.length : 0,
        option: option
      })
      
      // Validate option before setting
      if (!option || !option.series) {
        console.error(`Invalid chart option for ${this.chartId}:`, option)
        return
      }
      
      // Validate series data
      if (Array.isArray(option.series)) {
        option.series.forEach((s, idx) => {
          if (!s.data || !Array.isArray(s.data)) {
            console.warn(`Series ${idx} for ${this.chartId} has invalid data:`, s)
          } else {
            console.log(`Series ${idx} (${s.name}) has ${s.data.length} data points`)
          }
        })
      }
      
      this.chart.setOption(option)
      console.log(`Chart ${this.chartId} initialized successfully`)
    } catch (error) {
      console.error(`Error initializing chart ${this.chartId}:`, error)
      console.error(`Chart type: ${chartType}, Data:`, chartData)
      return
    }
    
    // Register chart for linking
    if (this.chartId) {
      const dataHash = this.el.dataset.chartHash
      const updateKey = this.el.dataset.updateKey
      const registryEntry = {
        chart: this.chart,
        hook: this,
        type: chartType,
        data: chartData,
        dataHash: dataHash,
        updateKey: updateKey
      }
      // For sunburst charts, store originalData so brush selections can restore it
      if (chartType === "sunburst" && chartData.tree) {
        registryEntry.originalData = chartData
      }
      chartRegistry.set(this.chartId, registryEntry)
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
      console.warn(`Chart container not found for ${this.chartId}`)
      return
    }

    const chartData = JSON.parse(this.el.dataset.chartData || "{}")
    const chartType = this.el.dataset.chartType
    const newDataHash = this.el.dataset.chartHash
    const updateKey = this.el.dataset.updateKey

    // If chart doesn't exist or was disposed, re-initialize
    if (!this.chart || this.chart.isDisposed()) {
      console.log(`Re-initializing chart ${this.chartId} (chart was disposed or doesn't exist)`)
      requestAnimationFrame(() => {
        this.initializeChart(container, chartType, chartData)
      })
      return
    }

    // Check if data actually changed by comparing hash and update key
    const registryEntry = this.chartId ? chartRegistry.get(this.chartId) : null
    const oldDataHash = registryEntry?.dataHash
    const oldUpdateKey = registryEntry?.updateKey
    const dataChanged = newDataHash && newDataHash !== oldDataHash
    
    // Convert to strings for comparison since dataset values are always strings
    const updateKeyStr = String(updateKey || "")
    const oldUpdateKeyStr = String(oldUpdateKey || "")
    const updateKeyChanged = updateKeyStr && updateKeyStr !== oldUpdateKeyStr
    
    console.log(`Chart ${this.chartId} update check:`, {
      oldDataHash,
      newDataHash,
      dataChanged,
      oldUpdateKey: oldUpdateKeyStr,
      updateKey: updateKeyStr,
      updateKeyChanged
    })

    // If update key changed (filter change), clear and re-set the chart
    // This is the most reliable way to handle filter changes
    if (updateKeyChanged) {
      console.log(`Update key changed for ${this.chartId} (${oldUpdateKey} -> ${updateKey}), updating chart`)
      
      // Get the new chart configuration
      const option = this.getChartConfig(chartType, chartData, this)
      
      // Validate option before setting
      if (!option || !option.series) {
        console.warn(`Invalid chart option for ${this.chartId}:`, option)
        return
      }
      
      // Clear the chart and set new option - this keeps the instance alive
      // but ensures a clean state
      if (this.chart && !this.chart.isDisposed()) {
        this.chart.clear()
        this.chart.setOption(option, { notMerge: true, lazyUpdate: false })
        
        // Force resize
        requestAnimationFrame(() => {
          if (this.chart && !this.chart.isDisposed()) {
            this.chart.resize()
          }
        })
        
        // Update stored data in registry
        if (this.chartId) {
          if (!registryEntry) {
            // Create new registry entry if it doesn't exist
            chartRegistry.set(this.chartId, {
              chart: this.chart,
              hook: this,
              type: chartType,
              data: chartData,
              dataHash: newDataHash,
              updateKey: updateKey
            })
          } else {
            registryEntry.data = chartData
            registryEntry.dataHash = newDataHash
            registryEntry.updateKey = updateKey
          }
          
          // For sunburst charts, also update originalData so brush selections work with filtered data
          const entry = chartRegistry.get(this.chartId)
          if (entry && chartType === "sunburst" && chartData.tree) {
            entry.originalData = chartData
          }
        }
      } else {
        // Chart doesn't exist, initialize it
        requestAnimationFrame(() => {
          this.initializeChart(container, chartType, chartData)
        })
      }
      return
    }

    // If data hash changed (but update key didn't), do a full reset
    // This ensures charts don't go blank when data structure changes significantly
    if (dataChanged || !oldDataHash) {
      console.log(`Data changed for ${this.chartId}, updating chart (oldHash: ${oldDataHash}, newHash: ${newDataHash})`)
      console.log(`Chart data for ${this.chartId}:`, chartData)
      
      // Get the new chart configuration
      const option = this.getChartConfig(chartType, chartData, this)
      console.log(`Chart option for ${this.chartId}:`, option)
      
      // Validate option before setting
      if (!option || !option.series) {
        console.warn(`Invalid chart option for ${this.chartId}:`, option)
        return
      }
      
      // Check container dimensions and visibility
      const containerWidth = container.clientWidth
      const containerHeight = container.clientHeight
      const containerStyle = window.getComputedStyle(container)
      const isVisible = containerStyle.display !== 'none' && 
                       containerStyle.visibility !== 'hidden' &&
                       containerStyle.opacity !== '0'
      
      console.log(`Container dimensions for ${this.chartId}: ${containerWidth}x${containerHeight}, visible: ${isVisible}`)
      
      // If container has no dimensions, wait and retry
      if (containerWidth === 0 || containerHeight === 0) {
        console.warn(`Container has no dimensions for ${this.chartId}, retrying...`)
        setTimeout(() => {
          this.updated()
        }, 100)
        return
      }
      
      if (!isVisible) {
        console.warn(`Container is not visible for ${this.chartId}, retrying...`)
        setTimeout(() => {
          this.updated()
        }, 100)
        return
      }
      
      // Use setOption with notMerge for a clean update
      // Don't use clear() as it might be too aggressive
      if (this.chart && !this.chart.isDisposed()) {
        try {
          console.log(`Updating chart ${this.chartId} with setOption (notMerge: true)`)
          console.log(`Chart state before update:`, {
            isDisposed: this.chart.isDisposed(),
            containerSize: `${container.clientWidth}x${container.clientHeight}`,
            optionSeriesCount: Array.isArray(option?.series) ? option.series.length : 0,
            xAxisDataLength: option?.xAxis?.data?.length || 0
          })
          
          // Replace all components to ensure a complete update
          // Using replaceMerge with all components is more reliable than notMerge
          const replaceComponents = ['series', 'xAxis', 'yAxis', 'tooltip', 'legend', 'grid', 'brush', 'color']
          this.chart.setOption(option, { replaceMerge: replaceComponents, lazyUpdate: false })
          console.log(`Chart ${this.chartId} option set with replaceMerge: ${replaceComponents.join(', ')}`)
          
          // Force resize and render immediately
          this.chart.resize()
          
          // Also try rendering explicitly after a short delay
          setTimeout(() => {
            if (this.chart && !this.chart.isDisposed()) {
              this.chart.resize()
              console.log(`Chart ${this.chartId} resized (delayed)`)
              
              // Check if chart actually has content after update
              const currentOption = this.chart.getOption()
              const hasContent = currentOption.series && 
                                 Array.isArray(currentOption.series) && 
                                 currentOption.series.length > 0 &&
                                 currentOption.series.some(s => s.data && s.data.length > 0)
              
              console.log(`Chart ${this.chartId} after update:`, {
                hasSeries: !!currentOption.series,
                seriesCount: Array.isArray(currentOption.series) ? currentOption.series.length : 0,
                hasContent: hasContent,
                xAxisData: currentOption.xAxis?.[0]?.data?.length || 0,
                // Check if chart DOM element has any SVG/canvas children
                hasRenderedContent: container.querySelector('canvas, svg') !== null
              })
              
              if (!hasContent) {
                console.warn(`Chart ${this.chartId} appears to have no content after update!`)
              }
              
              if (!container.querySelector('canvas, svg')) {
                console.error(`Chart ${this.chartId} has no rendered content (no canvas/svg found)!`)
                // Try re-initializing if no rendered content
                console.log(`Attempting to re-initialize chart ${this.chartId}`)
                this.chart.dispose()
                this.chart = null
                this.initializeChart(container, chartType, chartData)
              }
            }
          }, 50)
        } catch (error) {
          console.error(`Error updating chart ${this.chartId}:`, error)
          console.error(`Error stack:`, error.stack)
          // If update fails, try re-initializing
          this.chart.dispose()
          this.chart = null
          requestAnimationFrame(() => {
            const currentContainer = this.el.querySelector(".chart-container")
            if (currentContainer) {
              this.initializeChart(currentContainer, chartType, chartData)
            }
          })
        }
      } else {
        console.log(`Chart ${this.chartId} doesn't exist or is disposed, initializing`)
        // Chart doesn't exist, initialize it
        requestAnimationFrame(() => {
          const currentContainer = this.el.querySelector(".chart-container")
          if (currentContainer) {
            this.initializeChart(currentContainer, chartType, chartData)
          } else {
            console.error(`Container not found for ${this.chartId}`)
          }
        })
      }
    }
  },

  destroyed() {
    // Clear any pending event handler timeout
    if (this.eventHandlerTimeout) {
      clearTimeout(this.eventHandlerTimeout)
      this.eventHandlerTimeout = null
    }
    
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
        animation: true,
        animationDuration: 500,
        animationEasing: 'cubicOut',
        series: [
          {
            id: hook && hook.chartId ? hook.chartId : 'sunburst',
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
      const dates = data.dates || []
      const expenses = data.expenses || []
      const income = data.income || []
      const netWorth = data.net_worth || []
      
      // Handle empty data case
      if (dates.length === 0) {
        return {
          xAxis: {
            type: "category",
            data: ["No data in selected range"],
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
              data: [0],
              itemStyle: { color: tailwindRed[0] },
              lineStyle: { color: tailwindRed[0] },
              smooth: true,
            },
            {
              name: "Income",
              type: "line",
              data: [0],
              itemStyle: { color: tailwindBlue[0] },
              lineStyle: { color: tailwindBlue[0] },
              smooth: true,
            },
            {
              name: "Net Worth",
              type: "line",
              data: [0],
              itemStyle: { color: tailwindSlate[1] },
              lineStyle: { color: tailwindSlate[1] },
              smooth: true,
            },
          ],
          tooltip: {
            trigger: "axis",
          },
        }
      }
      
      // Ensure all data arrays match dates length
      const paddedExpenses = dates.map((_, i) => expenses[i] || 0)
      const paddedIncome = dates.map((_, i) => income[i] || 0)
      const paddedNetWorth = dates.map((_, i) => netWorth[i] || 0)
      
      return {
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
        series: [
          {
            name: "Expenses",
            type: "line",
            data: paddedExpenses,
            itemStyle: { color: tailwindRed[0] }, // red-500
            lineStyle: { color: tailwindRed[0] },
            smooth: true,
          },
          {
            name: "Income",
            type: "line",
            data: paddedIncome,
            itemStyle: { color: tailwindBlue[0] }, // blue-500
            lineStyle: { color: tailwindBlue[0] },
            smooth: true,
          },
          {
            name: "Net Worth",
            type: "line",
            data: paddedNetWorth,
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
      
      const months = data.months || []
      const incomeData = data.income || []
      const expensesData = data.expenses || []
      const totalSeries = 2 // Income and Expenses
      
      // Handle empty data case
      if (months.length === 0) {
        return {
          xAxis: {
            type: "category",
            data: ["No data in selected range"],
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
              data: [0],
              itemStyle: {
                color: tailwindBlue[0],
                borderRadius: [8, 8, 0, 0],
              },
            },
            {
              name: "Expenses",
              type: "bar",
              stack: "total",
              data: [0],
              itemStyle: {
                color: tailwindRed[0],
                borderRadius: [0, 0, 0, 0],
              },
            },
          ],
          tooltip: {
            trigger: "axis",
          },
          legend: {
            data: ["Income", "Expenses"],
            top: 10,
          },
        }
      }
      
      // Ensure data arrays match months length
      const paddedIncome = months.map((_, i) => incomeData[i] || 0)
      const paddedExpenses = months.map((_, i) => expensesData[i] || 0)
      
      return {
        xAxis: {
          type: "category",
          data: months,
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
            data: paddedIncome.map((val) => {
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
            data: paddedExpenses.map((val) => {
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
      
      // Handle empty data case
      if (dates.length === 0 || series.length === 0) {
        // Return a minimal valid config for empty data
        return {
          xAxis: {
            type: "category",
            data: ["No data in selected range"],
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
          series: [],
          tooltip: {
            trigger: "axis",
          },
          grid: {
            left: "3%",
            right: "4%",
            bottom: "15%",
            top: "15%",
            containLabel: true,
          },
        }
      }
      
      // Generate colors for each category using the positive palette
      const categorySeries = series.map((cat, index) => {
        const color = positivePalette[index % positivePalette.length]
        // Ensure data array matches dates length
        const catData = cat.data || []
        const paddedData = dates.map((_, i) => catData[i] || 0)
        
        return {
          name: cat.name,
          type: "line",
          data: paddedData,
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
        hook.eventHandlerTimeout = setTimeout(() => {
          // Guard against chart being destroyed before timeout fires
          if (!hook.chart || hook.chart.isDisposed()) {
            return
          }
          
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
