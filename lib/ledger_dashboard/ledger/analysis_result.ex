defmodule LedgerDashboard.Ledger.AnalysisResult do
  @moduledoc """
  Top-level analysis payload containing parsed ledger data.

  Contains the summary, generation timestamp, and optionally raw JSON
  for debugging purposes.
  """
  defstruct [
    :summary,
    :generated_at,
    :raw
  ]
end
