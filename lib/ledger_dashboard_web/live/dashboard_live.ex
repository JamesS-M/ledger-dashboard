defmodule LedgerDashboardWeb.DashboardLive do
  @moduledoc """
  LiveView for displaying ledger analysis results in a dashboard.
  """
  use LedgerDashboardWeb, :live_view

  alias LedgerDashboard.Ledger.{AnalysisResult, Storage}
  alias Jason

  @impl true
  def mount(_params, session, socket) do
    session_id = Map.get(session, "_csrf_token", inspect(self()))
    analysis_result = Storage.get(session_id)

    case analysis_result do
      %AnalysisResult{} = result ->
        Storage.delete(session_id)
        {:ok, assign(socket, :analysis_result, result)}

      _ ->
        {:ok,
         socket
         |> put_flash(:error, "No analysis result found. Please upload a ledger file first.")
         |> redirect(to: ~p"/")}
    end
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="grid grid-cols-1 gap-6 p-6 sm:gap-8 sm:p-8 lg:gap-12 lg:p-12 lg:max-w-7xl lg:mx-auto">
      <!-- Header -->
      <div class="col-span-1 mb-2">
        <h1 class="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl lg:text-4xl">
          Ledger Dashboard
        </h1>
        <p class="mt-3 text-base leading-7 text-zinc-600 sm:mt-4 sm:text-lg sm:leading-8">
          Financial summary from your ledger file
        </p>
      </div>
      
    <!-- Summary Cards Row - Mobile: 1 col, Tablet: 3 cols -->
      <div class="grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-8">
        <.summary_card
          label="Total Expenses"
          value={format_number(@analysis_result.summary.total_expenses)}
        />
        <.summary_card
          label="Total Income"
          value={format_number(@analysis_result.summary.total_income)}
        />
        <.summary_card
          label="Net Worth"
          value={format_number(@analysis_result.summary.net_worth)}
        />
      </div>
      
    <!-- Sunburst Charts Row - Mobile: 1 col, Desktop: 2 cols -->
      <div class="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-2">
        <.chart_card
          title="Expense Breakdown"
          chart_type="sunburst"
          chart_id="expense-breakdown"
          chart_data={expense_chart_data(@analysis_result.summary.expense_categories)}
          linked_chart_id="expense-category-trends-over-time"
        />
        <.chart_card
          title="Income Breakdown"
          chart_type="sunburst"
          chart_id="income-breakdown"
          chart_data={income_chart_data(@analysis_result.summary.income_categories)}
          linked_chart_id="income-category-trends-over-time"
        />
      </div>
      
    <!-- Category Trends Line Charts - Full width, split into expenses and income -->
      <div class="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-2">
        <.chart_card
          title="Expense Category Trends Over Time"
          chart_type="category_lines"
          chart_id="expense-category-trends-over-time"
          chart_data={expense_category_trends_chart_data(@analysis_result.summary)}
          linked_chart_id="expense-breakdown"
        />
        <.chart_card
          title="Income Category Trends Over Time"
          chart_type="category_lines"
          chart_id="income-category-trends-over-time"
          chart_data={income_category_trends_chart_data(@analysis_result.summary)}
          linked_chart_id="income-breakdown"
        />
      </div>
      
    <!-- Trends Over Time Line Chart - Full width -->
      <div class="col-span-1">
        <.chart_card
          title="Trends Over Time"
          chart_type="line"
          chart_data={trends_chart_data(@analysis_result.summary)}
        />
      </div>
      
    <!-- Income vs Expenses by Month Stacked Bar - Full width -->
      <div class="col-span-1">
        <.chart_card
          title="Income vs Expenses by Month"
          chart_type="stacked_bar"
          chart_data={monthly_comparison_chart_data(@analysis_result.summary)}
        />
      </div>
      
    <!-- Asset / Liability Flow Treemap - Full width -->
      <div class="col-span-1">
        <.chart_card
          title="Asset / Liability Flow"
          chart_type="treemap"
          chart_data={asset_liability_flow_chart_data(@analysis_result.summary)}
        />
      </div>
      
    <!-- Back link -->
      <div class="col-span-1">
        <.link
          navigate={~p"/"}
          class="text-sm font-semibold leading-6 text-zinc-900 hover:text-zinc-700"
        >
          ← Upload another file
        </.link>
      </div>
    </div>
    """
  end

  defp summary_card(assigns) do
    ~H"""
    <div class="overflow-hidden rounded-xl bg-white shadow-sm">
      <div class="p-6 sm:p-8">
        <dl>
          <dt class="text-xs font-medium text-zinc-500 truncate sm:text-sm">
            {@label}
          </dt>
          <dd class="mt-2 text-2xl font-semibold text-zinc-900 sm:mt-3 sm:text-3xl">
            {@value}
          </dd>
        </dl>
      </div>
    </div>
    """
  end

  defp format_number(nil), do: "0"

  defp format_number(value) when is_number(value) do
    :erlang.float_to_binary(value / 1.0, [{:decimals, 2}, :compact])
  end

  defp format_number(_value), do: "0"

  defp chart_card(assigns) do
    chart_id =
      assigns[:chart_id] ||
        "chart-#{String.replace(assigns.title, " ", "-") |> String.downcase()}"

    # Different heights for different chart types
    height_class = get_chart_height(assigns.chart_type)
    linked_chart_id = assigns[:linked_chart_id]
    linked_sunburst_ids = assigns[:linked_sunburst_ids] || []

    ~H"""
    <div class="overflow-hidden rounded-xl bg-white shadow-sm">
      <div class="p-6 sm:p-8">
        <h3 class="text-base font-medium text-zinc-900 mb-4 sm:text-lg sm:mb-6">{@title}</h3>
        <div
          id={chart_id}
          phx-hook="Chart"
          data-chart-type={@chart_type}
          data-chart-data={Jason.encode!(@chart_data)}
          data-linked-chart-id={if linked_chart_id, do: linked_chart_id, else: ""}
          data-linked-sunburst-ids={
            if linked_sunburst_ids != [], do: Jason.encode!(linked_sunburst_ids), else: ""
          }
          class={["w-full", height_class]}
        >
          <div
            class="chart-container w-full h-full rounded-lg overflow-hidden"
            style="min-height: 256px;"
          >
          </div>
        </div>
      </div>
    </div>
    """
  end

  defp get_chart_height("sunburst"), do: "h-64 sm:h-80"
  defp get_chart_height("line"), do: "h-72 sm:h-80 lg:h-96"
  defp get_chart_height("category_lines"), do: "h-80 sm:h-96 lg:h-[28rem]"
  defp get_chart_height("stacked_bar"), do: "h-72 sm:h-80 lg:h-96"
  defp get_chart_height("treemap"), do: "h-80 sm:h-96 lg:h-[28rem]"
  defp get_chart_height(_), do: "h-64 sm:h-80"

  defp expense_chart_data(expense_categories) when is_list(expense_categories) do
    # Build hierarchical tree structure for sunburst chart
    tree = build_expense_hierarchy(expense_categories)
    %{tree: tree}
  end

  defp expense_chart_data(_), do: %{tree: %{name: "Expenses", value: 0, children: []}}

  defp income_chart_data(income_categories) when is_list(income_categories) do
    # Build hierarchical tree structure for sunburst chart
    tree = build_income_hierarchy(income_categories)
    %{tree: tree}
  end

  defp income_chart_data(_), do: %{tree: %{name: "Income", value: 0, children: []}}

  defp build_expense_hierarchy(categories) do
    # Build a tree from flat categories like "Expenses:Food:Groceries" -> {Food: {Groceries: amount}}
    tree = %{}

    tree =
      Enum.reduce(categories, tree, fn %{full_path: path, amount: amount}, acc ->
        parts = String.split(path, ":") |> Enum.drop(1)

        if Enum.empty?(parts) do
          acc
        else
          insert_category(acc, parts, amount)
        end
      end)

    # Convert to sunburst format: {name, value, children: [...]}
    convert_to_sunburst(tree, "Expenses")
  end

  defp build_income_hierarchy(categories) do
    # Build a tree from flat categories like "Income:Salary:Base" -> {Salary: {Base: amount}}
    tree = %{}

    tree =
      Enum.reduce(categories, tree, fn %{full_path: path, amount: amount}, acc ->
        parts = String.split(path, ":") |> Enum.drop(1)

        if Enum.empty?(parts) do
          acc
        else
          insert_category(acc, parts, amount)
        end
      end)

    # Convert to sunburst format: {name, value, children: [...]}
    convert_to_sunburst(tree, "Income")
  end

  defp insert_category(tree, [leaf], amount) do
    # Leaf node - store as {name: amount} in a special format
    current = Map.get(tree, leaf, 0)

    if is_number(current) do
      Map.put(tree, leaf, current + amount)
    else
      # Already has children, add to value
      Map.update(tree, leaf, amount, fn existing ->
        if is_map(existing) do
          Map.update(existing, :_value, amount, &(&1 + amount))
        else
          amount
        end
      end)
    end
  end

  defp insert_category(tree, [parent | rest], amount) do
    current = Map.get(tree, parent, %{})

    updated_children =
      if is_map(current) do
        insert_category(current, rest, amount)
      else
        # Parent was a number (leaf), convert to node
        insert_category(%{_value: current}, rest, amount)
      end

    Map.put(tree, parent, updated_children)
  end

  defp convert_to_sunburst(tree, root_name) when is_map(tree) do
    children =
      tree
      |> Enum.map(fn {name, value_or_children} ->
        cond do
          is_number(value_or_children) ->
            %{name: name, value: value_or_children}

          is_map(value_or_children) and Map.has_key?(value_or_children, :_value) ->
            # Has both value and children
            direct_value = Map.get(value_or_children, :_value, 0)
            child_map = Map.delete(value_or_children, :_value)
            child_nodes = convert_to_sunburst_children(child_map)
            child_total = Enum.reduce(child_nodes, 0, fn c, acc -> acc + (c.value || 0) end)
            %{name: name, value: direct_value + child_total, children: child_nodes}

          is_map(value_or_children) ->
            # Only has children
            child_nodes = convert_to_sunburst_children(value_or_children)
            child_total = Enum.reduce(child_nodes, 0, fn c, acc -> acc + (c.value || 0) end)
            %{name: name, value: child_total, children: child_nodes}

          true ->
            %{name: name, value: 0}
        end
      end)
      |> Enum.filter(fn item -> item.value > 0 end)

    total_value = Enum.reduce(children, 0, fn item, acc -> acc + (item.value || 0) end)

    %{name: root_name, value: total_value, children: children}
  end

  defp convert_to_sunburst_children(children_map) when is_map(children_map) do
    children_map
    |> Enum.map(fn {name, value_or_children} ->
      if is_number(value_or_children) do
        %{name: name, value: value_or_children}
      else
        child_nodes = convert_to_sunburst_children(value_or_children)
        child_total = Enum.reduce(child_nodes, 0, fn c, acc -> acc + (c.value || 0) end)
        %{name: name, value: child_total, children: child_nodes}
      end
    end)
    |> Enum.filter(fn item -> item.value > 0 end)
  end

  defp convert_to_sunburst_children(_), do: []

  defp convert_to_sunburst(_, root_name), do: %{name: root_name, value: 0, children: []}

  defp assets_liabilities_chart_data(summary) do
    %{
      labels: ["Assets", "Liabilities", "Net Worth"],
      values: [
        summary.total_assets || 0,
        summary.total_liabilities || 0,
        summary.net_worth || 0
      ],
      datasetLabel: "Financial Overview"
    }
  end

  defp trends_chart_data(summary) do
    require Logger
    transactions = summary.transactions || []
    Logger.info("trends_chart_data: #{length(transactions)} transactions")

    if Enum.empty?(transactions) do
      Logger.warning("No transactions available for trends chart")
      %{dates: [], expenses: [], income: [], net_worth: []}
    else
      # Log sample transactions to debug
      income_transactions =
        Enum.filter(transactions, fn t -> String.starts_with?(t.account, "Income") end)

      Logger.info("Found #{length(income_transactions)} income transactions")

      if length(income_transactions) > 0 do
        sample = List.first(income_transactions)

        Logger.info(
          "Sample income transaction: account=#{sample.account}, amount=#{sample.amount}, date=#{inspect(sample.date)}"
        )
      end

      # Group transactions by date and calculate daily totals
      daily_data =
        transactions
        |> Enum.group_by(& &1.date)
        |> Enum.map(fn {date, day_transactions} ->
          expenses =
            day_transactions
            |> Enum.filter(fn t -> String.starts_with?(t.account, "Expenses") end)
            |> Enum.map(&abs(&1.amount))
            |> Enum.sum()

          income =
            day_transactions
            |> Enum.filter(fn t -> String.starts_with?(t.account, "Income") end)
            |> Enum.map(&abs(&1.amount))
            |> Enum.sum()

          # Calculate net worth change from income and expenses
          # Income increases net worth, expenses decrease it
          # This is more accurate than using asset/liability transactions because
          # those include internal transfers which don't affect net worth
          net_worth_change = income - expenses

          {date, %{expenses: expenses, income: income, net_worth_change: net_worth_change}}
        end)
        |> Enum.sort_by(fn {date, _} -> date end)

      # Get initial net worth from summary (current net worth minus all changes)
      # We'll calculate it backwards from the current net worth
      total_net_worth_change =
        daily_data
        |> Enum.map(fn {_date, data} -> data.net_worth_change end)
        |> Enum.sum()

      initial_net_worth = (summary.net_worth || 0) - total_net_worth_change

      Logger.info(
        "Net worth calculation: initial=#{initial_net_worth}, current=#{summary.net_worth}, total_change=#{total_net_worth_change}"
      )

      # Calculate running net worth (cumulative from initial)
      # We build lists by prepending (using [item | acc]), so nw_acc accumulates in reverse
      # chronological order. List.first(nw_acc) retrieves the most recently prepended net worth
      # (the previous day's value), not the earliest. When nw_acc is empty (first iteration),
      # we fall back to initial_net_worth. This prepending approach is efficient and allows us
      # to compute new_net_worth = previous_net_worth + data.net_worth_change for each day in
      # daily_data, then reverse all lists at the end to restore chronological order.
      {dates, expenses_list, income_list, net_worth_list} =
        Enum.reduce(daily_data, {[], [], [], []}, fn {date, data},
                                                     {dates_acc, exp_acc, inc_acc, nw_acc} ->
          previous_net_worth = List.first(nw_acc) || initial_net_worth
          new_net_worth = previous_net_worth + data.net_worth_change

          {
            [Date.to_string(date) | dates_acc],
            [data.expenses | exp_acc],
            [data.income | inc_acc],
            [new_net_worth | nw_acc]
          }
        end)

      %{
        dates: Enum.reverse(dates),
        expenses: Enum.reverse(expenses_list),
        income: Enum.reverse(income_list),
        net_worth: Enum.reverse(net_worth_list)
      }
    end
  end

  defp monthly_comparison_chart_data(summary) do
    require Logger
    transactions = summary.transactions || []
    Logger.info("monthly_comparison_chart_data: #{length(transactions)} transactions")

    if Enum.empty?(transactions) do
      Logger.warning("No transactions available for monthly comparison chart")
      %{months: [], income: [], expenses: []}
    else
      # Group transactions by month
      monthly_data =
        transactions
        |> Enum.group_by(fn t -> {t.date.year, t.date.month} end)
        |> Enum.map(fn {{year, month}, month_transactions} ->
          expenses =
            month_transactions
            |> Enum.filter(fn t -> String.starts_with?(t.account, "Expenses") end)
            |> Enum.map(&abs(&1.amount))
            |> Enum.sum()

          income =
            month_transactions
            |> Enum.filter(fn t -> String.starts_with?(t.account, "Income") end)
            |> Enum.map(&abs(&1.amount))
            |> Enum.sum()

          month_label = "#{year}-#{String.pad_leading(Integer.to_string(month), 2, "0")}"
          {month_label, %{expenses: expenses, income: income}}
        end)
        |> Enum.sort_by(fn {month_label, _} -> month_label end)

      {months, expenses_list, income_list} =
        Enum.reduce(monthly_data, {[], [], []}, fn {month, data},
                                                   {months_acc, exp_acc, inc_acc} ->
          {
            [month | months_acc],
            [data.expenses | exp_acc],
            [data.income | inc_acc]
          }
        end)

      %{
        months: Enum.reverse(months),
        income: Enum.reverse(income_list),
        expenses: Enum.reverse(expenses_list)
      }
    end
  end

  defp asset_liability_flow_chart_data(summary) do
    # Build treemap data from assets and liabilities
    assets_data = build_asset_liability_tree(summary.total_assets || 0, "Assets")
    liabilities_data = build_asset_liability_tree(summary.total_liabilities || 0, "Liabilities")

    %{
      tree: %{
        name: "Financial Position",
        value: (summary.total_assets || 0) + (summary.total_liabilities || 0),
        children: [
          assets_data,
          liabilities_data
        ]
      }
    }
  end

  defp build_asset_liability_tree(value, name) when value > 0 do
    color = if name == "Assets", do: "#10b981", else: "#ef4444"

    %{
      name: name,
      value: value,
      itemStyle: %{
        color: color
      }
    }
  end

  defp build_asset_liability_tree(_value, _name), do: %{name: "No Data", value: 0}

  defp expense_category_trends_chart_data(summary) do
    require Logger
    transactions = summary.transactions || []

    # Filter to only include Expenses accounts (exclude Assets, Liabilities, Income)
    expense_transactions =
      transactions
      |> Enum.filter(fn t -> String.starts_with?(t.account, "Expenses") end)

    Logger.info(
      "expense_category_trends_chart_data: #{length(expense_transactions)} expense transactions"
    )

    if Enum.empty?(expense_transactions) do
      Logger.warning("No expense transactions available for expense category trends chart")
      %{dates: [], categories: [], series: [], transactions: []}
    else
      build_category_trends_data(expense_transactions, "Expenses")
    end
  end

  defp income_category_trends_chart_data(summary) do
    require Logger
    transactions = summary.transactions || []

    # Filter to only include Income accounts (exclude Assets, Liabilities, Expenses)
    income_transactions =
      transactions
      |> Enum.filter(fn t -> String.starts_with?(t.account, "Income") end)

    Logger.info(
      "income_category_trends_chart_data: #{length(income_transactions)} income transactions"
    )

    if Enum.empty?(income_transactions) do
      Logger.warning("No income transactions available for income category trends chart")
      %{dates: [], categories: [], series: [], transactions: []}
    else
      build_category_trends_data(income_transactions, "Income")
    end
  end

  defp build_category_trends_data(transactions, account_prefix) do
    # Group transactions by month
    monthly_data =
      transactions
      |> Enum.group_by(fn t -> {t.date.year, t.date.month} end)
      |> Enum.map(fn {{year, month}, month_transactions} ->
        # Group by category (extract category from account path)
        category_data =
          month_transactions
          |> Enum.group_by(fn t ->
            # Extract category from account path (e.g., "Expenses:Food:Groceries" -> "Food:Groceries")
            account = t.account

            category =
              if String.contains?(account, ":") do
                account
                |> String.split(":")
                |> Enum.drop(1)
                |> Enum.join(":")
              else
                # Fallback: use account name without prefix
                String.replace_prefix(account, account_prefix, "")
              end

            # Replace empty or nil categories with "Uncategorized"
            if category == "" or is_nil(category) do
              "Uncategorized"
            else
              category
            end
          end)
          |> Enum.map(fn {category, cat_transactions} ->
            total = Enum.map(cat_transactions, &abs(&1.amount)) |> Enum.sum()
            {category, total}
          end)
          |> Enum.into(%{})

        month_label = "#{year}-#{String.pad_leading(Integer.to_string(month), 2, "0")}"
        {month_label, category_data}
      end)
      |> Enum.sort_by(fn {month_label, _} -> month_label end)

    # Get all unique categories across all months
    all_categories =
      monthly_data
      |> Enum.flat_map(fn {_month, cat_data} -> Map.keys(cat_data) end)
      |> Enum.uniq()
      |> Enum.sort()

    # Build series data for each category
    months = Enum.map(monthly_data, fn {month, _} -> month end)

    series =
      Enum.map(all_categories, fn category ->
        values =
          Enum.map(monthly_data, fn {_month, cat_data} ->
            Map.get(cat_data, category, 0)
          end)

        %{name: category, data: values}
      end)

    # Include filtered transactions for filtering by date range
    # Keep original date format for filtering, but also include month for grouping
    all_transactions =
      Enum.map(transactions, fn t ->
        month_label =
          "#{t.date.year}-#{String.pad_leading(Integer.to_string(t.date.month), 2, "0")}"

        %{
          date: Date.to_string(t.date),
          month: month_label,
          account: t.account,
          amount: t.amount
        }
      end)

    %{
      dates: months,
      categories: all_categories,
      series: series,
      transactions: all_transactions
    }
  end
end
