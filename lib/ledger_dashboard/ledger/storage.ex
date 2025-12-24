defmodule LedgerDashboard.Ledger.Storage do
  @moduledoc """
  Temporary storage for analysis results.
  Used to pass data between LiveViews.
  """
  use Agent

  def start_link(_opts) do
    Agent.start_link(fn -> %{} end, name: __MODULE__)
  end

  def store(session_id, analysis_result) do
    Agent.update(__MODULE__, fn state ->
      Map.put(state, session_id, analysis_result)
    end)
  end

  def get(session_id) do
    Agent.get(__MODULE__, fn state ->
      Map.get(state, session_id)
    end)
  end

  def delete(session_id) do
    Agent.update(__MODULE__, fn state ->
      Map.delete(state, session_id)
    end)
  end
end
