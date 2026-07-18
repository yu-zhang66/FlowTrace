# Supply Chain Project - FlowTrace Configuration

## Project Overview

This project contains the FlowTrace configuration for the supply-chain financing application approval process.

## Current Status

The new process is not yet implemented. During this phase:
- Current adapter uses legacy-shadow mode (delegates to legacy adapter)
- Reports will state that this validates the harness only
- Once the new process is implemented, only the current adapter needs to be replaced

## Running FlowTrace

```bash
# Navigate to FlowTrace root
cd /path/to/FlowTrace

# Collect baseline facts
pnpm flowtrace collect --project ../supply_chain

# Generate test scenarios (requires AI configuration)
pnpm flowtrace generate-cases --project ../supply_chain

# Validate scenarios
pnpm flowtrace validate-cases --project ../supply_chain

# Run verification
pnpm flowtrace verify --project ../supply_chain

# Generate report
pnpm flowtrace report --project ../supply_chain --format html
```

## Project Structure

```
projects/supply-chain/
├── adapters/          # Flow adapters (legacy, current)
├── facts/             # Collected baseline facts
├── mappings/          # State/node mappings
├── scenarios/         # Test scenarios
├── fixtures/          # Test data fixtures
├── mocks/             # External system mocks
└── reports/           # Verification reports
```

## Adapters

### Legacy Adapter
- Implements the current production process
- Located at: `adapters/LegacyFlowAdapter.ts`

### Current Adapter
- Placeholder for the new process (currently uses legacy-shadow)
- Located at: `adapters/CurrentFlowAdapter.ts`
- Will be replaced when new process is ready
