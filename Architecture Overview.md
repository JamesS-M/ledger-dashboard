Architecture Overview (for the IDE)
• Framework: Phoenix + LiveView
• Persistence: None
• Ledger processing: Run ledger-cli via System.cmd/3
• Security model:
• Upload → temp file → analyze → delete
• No file storage
• UX:
• Landing page with file upload
• Dashboard rendered via LiveView
• Placeholder metrics initially

⸻

Data Types (Schemas / Structs)

We will use plain Elixir structs. “Schema” here means data shape, not Ecto schema.

Create these under lib/ledger_dashboard/ledger/.

⸻

1. LedgerDashboard.Ledger.Upload

Represents the uploaded ledger file and metadata.

```elixir
defmodule LedgerDashboard.Ledger.Upload do
  @enforce_keys [:path, :original_name]
  defstruct [
    :path,
    :original_name,
    :size,
    :uploaded_at
  ]
end
```

Purpose:
• Encapsulate temp file info
• Keep upload handling clean

⸻

2. LedgerDashboard.Ledger.Summary

High-level dashboard summary.

```elixir
defmodule LedgerDashboard.Ledger.Summary do
  defstruct [
    :total_expenses,
    :total_assets,
    :total_liabilities,
    :net_worth
  ]
end
```

Purpose:
• Placeholder values initially
• Grows over time

⸻

3. LedgerDashboard.Ledger.AnalysisResult

Top-level analysis payload.

```elixir
defmodule LedgerDashboard.Ledger.AnalysisResult do
  defstruct [
    :summary,
    :generated_at,
    :raw
  ]
end
```

• raw may hold raw ledger-cli JSON for debugging
• summary is frontend-facing

⸻

4. (Optional later) LedgerDashboard.Ledger.CommandResult

Wrapper around ledger-cli execution.

```elixir
defmodule LedgerDashboard.Ledger.CommandResult do
  defstruct [
    :stdout,
    :stderr,
    :exit_code
  ]
end
```

Core Modules to Implement

Place under lib/ledger_dashboard/ledger/.

⸻

LedgerDashboard.Ledger.Runner

Responsible for executing ledger-cli.

Responsibilities:
• Accept path to ledger file
• Execute predefined commands
• Return parsed results
• Enforce timeout

Key details:
• Use System.cmd/3
• Use absolute path to ledger
• Pass --json
• Never persist files

Example responsibilities (not full code):
• run_balance/1
• run_register/1

⸻

LedgerDashboard.Ledger.Parser

Responsibilities:
• Convert raw ledger JSON into domain structs
• Normalize signs (expenses positive)
• Extract placeholder totals

Initial scope:
• Parse total expenses
• Parse total assets

⸻

LedgerDashboard.Ledger.Analyzer

Orchestrator.

Responsibilities: 1. Receive Upload 2. Run ledger-cli via Runner 3. Parse outputs via Parser 4. Return AnalysisResult

⸻

LiveView Plan

Everything below assumes LiveView.

⸻

Landing Page LiveView

Module: LedgerDashboardWeb.UploadLive

Route:

```elixir
live "/", UploadLive
```

Responsibilities
• Render a landing page
• Show:
• Title
• Short description
• File upload form
• Handle file upload
• On submit:
• Validate file exists
• Save to temp dir
• Trigger analysis
• Navigate to dashboard view

LiveView Upload Config

Use:

```elixir
allow_upload :ledger,
  accept: ~w(.ledger .txt),
  max_entries: 1,
  max_file_size: 2_000_000
```

Dashboard LiveView

Module: LedgerDashboardWeb.DashboardLive

Route:

```elixir
live "/dashboard", DashboardLive
```

Responsibilities
• Receive AnalysisResult
• Render:
• Summary cards
• Placeholder values
• No persistence
• No client-side JS frameworks

⸻

Ledger CLI Execution Plan

How ledger-cli is run
• Ledger file written to:
• System.tmp_dir!() <> "/ledger-<uuid>.ledger"
• Commands:

```sh
ledger -f <file> balance --json
ledger -f <file> register --json
```

    •	Execution:
    •	System.cmd("ledger", args, stderr_to_stdout: true, timeout: 5_000)
    •	Cleanup:
    •	Always delete temp file

Assumptions
• ledger is in $PATH
• Later: bundle via Docker

⸻

Initial Dashboard Metrics (Placeholders)

These are intentionally simple.

Show:
• Total Expenses
• From ledger balance Expenses
• Total Assets
• From ledger balance Assets
• Total Liabilities
• From ledger balance Liabilities
• Net Worth
• Assets – Liabilities

All values:
• Displayed as plain numbers
• No charts yet

⸻

LiveView Templates

Upload Page (upload_live.html.heex)

Checklist:
• Header
• Short explanation
• File input
• Submit button
• Upload progress
• Error display

⸻

Dashboard Page (dashboard_live.html.heex)

Checklist:
• Grid layout
• 4 “cards”
• Each card:
• Label
• Value
• Placeholder text for future charts

Checklist as summary:

# Ledger Dashboard – Implementation Checklist

## Project Setup

- [ ] Create Phoenix project with no Ecto, no assets
- [ ] Confirm LiveView is enabled
- [ ] Add root LiveView route

## Domain Layer (lib/ledger_dashboard/ledger)

- [ ] Define Upload struct
- [ ] Define Summary struct
- [ ] Define AnalysisResult struct
- [ ] Implement Ledger.Runner
  - [ ] Run `ledger balance --json`
  - [ ] Enforce timeout
- [ ] Implement Ledger.Parser
  - [ ] Extract total expenses
  - [ ] Extract total assets
  - [ ] Extract liabilities
- [ ] Implement Ledger.Analyzer
  - [ ] Orchestrate runner + parser
  - [ ] Return AnalysisResult

## Upload LiveView

- [ ] Render landing page
- [ ] Configure file upload
- [ ] Handle upload submission
- [ ] Write file to temp dir
- [ ] Call Analyzer
- [ ] Redirect to dashboard

## Dashboard LiveView

- [ ] Accept AnalysisResult assigns
- [ ] Render summary cards
- [ ] Display placeholder metrics
- [ ] Handle error states

## Safety & Cleanup

- [ ] Ensure temp files are deleted
- [ ] Limit upload size
- [ ] Add execution timeout
- [ ] Handle ledger-cli failure gracefully

## Future Hooks

- [ ] Leave TODOs for charts
- [ ] Leave TODOs for date filtering
