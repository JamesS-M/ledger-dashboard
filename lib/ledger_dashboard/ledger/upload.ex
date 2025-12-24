defmodule LedgerDashboard.Ledger.Upload do
  @moduledoc """
  Represents an uploaded ledger file and its metadata.

  This struct encapsulates information about a temporary ledger file
  that has been uploaded for analysis.
  """
  @enforce_keys [:path, :original_name]
  defstruct [
    :path,
    :original_name,
    :size,
    :uploaded_at
  ]
end
