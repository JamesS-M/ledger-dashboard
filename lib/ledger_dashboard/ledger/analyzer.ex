defmodule LedgerDashboard.Ledger.Analyzer do
  @moduledoc """
  Orchestrates ledger file analysis by coordinating Runner and Parser.

  Takes an Upload struct, executes ledger commands, parses results,
  and returns an AnalysisResult.
  """

  alias LedgerDashboard.Ledger.{AnalysisResult, Runner, Parser, Upload}

  @doc """
  Analyzes a ledger file and returns financial summary.

  Accepts a `LedgerDashboard.Ledger.Upload` struct and returns
  `{:ok, %AnalysisResult{}}` on success or `{:error, reason}` on failure.
  """
  def analyze(%Upload{path: path} = _upload) when is_binary(path) do
    with {:ok, balance_json} <- Runner.run_balance(path),
         {:ok, summary} <- Parser.parse_balance(balance_json) do
      # Try to get transactions, but don't fail if register doesn't work
      transactions =
        case Runner.run_register(path) do
          {:ok, register_output} ->
            case Parser.parse_register(register_output) do
              {:ok, parsed_transactions} ->
                require Logger

                Logger.info(
                  "Analyzer: Extracted #{length(parsed_transactions)} transactions from register"
                )

                income_count =
                  Enum.count(parsed_transactions, fn t ->
                    String.starts_with?(t.account, "Income")
                  end)

                Logger.info("Analyzer: Found #{income_count} income transactions")
                parsed_transactions

              {:error, _} ->
                []
            end

          {:error, _} ->
            []
        end

      summary_with_transactions = add_transactions_to_summary(summary, transactions)
      analysis_result = build_analysis_result(summary_with_transactions, balance_json)

      {:ok, analysis_result}
    end
  end

  defp add_transactions_to_summary(summary, transactions) do
    %{summary | transactions: transactions}
  end

  defp build_analysis_result(summary, raw_json) do
    %AnalysisResult{
      summary: summary,
      generated_at: DateTime.utc_now(),
      raw: raw_json
    }
  end
end
