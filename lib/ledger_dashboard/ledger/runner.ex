defmodule LedgerDashboard.Ledger.Runner do
  @moduledoc """
  Executes hledger commands and returns parsed results.

  Uses hledger for all ledger operations (better JSON support).
  Handles command execution, timeouts, and error cases.
  """

  @timeout 5_000

  require Logger

  @doc """
  Executes balance command on the given file using hledger.

  Returns `{:ok, output_string}` on success or `{:error, reason}` on failure.
  Output may be JSON (if supported) or text format.
  """
  def run_balance(file_path) when is_binary(file_path) do
    try_hledger_balance(file_path)
  end

  defp try_hledger_balance(file_path) do
    # hledger supports -O json for JSON output
    case execute_command("hledger", file_path, ["balance", "-O", "json"]) do
      {:ok, output} ->
        trimmed = String.trim(output)

        if String.starts_with?(trimmed, "[") or String.starts_with?(trimmed, "{") do
          {:ok, output}
        else
          # Not JSON, try without JSON flag
          execute_command("hledger", file_path, ["balance"])
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Executes register command on the given file.

  Returns `{:ok, output_string}` on success or `{:error, reason}` on failure.

  Reserved for future use.
  """
  def run_register(file_path) when is_binary(file_path) do
    Logger.info("Runner: Running register command for file: #{file_path}")

    # Try hledger with JSON output first
    # hledger register by default shows all transactions, but we need to ensure
    # all account types are included. Using empty query to match all accounts.
    # Alternatively, we could use "Income|Expenses|Assets|Liabilities" but empty should work.
    case execute_command("hledger", file_path, ["register", "-O", "json"]) do
      {:ok, output} ->
        trimmed = String.trim(output)
        Logger.info("Runner: Register command returned #{String.length(trimmed)} characters")

        # Verify it's actually JSON
        if String.starts_with?(trimmed, "[") or String.starts_with?(trimmed, "{") do
          Logger.info("Runner: Register output is valid JSON")
          {:ok, output}
        else
          Logger.info("Runner: Register output is not JSON, trying text format")
          # Not JSON, try text format
          execute_command("hledger", file_path, ["register"])
        end

      {:error, error} ->
        Logger.warning(
          "Runner: Register JSON command failed: #{inspect(error)}, trying text format"
        )

        # Fallback to text format
        execute_command("hledger", file_path, ["register"])
    end
  end

  defp execute_command(command, file_path, command_args) do
    absolute_path = Path.expand(file_path)
    args = ["-f", absolute_path] ++ command_args

    task =
      Task.async(fn ->
        try do
          System.cmd(command, args, stderr_to_stdout: true)
        rescue
          e ->
            # System.cmd raises when command is not found
            case e do
              %ErlangError{original: :enoent} ->
                {:error, :enoent}

              _ ->
                {:error, Exception.message(e)}
            end
        catch
          :exit, reason ->
            {:error, reason}
        end
      end)

    case Task.yield(task, @timeout) || Task.shutdown(task) do
      {:ok, {output, 0}} ->
        {:ok, output}

      {:ok, {output, exit_code}} when exit_code != 0 ->
        error_message = format_execution_error(exit_code, output, command)
        {:error, error_message}

      {:ok, {:error, reason}} ->
        format_system_error(reason, command)

      nil ->
        {:error, "#{command} command timed out after #{@timeout}ms"}

      {:exit, reason} ->
        format_system_error(reason, command)
    end
  end

  defp format_execution_error(exit_code, output, command) do
    trimmed_output = String.trim(output)

    if String.length(trimmed_output) > 0 do
      "#{command} command failed with exit code #{exit_code}: #{trimmed_output}"
    else
      "#{command} command failed with exit code #{exit_code}"
    end
  end

  defp format_system_error(reason, command) do
    error_message =
      case reason do
        :enoent ->
          "#{command} command not found. Please ensure #{command} is installed and in your PATH."

        :timeout ->
          "#{command} command timed out after #{@timeout}ms"

        _ ->
          "Failed to execute #{command} command: #{inspect(reason)}"
      end

    {:error, error_message}
  end
end
