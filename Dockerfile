# Build stage
FROM hexpm/elixir:1.18.4-erlang-26.0-debian-bookworm-20240130 AS builder

# Install build dependencies
RUN apt-get update && \
    apt-get install -y build-essential git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install hex and rebar
RUN mix local.hex --force && \
    mix local.rebar --force

# Install Node.js for asset compilation
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Copy dependency files
COPY mix.exs mix.lock ./
COPY config config

# Install dependencies
RUN mix deps.get --only prod && \
    mix deps.compile

# Copy assets
COPY assets assets
COPY priv priv

# Compile assets
RUN mix assets.deploy

# Copy application code
COPY lib lib

# Compile application
RUN mix compile

# Build release
RUN mix release

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies including hledger
RUN apt-get update && \
    apt-get install -y \
      ca-certificates \
      hledger \
      libssl3 \
      openssl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create non-root user
RUN groupadd -r appuser && \
    useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app

# Copy release from builder
COPY --from=builder --chown=appuser:appuser /app/_build/prod/rel/ledger_dashboard .

USER appuser

# Expose port
EXPOSE 4000

# Set environment
ENV PHX_SERVER=true
ENV MIX_ENV=prod

# Start the application
CMD ["./bin/ledger_dashboard", "start"]

