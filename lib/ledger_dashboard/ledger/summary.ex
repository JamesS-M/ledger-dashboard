defmodule LedgerDashboard.Ledger.Summary do
  @moduledoc """
  High-level financial summary extracted from a ledger file.

  Contains totals for expenses, assets, liabilities, calculated net worth,
  and breakdown of expense categories for visualization.
  """
  defstruct [
    :total_expenses,
    :total_income,
    :total_assets,
    :total_liabilities,
    :net_worth,
    expense_categories: [],
    income_categories: [],
    transactions: []
  ]
end
