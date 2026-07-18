#!/bin/bash
# FlowTrace Build Script - Sets up workspace symlinks and builds all packages

set -e

ROOT=$(pwd)
cd "$ROOT"
TSC="./node_modules/typescript/bin/tsc"

# Create symlinks for workspace packages
echo "Setting up workspace symlinks..."

# Core
mkdir -p packages/core/node_modules/@flowtrace

# Adapter depends on core
mkdir -p packages/adapter/node_modules/@flowtrace
ln -sf ../../core/dist packages/adapter/node_modules/@flowtrace/core

# Runner depends on core and adapter
mkdir -p packages/runner/node_modules/@flowtrace
ln -sf ../../core/dist packages/runner/node_modules/@flowtrace/core
mkdir -p packages/runner/node_modules/@flowtrace/adapter
ln -sf ../../adapter/dist packages/runner/node_modules/@flowtrace/adapter

# Reporter depends on core
mkdir -p packages/reporter/node_modules/@flowtrace
ln -sf ../../core/dist packages/reporter/node_modules/@flowtrace/core

# AI depends on core
mkdir -p packages/ai/node_modules/@flowtrace
ln -sf ../../core/dist packages/ai/node_modules/@flowtrace/core

# CLI depends on core, adapter, runner, reporter
mkdir -p packages/cli/node_modules/@flowtrace
ln -sf ../../core/dist packages/cli/node_modules/@flowtrace/core
mkdir -p packages/cli/node_modules/@flowtrace/adapter
ln -sf ../../adapter/dist packages/cli/node_modules/@flowtrace/adapter
mkdir -p packages/cli/node_modules/@flowtrace/runner
ln -sf ../../runner/dist packages/cli/node_modules/@flowtrace/runner
mkdir -p packages/cli/node_modules/@flowtrace/reporter
ln -sf ../../reporter/dist packages/cli/node_modules/@flowtrace/reporter

# Build each package in order using individual tsconfigs
echo "Building packages..."

# Core (standalone, no workspace deps)
node $TSC --project packages/core/tsconfig.json

# Adapter (depends on core)
node $TSC --project packages/adapter/tsconfig.json

# Runner (depends on core, adapter)
node $TSC --project packages/runner/tsconfig.json

# Reporter (depends on core)
node $TSC --project packages/reporter/tsconfig.json

# AI (depends on core)
node $TSC --project packages/ai/tsconfig.json

# CLI (depends on core, adapter, runner, reporter)
node $TSC --project packages/cli/tsconfig.json

echo "Build complete!"
