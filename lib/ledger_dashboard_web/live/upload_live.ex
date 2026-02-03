defmodule LedgerDashboardWeb.UploadLive do
  @moduledoc """
  LiveView for uploading and processing ledger files.
  """
  use LedgerDashboardWeb, :live_view

  alias LedgerDashboard.Ledger.{Analyzer, Storage, Upload}

  @impl true
  def mount(_params, session, socket) do
    socket =
      socket
      |> clear_flash()
      |> assign(:error, nil)
      |> assign(:session_id, Map.get(session, "_csrf_token", inspect(self())))
      |> allow_upload(:ledger,
        accept: :any,
        max_entries: 1,
        max_file_size: 2_000_000
      )

    {:ok, socket}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="grid grid-cols-1 gap-6 p-6 sm:gap-8 sm:p-8 lg:gap-12 lg:p-12 lg:max-w-2xl lg:mx-auto">
      <div class="col-span-1 mb-2">
        <h1 class="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl lg:text-4xl">
          Ledger Dashboard
        </h1>
        <p class="mt-3 text-base leading-7 text-zinc-600 sm:mt-4 sm:text-lg sm:leading-8">
          Upload your ledger file to analyze your financial data.
        </p>

        <.form
          for={%{}}
          phx-submit="save"
          phx-change="validate"
          multipart={true}
          class="mt-8 sm:mt-10"
        >
          <div>
            <label for="ledger" class="block text-sm font-medium leading-6 text-zinc-900">
              Ledger File
            </label>
            <div class="mt-3">
              <.live_file_input
                upload={@uploads.ledger}
                class="block w-full text-sm text-zinc-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-zinc-50 file:text-zinc-700 hover:file:bg-zinc-100"
              />
            </div>
            <.error :for={error <- consume_upload_errors(@uploads.ledger)}>
              {error}
            </.error>
          </div>

          <div :for={entry <- @uploads.ledger.entries} class="mt-6">
            <div class="flex items-center gap-2">
              <span class="text-sm text-zinc-600">{entry.client_name}</span>
              <span class="text-sm text-zinc-400">({format_file_size(entry.client_size)})</span>
            </div>
            <progress value={entry.progress} max="100" class="mt-3 w-full rounded-xl">
              {entry.progress}%
            </progress>
          </div>

          <div :if={@error} class="mt-6 rounded-xl bg-red-50 p-5">
            <div class="text-sm text-red-800">
              {@error}
            </div>
          </div>

          <div class="mt-8">
            <button
              type="submit"
              phx-disable-with="Analyzing..."
              class="w-full rounded-xl bg-zinc-900 hover:bg-zinc-700 py-3 px-6 text-sm font-semibold leading-6 text-white active:text-white/80 disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
            >
              Analyze Ledger
            </button>
          </div>
        </.form>
      </div>
    </div>
    """
  end

  @impl true
  def handle_event("validate", _params, socket) do
    upload = socket.assigns.uploads.ledger

    upload_errors =
      upload.errors
      |> Enum.map(fn {_entry, error} -> format_upload_error(error) end)

    socket =
      if Enum.empty?(upload_errors) do
        assign(socket, :error, nil)
      else
        error_message = "Upload error: #{Enum.join(upload_errors, ", ")}"
        assign(socket, :error, error_message)
      end

    {:noreply, socket}
  end

  defp format_upload_error(:too_large), do: "File is too large (max 2MB)"
  defp format_upload_error(:too_many_files), do: "Too many files (max 1)"
  defp format_upload_error(:not_accepted), do: "File type not accepted"
  defp format_upload_error(error), do: inspect(error)

  @impl true
  def handle_event("save", _params, socket) do
    if Enum.empty?(socket.assigns.uploads.ledger.entries) do
      {:noreply, assign(socket, :error, "Please select a file to upload")}
    else
      [entry] = socket.assigns.uploads.ledger.entries
      temp_file_path = nil

      try do
        with {:ok, temp_file_path} <- save_temp_file(socket),
             {:ok, upload} <- create_upload_struct(temp_file_path, entry),
             {:ok, analysis_result} <- Analyzer.analyze(upload) do
          session_id = get_session_id(socket)

          case safe_store(session_id, analysis_result) do
            :ok ->
              {:noreply,
               socket
               |> assign(:analysis_result, analysis_result)
               |> put_flash(:info, "Analysis complete")
               |> push_navigate(to: ~p"/dashboard")}

            {:error, reason} ->
              {:noreply,
               socket
               |> assign(:error, "Failed to store analysis result: #{inspect(reason)}")}
          end
        else
          {:error, reason} ->
            {:noreply, assign(socket, :error, format_error(reason))}
        end
      rescue
        error ->
          error_message = "An unexpected error occurred: #{Exception.message(error)}"
          {:noreply, assign(socket, :error, error_message)}
      after
        cleanup_temp_file(temp_file_path)
      end
    end
  end

  defp save_temp_file(socket) do
    result = consume_uploaded_entries(socket, :ledger, &save_uploaded_file/2)

    case result do
      [temp_file_path] when is_binary(temp_file_path) ->
        {:ok, temp_file_path}

      [] ->
        {:error, "No files were processed"}

      other ->
        {:error, "Unexpected upload result: #{inspect(other)}"}
    end
  end

  defp save_uploaded_file(%{path: path}, _entry) do
    uuid = generate_uuid()
    temp_dir = System.tmp_dir!()
    temp_filename = "ledger-#{uuid}.ledger"
    temp_file_path = Path.join(temp_dir, temp_filename)

    case File.cp(path, temp_file_path) do
      :ok ->
        {:ok, temp_file_path}

      {:error, reason} ->
        {:error, "Failed to save file: #{inspect(reason)}"}
    end
  end

  defp create_upload_struct(temp_file_path, entry) do
    upload = %Upload{
      path: temp_file_path,
      original_name: entry.client_name,
      size: entry.client_size,
      uploaded_at: DateTime.utc_now()
    }

    {:ok, upload}
  end

  defp cleanup_temp_file(nil), do: :ok

  defp cleanup_temp_file(temp_file_path) when is_binary(temp_file_path) do
    if File.exists?(temp_file_path) do
      File.rm(temp_file_path)
    end

    :ok
  end

  defp format_error(reason) when is_binary(reason), do: reason
  defp format_error(reason), do: "An error occurred: #{inspect(reason)}"

  defp format_upload_errors(errors) do
    errors
    |> Enum.map(fn {entry, error} ->
      "#{entry.client_name}: #{inspect(error)}"
    end)
    |> Enum.join(", ")
  end

  defp format_file_size(bytes) when is_integer(bytes) do
    cond do
      bytes < 1024 -> "#{bytes} B"
      bytes < 1_048_576 -> "#{Float.round(bytes / 1024, 1)} KB"
      true -> "#{Float.round(bytes / 1_048_576, 1)} MB"
    end
  end

  defp format_file_size(_), do: "Unknown size"

  defp consume_upload_errors(upload) do
    upload.entries
    |> Enum.flat_map(fn entry ->
      for {ref, error} <- upload.errors, ref == entry.ref do
        Phoenix.Naming.humanize(error)
      end
    end)
  end

  defp generate_uuid do
    :crypto.strong_rand_bytes(16)
    |> Base.encode16(case: :lower)
    |> String.slice(0, 32)
    |> String.replace(~r/(.{8})(.{4})(.{4})(.{4})(.{12})/, "\\1-\\2-\\3-\\4-\\5")
  end

  defp get_session_id(socket) do
    socket.assigns[:session_id] || inspect(self())
  end

  defp safe_store(session_id, analysis_result) do
    try do
      Storage.store(session_id, analysis_result)
      :ok
    rescue
      e ->
        require Logger
        Logger.error("Failed to store in Storage: #{inspect(e)}")
        {:error, Exception.message(e)}
    catch
      :exit, {:noproc, _} ->
        require Logger
        Logger.error("Storage process not available. Please restart the server.")
        {:error, "Storage not available"}
    end
  end
end
