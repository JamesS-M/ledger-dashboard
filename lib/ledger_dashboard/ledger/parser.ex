defmodule LedgerDashboard.Ledger.Parser do
  @moduledoc """
  Parses output from ledger-cli commands (JSON or text format) into domain structs.

  Extracts financial totals and normalizes data for display.
  """

  alias LedgerDashboard.Ledger.Summary

  @doc """
  Parses output from `ledger balance` command (JSON or text format).

  Returns `{:ok, %Summary{}}` on success or `{:error, reason}` on failure.
  """
  def parse_balance(output_string) when is_binary(output_string) do
    trimmed = String.trim(output_string)

    # Try to parse as JSON first
    case Jason.decode(trimmed) do
      {:ok, parsed} when is_list(parsed) ->
        require Logger

        Logger.info(
          "Parsed JSON array with #{length(parsed)} items. First item: #{inspect(List.first(parsed))}"
        )

        extract_summary(parsed)

      {:ok, parsed} when is_map(parsed) ->
        require Logger

        Logger.info(
          "Parsed JSON object: keys=#{inspect(Map.keys(parsed))}, sample=#{inspect(parsed)}"
        )

        extract_summary_from_object(parsed)

      {:ok, _} ->
        {:error, "Expected JSON array or object from balance command"}

      {:error, _} ->
        # Not JSON, try parsing as text output
        parse_text_output(trimmed)
    end
  end

  defp parse_text_output(text) do
    lines = String.split(text, "\n", trim: true)

    {expenses, assets, liabilities} =
      Enum.reduce(lines, {0, 0, 0}, fn line, {exp_acc, ass_acc, liab_acc} ->
        case parse_ledger_line(line) do
          {:expense, amount} -> {exp_acc + amount, ass_acc, liab_acc}
          {:asset, amount} -> {exp_acc, ass_acc + amount, liab_acc}
          {:liability, amount} -> {exp_acc, ass_acc, liab_acc + amount}
          _ -> {exp_acc, ass_acc, liab_acc}
        end
      end)

    summary = %Summary{
      total_expenses: abs(expenses),
      total_assets: assets,
      total_liabilities: liabilities,
      net_worth: assets - liabilities
    }

    {:ok, summary}
  end

  defp parse_ledger_line(line) do
    trimmed = String.trim(line)

    if String.match?(trimmed, ~r/^[-=]+$/) or trimmed == "" do
      :skip
    else
      case Regex.run(~r/^\s*(-?\$?\d[\d,]*\.?\d*)\s+(.+)$/, trimmed) do
        [_, amount_str, account] ->
          amount = parse_amount(amount_str)

          cond do
            String.starts_with?(account, "Expenses") -> {:expense, amount}
            String.starts_with?(account, "Assets") -> {:asset, amount}
            String.starts_with?(account, "Liabilities") -> {:liability, amount}
            true -> :skip
          end

        _ ->
          :skip
      end
    end
  end

  defp parse_amount(amount_str) when is_binary(amount_str) do
    cleaned = String.replace(amount_str, "$", "") |> String.replace(",", "")

    case Float.parse(cleaned) do
      {amount, _} ->
        amount

      :error ->
        require Logger
        Logger.debug("Failed to parse amount: #{inspect(amount_str)} -> #{inspect(cleaned)}")
        0
    end
  end

  defp parse_amount(_), do: 0

  defp extract_summary(parsed) when is_list(parsed) do
    require Logger
    Logger.info("Extracting summary from #{length(parsed)} items")

    # Check if this is hledger format (array of arrays) or ledger format (array of objects)
    first_item = List.first(parsed)

    accounts =
      cond do
        # hledger format: [account_name, account_name, 0, [amount_objects]]
        is_list(first_item) and length(first_item) >= 4 ->
          Logger.info("Detected hledger format (array of arrays)")
          parse_hledger_format(parsed)

        # ledger format: [%{"account" => "...", "total" => ...}]
        is_map(first_item) ->
          Logger.info("Detected ledger format (array of objects)")
          parsed

        true ->
          Logger.warning("Unknown format, trying as-is")
          parsed
      end

    total_expenses = extract_total_for_account_type(accounts, "Expenses")
    total_income = extract_total_for_account_type(accounts, "Income")
    total_assets = extract_total_for_account_type(accounts, "Assets")
    total_liabilities = extract_total_for_account_type(accounts, "Liabilities")
    net_worth = calculate_net_worth(total_assets, total_liabilities)
    expense_categories = extract_expense_categories(accounts)
    income_categories = extract_income_categories(accounts)

    normalized_income = normalize_income(total_income)
    Logger.info("Normalizing income: #{total_income} -> #{normalized_income}")

    Logger.info(
      "Extracted: expenses=#{total_expenses}, income=#{total_income} (normalized: #{normalized_income}), assets=#{total_assets}, liabilities=#{total_liabilities}"
    )

    summary = %Summary{
      total_expenses: normalize_expenses(total_expenses),
      total_income: normalized_income,
      total_assets: total_assets,
      total_liabilities: total_liabilities,
      net_worth: net_worth,
      expense_categories: expense_categories,
      income_categories: income_categories
    }

    {:ok, summary}
  end

  defp parse_hledger_format(entries) do
    # hledger returns an array where each element is itself an array of account entries
    # Concatenate all account arrays, then convert each entry
    entries
    |> Enum.concat()
    |> Enum.map(fn entry ->
      case entry do
        [account_name, _account_name_again, _depth, amount_list] when is_list(amount_list) ->
          # Sum all amounts in the list
          total =
            Enum.reduce(amount_list, 0, fn amount_obj, acc ->
              amount_value = extract_hledger_amount_value(amount_obj)
              acc + amount_value
            end)

          %{"account" => account_name, "total" => total}

        _ ->
          %{"account" => "", "total" => 0}
      end
    end)
  end

  defp extract_hledger_amount_value(amount_obj) when is_map(amount_obj) do
    # hledger provides floatingPoint directly, which is much easier!
    cond do
      Map.has_key?(amount_obj, "aquantity") ->
        aq = amount_obj["aquantity"]

        if is_map(aq) and Map.has_key?(aq, "floatingPoint") do
          aq["floatingPoint"] || 0
        else
          0
        end

      Map.has_key?(amount_obj, "floatingPoint") ->
        amount_obj["floatingPoint"] || 0

      true ->
        0
    end
  end

  defp extract_hledger_amount_value(_), do: 0

  defp extract_summary(_parsed) do
    {:error, "Expected JSON array from ledger balance command"}
  end

  defp extract_summary_from_object(parsed) do
    require Logger
    Logger.info("Attempting to extract from object: keys=#{inspect(Map.keys(parsed))}")

    # hledger JSON might have a different structure
    # Try to find accounts in various possible formats
    accounts =
      cond do
        Map.has_key?(parsed, "accounts") -> parsed["accounts"]
        Map.has_key?(parsed, "account") -> [parsed["account"]]
        is_list(parsed) -> parsed
        true -> []
      end

    if is_list(accounts) and length(accounts) > 0 do
      Logger.info("Found #{length(accounts)} accounts. First: #{inspect(List.first(accounts))}")
      extract_summary(accounts)
    else
      Logger.error("Could not find accounts in parsed object. Structure: #{inspect(parsed)}")
      {:error, "Could not find accounts in JSON structure"}
    end
  end

  defp extract_total_for_account_type(accounts, account_type) do
    require Logger

    matching_accounts = Enum.filter(accounts, &account_matches_type?(&1, account_type))
    Logger.info("Found #{length(matching_accounts)} #{account_type} accounts")

    amounts = Enum.map(matching_accounts, &extract_amount/1)
    Logger.info("#{account_type} amounts: #{inspect(amounts)}")

    total = Enum.sum(amounts)
    Logger.info("#{account_type} total: #{total}")

    total
  end

  defp account_matches_type?(account, account_type) do
    account_name =
      cond do
        is_binary(account) -> account
        Map.has_key?(account, "account") -> account["account"]
        Map.has_key?(account, "aname") -> account["aname"]
        Map.has_key?(account, "name") -> account["name"]
        true -> nil
      end

    case account_name do
      name when is_binary(name) ->
        String.starts_with?(name, account_type)

      _ ->
        false
    end
  end

  defp extract_amount(account) do
    # Try different field names that hledger/ledger might use
    amount =
      cond do
        Map.has_key?(account, "total") ->
          case account["total"] do
            total when is_number(total) -> total
            total when is_list(total) -> extract_amount_from_list(total)
            _ -> 0
          end

        Map.has_key?(account, "aibalance") ->
          # hledger might use aibalance (account initial balance)
          case account["aibalance"] do
            [amount_data | _] when is_map(amount_data) ->
              extract_amount_from_hledger_amount(amount_data)

            amount when is_number(amount) ->
              amount

            _ ->
              0
          end

        Map.has_key?(account, "balance") ->
          case account["balance"] do
            [amount_data | _] when is_map(amount_data) ->
              extract_amount_from_hledger_amount(amount_data)

            amount when is_number(amount) ->
              amount

            _ ->
              0
          end

        true ->
          0
      end

    amount
  end

  defp extract_amount_from_hledger_amount(amount_map) do
    # hledger amounts are objects like {"aquantity": {"acommodity": "$", "aquantity": {"decimalMantissa": 100, "decimalPlaces": 2}}}
    cond do
      Map.has_key?(amount_map, "aquantity") ->
        aq = amount_map["aquantity"]

        if is_map(aq) and Map.has_key?(aq, "aquantity") do
          inner_aq = aq["aquantity"]

          if is_map(inner_aq) do
            mantissa = Map.get(inner_aq, "decimalMantissa", 0)
            places = Map.get(inner_aq, "decimalPlaces", 0)

            if places > 0 do
              mantissa / :math.pow(10, places)
            else
              mantissa
            end
          else
            0
          end
        else
          0
        end

      Map.has_key?(amount_map, "decimalMantissa") ->
        mantissa = Map.get(amount_map, "decimalMantissa", 0)
        places = Map.get(amount_map, "decimalPlaces", 0)

        if places > 0 do
          mantissa / :math.pow(10, places)
        else
          mantissa
        end

      true ->
        0
    end
  end

  defp extract_amount_from_list(total_list) do
    total_list
    |> Enum.map(fn
      [amount | _] when is_number(amount) -> amount
      _ -> 0
    end)
    |> Enum.sum()
  end

  defp normalize_expenses(amount) when is_number(amount) do
    abs(amount)
  end

  defp normalize_income(amount) when is_number(amount) do
    # Income amounts in ledger/hledger are typically negative (credits)
    # We want to show them as positive values
    abs(amount)
  end

  defp normalize_income(_), do: 0

  defp calculate_net_worth(assets, liabilities)
       when is_number(assets) and is_number(liabilities) do
    assets - liabilities
  end

  defp calculate_net_worth(_assets, _liabilities) do
    0
  end

  defp extract_expense_categories(accounts) do
    accounts
    |> Enum.filter(&account_matches_type?(&1, "Expenses"))
    |> Enum.map(fn account ->
      account_name =
        cond do
          Map.has_key?(account, "account") -> account["account"]
          Map.has_key?(account, "aname") -> account["aname"]
          Map.has_key?(account, "name") -> account["name"]
          true -> ""
        end

      amount = extract_amount(account)

      # Extract category name (e.g., "Expenses:Food" -> "Food")
      category_name =
        if String.contains?(account_name, ":") do
          account_name
          |> String.split(":")
          |> Enum.drop(1)
          |> Enum.join(":")
        else
          String.replace_prefix(account_name, "Expenses", "")
        end

      %{category: category_name, amount: abs(amount), full_path: account_name}
    end)
    |> Enum.filter(fn item -> item.amount > 0 end)
    |> Enum.sort_by(& &1.amount, :desc)
  end

  defp extract_income_categories(accounts) do
    accounts
    |> Enum.filter(&account_matches_type?(&1, "Income"))
    |> Enum.map(fn account ->
      account_name =
        cond do
          Map.has_key?(account, "account") -> account["account"]
          Map.has_key?(account, "aname") -> account["aname"]
          Map.has_key?(account, "name") -> account["name"]
          true -> ""
        end

      amount = extract_amount(account)

      # Extract category name (e.g., "Income:Salary" -> "Salary")
      category_name =
        if String.contains?(account_name, ":") do
          account_name
          |> String.split(":")
          |> Enum.drop(1)
          |> Enum.join(":")
        else
          String.replace_prefix(account_name, "Income", "")
        end

      %{category: category_name, amount: abs(amount), full_path: account_name}
    end)
    |> Enum.filter(fn item -> item.amount > 0 end)
    |> Enum.sort_by(& &1.amount, :desc)
  end

  @doc """
  Parses output from `ledger register` command (JSON or text format).

  Returns `{:ok, list_of_transactions}` on success or `{:error, reason}` on failure.
  Each transaction is a map with :date, :account, and :amount keys.
  """
  def parse_register(output_string) when is_binary(output_string) do
    require Logger
    trimmed = String.trim(output_string)

    if String.length(trimmed) == 0 do
      Logger.warning("Register output is empty")
      {:ok, []}
    else
      Logger.info(
        "Parsing register output, length: #{String.length(trimmed)}, first 200 chars: #{String.slice(trimmed, 0, 200)}"
      )

      # Try to parse as JSON first
      case Jason.decode(trimmed) do
        {:ok, parsed} when is_list(parsed) ->
          Logger.info("Parsed register JSON array with #{length(parsed)} entries")
          parse_hledger_register_json(parsed)

        {:ok, parsed} when is_map(parsed) ->
          Logger.info("Parsed register JSON object")
          parse_hledger_register_json([parsed])

        {:ok, _} ->
          Logger.warning("Register JSON format unexpected")
          {:error, "Expected JSON array or object from register command"}

        {:error, _} ->
          # Not JSON, try parsing as text output
          Logger.info("Register output is not JSON, parsing as text")
          parse_register_text(trimmed)
      end
    end
  end

  defp parse_hledger_register_json(entries) do
    require Logger
    Logger.info("Parsing #{length(entries)} register entries")

    transactions =
      entries
      |> Enum.flat_map(fn entry ->
        # hledger register JSON format can be:
        # 1. Array format: ["2022-12-31", nil, "Description", %{posting}, [balance]]
        # 2. Map format: %{t: {...}, apostings: [...]}
        # 3. Direct posting map: %{account: ..., amount: ...}

        cond do
          is_list(entry) and length(entry) >= 4 ->
            # Array format: [date, status, description, posting, balance]
            parse_hledger_register_array(entry)

          is_map(entry) and Map.has_key?(entry, "apostings") and is_list(entry["apostings"]) ->
            # Transaction with postings array
            date = extract_date_from_entry(entry)

            entry["apostings"]
            |> Enum.flat_map(fn posting ->
              account = extract_account_from_posting(posting)
              amount = extract_amount_from_posting(posting)

              if date && account && is_number(amount) do
                [%{date: date, account: account, amount: amount}]
              else
                []
              end
            end)

          is_map(entry) ->
            # Direct posting entry
            date = extract_date_from_entry(entry)
            account = extract_account_from_entry(entry)
            amount = extract_amount_from_entry(entry)

            if date && account && is_number(amount) do
              [%{date: date, account: account, amount: amount}]
            else
              Logger.debug(
                "Skipping entry: date=#{inspect(date)}, account=#{inspect(account)}, amount=#{inspect(amount)}"
              )

              []
            end

          true ->
            Logger.debug("Unknown entry format: #{inspect(entry)}")
            []
        end
      end)

    Logger.info("Extracted #{length(transactions)} transactions from register")

    # Log account type breakdown
    income_count = Enum.count(transactions, fn t -> String.starts_with?(t.account, "Income") end)

    expense_count =
      Enum.count(transactions, fn t -> String.starts_with?(t.account, "Expenses") end)

    asset_count = Enum.count(transactions, fn t -> String.starts_with?(t.account, "Assets") end)

    liability_count =
      Enum.count(transactions, fn t -> String.starts_with?(t.account, "Liabilities") end)

    Logger.info(
      "Transaction breakdown: Income=#{income_count}, Expenses=#{expense_count}, Assets=#{asset_count}, Liabilities=#{liability_count}"
    )

    if income_count > 0 do
      sample_income =
        Enum.find(transactions, fn t -> String.starts_with?(t.account, "Income") end)

      Logger.info("Sample income transaction: #{inspect(sample_income)}")
    end

    {:ok, transactions}
  end

  defp parse_hledger_register_array([date_str, _status, _description, posting, _balance])
       when is_map(posting) do
    date = parse_date(date_str)
    account = extract_account_from_posting(posting)
    amount = extract_amount_from_posting(posting)

    if date && account && is_number(amount) do
      [%{date: date, account: account, amount: amount}]
    else
      []
    end
  end

  defp parse_hledger_register_array(_), do: []

  defp extract_account_from_posting(posting) when is_map(posting) do
    cond do
      Map.has_key?(posting, "paccount") -> posting["paccount"]
      Map.has_key?(posting, "account") -> posting["account"]
      Map.has_key?(posting, "aname") -> posting["aname"]
      true -> nil
    end
  end

  defp extract_account_from_posting(_), do: nil

  defp extract_amount_from_posting(posting) when is_map(posting) do
    cond do
      Map.has_key?(posting, "pamount") ->
        # pamount can be an array of amount objects
        case posting["pamount"] do
          amount_list when is_list(amount_list) ->
            # Sum all amounts in the array
            Enum.reduce(amount_list, 0, fn amount_item, acc ->
              acc + extract_register_amount(amount_item)
            end)

          amount_item ->
            extract_register_amount(amount_item)
        end

      Map.has_key?(posting, "aamount") ->
        extract_register_amount(posting["aamount"])

      Map.has_key?(posting, "amount") ->
        extract_register_amount(posting["amount"])

      true ->
        0
    end
  end

  defp extract_amount_from_posting(_), do: 0

  defp extract_date_from_entry(entry) when is_map(entry) do
    cond do
      # hledger register JSON might have nested date structure
      Map.has_key?(entry, "tdate") ->
        case entry["tdate"] do
          date_str when is_binary(date_str) -> parse_date(date_str)
          date_map when is_map(date_map) -> extract_date_from_map(date_map)
          _ -> nil
        end

      Map.has_key?(entry, "date") ->
        case entry["date"] do
          date_str when is_binary(date_str) -> parse_date(date_str)
          date_map when is_map(date_map) -> extract_date_from_map(date_map)
          _ -> nil
        end

      # Check for nested transaction structure
      Map.has_key?(entry, "t") ->
        t = entry["t"]

        if is_map(t) and Map.has_key?(t, "tdate") do
          case t["tdate"] do
            date_str when is_binary(date_str) -> parse_date(date_str)
            _ -> nil
          end
        else
          nil
        end

      true ->
        nil
    end
  end

  defp extract_date_from_entry(_), do: nil

  defp extract_date_from_map(date_map) when is_map(date_map) do
    cond do
      Map.has_key?(date_map, "year") and Map.has_key?(date_map, "month") and
          Map.has_key?(date_map, "day") ->
        year = Map.get(date_map, "year", 2000)
        month = Map.get(date_map, "month", 1)
        day = Map.get(date_map, "day", 1)

        case Date.new(year, month, day) do
          {:ok, date} -> date
          _ -> nil
        end

      true ->
        nil
    end
  end

  defp extract_account_from_entry(entry) when is_map(entry) do
    cond do
      Map.has_key?(entry, "account") ->
        account = entry["account"]

        if is_binary(account) do
          account
        else
          nil
        end

      Map.has_key?(entry, "aname") ->
        account = entry["aname"]

        if is_binary(account) do
          account
        else
          nil
        end

      # Check for nested account structure
      Map.has_key?(entry, "apostings") ->
        # This might be a transaction with postings
        nil

      true ->
        nil
    end
  end

  defp extract_account_from_entry(_), do: nil

  defp extract_amount_from_entry(entry) when is_map(entry) do
    cond do
      Map.has_key?(entry, "aamount") ->
        extract_register_amount(entry["aamount"])

      Map.has_key?(entry, "amount") ->
        extract_register_amount(entry["amount"])

      true ->
        0
    end
  end

  defp extract_amount_from_entry(_), do: 0

  defp extract_register_amount(amount_data) when is_map(amount_data) do
    # Try to extract from hledger amount structure
    cond do
      Map.has_key?(amount_data, "aquantity") ->
        aq = amount_data["aquantity"]

        if is_map(aq) and Map.has_key?(aq, "floatingPoint") do
          aq["floatingPoint"] || 0
        else
          0
        end

      Map.has_key?(amount_data, "floatingPoint") ->
        amount_data["floatingPoint"] || 0

      true ->
        0
    end
  end

  defp extract_register_amount(amount) when is_number(amount), do: amount
  defp extract_register_amount(_), do: 0

  defp parse_date(date_string) when is_binary(date_string) do
    case Date.from_iso8601(date_string) do
      {:ok, date} -> date
      {:error, _} -> nil
    end
  end

  defp parse_date(_), do: nil

  defp parse_register_text(text) do
    require Logger
    lines = String.split(text, "\n", trim: true)
    Logger.info("Parsing register text with #{length(lines)} lines")

    transactions =
      lines
      |> Enum.map(fn line ->
        # Try different formats
        # Format 1: date|account|amount (from ledger/hledger --format)
        if String.contains?(line, "|") do
          parts = String.split(line, "|", trim: true)

          if length(parts) >= 3 do
            [date_str, account, amount_str] = Enum.take(parts, 3)
            date = parse_date(date_str)
            amount = parse_amount(amount_str)

            # Debug logging for income transactions - use info level so we can see it
            if String.starts_with?(account, "Income") do
              Logger.info(
                "Parsing income: account=#{account}, amount_str=#{inspect(amount_str)}, parsed_amount=#{amount}, date=#{inspect(date)}, line=#{String.slice(line, 0, 100)}"
              )
            end

            if date && account && is_binary(account) do
              %{date: date, account: account, amount: amount}
            else
              nil
            end
          else
            nil
          end
        else
          # Format 2: hledger register text format
          # Example: "2024-01-15 Expenses:Food                    $50.00"
          # Pattern: date, whitespace, account (may have spaces), whitespace, amount
          case Regex.run(
                 ~r/^(\d{4}-\d{2}-\d{2})\s+([A-Za-z][^\s]+(?:\s+[^\s]+)*?)\s+(-?\$?\d[\d,]*\.?\d*)/,
                 line
               ) do
            [_, date_str, account, amount_str] ->
              date = parse_date(date_str)
              amount = parse_amount(amount_str)

              if date && account && is_binary(account) do
                %{date: date, account: account, amount: amount}
              else
                nil
              end

            _ ->
              # Try simpler format: date account amount
              case Regex.run(
                     ~r/^(\d{4}[-\/]\d{2}[-\/]\d{2})\s+([^\s]+)\s+(-?\$?\d[\d,]*\.?\d*)/,
                     line
                   ) do
                [_, date_str, account, amount_str] ->
                  # Normalize date format
                  normalized_date = String.replace(date_str, "/", "-")
                  date = parse_date(normalized_date)
                  amount = parse_amount(amount_str)

                  if date && account && is_binary(account) do
                    %{date: date, account: account, amount: amount}
                  else
                    nil
                  end

                _ ->
                  nil
              end
          end
        end
      end)
      |> Enum.filter(&(!is_nil(&1)))

    Logger.info("Extracted #{length(transactions)} transactions from register text")
    {:ok, transactions}
  end
end
