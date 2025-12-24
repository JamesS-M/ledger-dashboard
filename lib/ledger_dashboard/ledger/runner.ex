defmodule LedgerDashboard.Ledger.Runner do
  @moduledoc """
  Executes ledger-cli or hledger commands and returns parsed results.

  Prefers hledger (better JSON support), falls back to ledger.
  Handles command execution, timeouts, and error cases.
  """

  @timeout 5_000

  @doc """
  Executes balance command on the given file.

  Tries hledger first (with JSON output), then falls back to ledger.
  Returns `{:ok, output_string}` on success or `{:error, reason}` on failure.
  Output may be JSON (if supported) or text format.
  """
  def run_balance(file_path) when is_binary(file_path) do
    # Try hledger first (better JSON support)
    case try_hledger_balance(file_path) do
      {:ok, output} -> {:ok, output}
      {:error, _} -> try_ledger_balance(file_path)
    end
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

  defp try_ledger_balance(file_path) do
    case try_json_flags(file_path, ["bal"]) do
      {:ok, output} -> {:ok, output}
      {:error, _} -> try_json_flags(file_path, ["balance"])
    end
  end

  defp try_json_flags(file_path, base_args) do
    json_flags = [
      ["--json"],
      ["-j"],
      ["--format", "json"]
    ]

    result =
      Enum.reduce_while(json_flags, nil, fn json_flag, _acc ->
        case execute_command("ledger", file_path, base_args ++ json_flag) do
          {:ok, output} ->
            trimmed = String.trim(output)

            if String.starts_with?(trimmed, "[") or String.starts_with?(trimmed, "{") do
              {:halt, {:ok, output}}
            else
              {:cont, :next}
            end

          {:error, reason} ->
            if String.contains?(reason, "Illegal option") or
                 String.contains?(reason, "unknown option") do
              {:cont, :next}
            else
              {:halt, {:error, reason}}
            end
        end
      end)

    case result do
      {:ok, output} ->
        {:ok, output}

      {:error, reason} ->
        {:error, reason}

      _ ->
        execute_command("ledger", file_path, base_args)
    end
  end

  @doc """
  Executes register command on the given file.

  Returns `{:ok, output_string}` on success or `{:error, reason}` on failure.

  Reserved for future use.
  """
  def run_register(file_path) when is_binary(file_path) do
    # Try hledger first with JSON output
    # Use --all to show all postings, not just one per transaction
    case execute_command("hledger", file_path, ["register", "--all", "-O", "json"]) do
      {:ok, output} ->
        trimmed = String.trim(output)
        # Verify it's actually JSON
        if String.starts_with?(trimmed, "[") or String.starts_with?(trimmed, "{") do
          {:ok, output}
        else
          # Not JSON, try text format with --all
          execute_command("hledger", file_path, ["register", "--all"])
        end

      {:error, _} ->
        # Fallback to text format with --all
        case execute_command("hledger", file_path, ["register", "--all"]) do
          {:ok, output} ->
            {:ok, output}

          {:error, _} ->
            # Try ledger with custom format
            # Use display_amount instead of display_total to get the transaction amount, not running balance
            case execute_command("ledger", file_path, [
                   "reg",
                   "--format",
                   "%(format_date(date, \"%Y-%m-%d\"))|%(account)|%(display_amount)\n"
                 ]) do
              {:ok, output} -> {:ok, output}
              {:error, _} -> execute_command("ledger", file_path, ["reg"])
            end
        end
    end
  end

  defp execute_command(command, file_path, command_args) do
    absolute_path = Path.expand(file_path)
    args = ["-f", absolute_path] ++ command_args

    task =
      Task.async(fn ->
        System.cmd(command, args, stderr_to_stdout: true)
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
