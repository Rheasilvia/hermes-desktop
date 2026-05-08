# Usage Analytics Feature

## Overview

The Usage Analytics feature provides comprehensive model usage statistics and cost tracking for the Hermes Desktop application. It replaces the previous Models tab with a full-featured analytics dashboard that helps users understand their AI model consumption patterns and associated costs.

## Architecture

### Data Flow

```
User Interaction (ModelUsageView)
    ↓
analyticsStore (state management)
    ↓
API Client (src/services/api/)
    ↓
Analytics Transport (HTTP/Mock)
    ↓
Python Backend (desktop_backend)
```

### Components

#### Store Layer
- **`src/stores/analytics.ts`** - Main analytics store using SolidJS signals
  - Manages loading/error/data states
  - Handles period management (7/30/90 days)
  - Provides singleton instance for app-wide usage
  - Guards against concurrent loads and race conditions

#### API Layer
- **`src/services/api/transports/http/analytics.ts`** - HTTP transport for production
  - `getModelAnalytics(days)` - Fetches analytics data from Python backend
  - Validates and sanitizes input parameters
  - Type-safe response handling

- **`src/services/api/transports/mock/analytics.ts`** - Mock transport for development/testing
  - Returns empty response for offline development
  - Maintains same interface as HTTP transport

#### Type Definitions
- **`src/types/analytics.ts`** - TypeScript interfaces
  - `ModelAnalyticsResponse` - Top-level response structure
  - `ModelUsageStat` - Individual model statistics
  - `UsageTotals` - Aggregated totals across all models
  - `ModelCapabilities` - Model feature flags (vision, function_calling, streaming)
  - `AnalyticsPeriod` - Valid period values (7 | 30 | 90)

#### UI Components
- **`ModelUsageView.tsx`** - Main analytics dashboard
  - Orchestrates data loading and display
  - Handles period switching with explicit reload calls
  - Shows loading, error, and empty states

- **`UsageSummaryBar.tsx`** - Summary statistics bar
  - Displays aggregated totals (sessions, tokens, cost)
  - Period picker (7/30/90 days)
  - Responsive number formatting (K/M suffixes)

- **`ModelUsageCard.tsx`** - Individual model stat card
  - Model display name and provider
  - Session count, token usage, cost
  - Active model indicator
  - Relative time formatting for "last used"

## Data Models

### ModelAnalyticsResponse
```typescript
interface ModelAnalyticsResponse {
  models: ModelUsageStat[];      // Array of individual model stats
  totals: UsageTotals;            // Aggregated totals
  period_days: number;            // Requested period (7/30/90)
  generated_at: string;           // ISO timestamp of data generation
}
```

### ModelUsageStat
```typescript
interface ModelUsageStat {
  provider: string;               // Provider name (e.g., "anthropic")
  model: string;                  // Model identifier (e.g., "claude-sonnet-4-6")
  display_name: string | null;    // Human-readable name
  session_count: number;          // Number of sessions using this model
  input_tokens: number;           // Total input tokens consumed
  output_tokens: number;          // Total output tokens consumed
  total_tokens: number;           // Sum of input + output tokens
  cost_usd: number;              // Total cost in USD
  last_used_at: string | null;    // ISO timestamp of last usage
  capabilities: ModelCapabilities; // Feature flags
}
```

### UsageTotals
```typescript
interface UsageTotals {
  total_sessions: number;         // Total sessions across all models
  total_input_tokens: number;     // Total input tokens across all models
  total_output_tokens: number;    // Total output tokens across all models
  total_tokens: number;           // Grand total tokens
  total_cost_usd: number;        // Grand total cost in USD
}
```

## API Endpoints

### GET `/desktop/api/analytics/models?days={days}`

Fetches model usage analytics for the specified period.

**Query Parameters:**
- `days` (optional): Number of days to analyze (default: 30, valid: 7/30/90)

**Response:** `ModelAnalyticsResponse`

**Example Request:**
```typescript
const response = await api.analytics().getModelAnalytics(30);
```

**Example Response:**
```json
{
  "models": [
    {
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "display_name": "Claude Sonnet 4.6",
      "session_count": 42,
      "input_tokens": 125000,
      "output_tokens": 89000,
      "total_tokens": 214000,
      "cost_usd": 0.6420,
      "last_used_at": "2026-05-08T10:30:00Z",
      "capabilities": {
        "vision": true,
        "function_calling": true,
        "streaming": true
      }
    }
  ],
  "totals": {
    "total_sessions": 42,
    "total_input_tokens": 125000,
    "total_output_tokens": 89000,
    "total_tokens": 214000,
    "total_cost_usd": 0.6420
  },
  "period_days": 30,
  "generated_at": "2026-05-08T11:00:00Z"
}
```

## Usage Patterns

### Basic Data Loading
```typescript
import { analyticsStore } from '@/stores/analytics.js';

// Load default period (30 days)
await analyticsStore.load();

// Load specific period
await analyticsStore.load(7);
```

### Period Switching
```typescript
// Update period (does NOT trigger reload)
analyticsStore.setPeriod(90);

// Explicitly reload after period change
await analyticsStore.load(90);
```

### Reacting to State Changes
```typescript
import { analyticsStore } from '@/stores/analytics.js';

// Check loading state
if (analyticsStore.isLoading()) {
  // Show loading indicator
}

// Access current data
const data = analyticsStore.data();
if (data) {
  console.log(`Total cost: $${data.totals.total_cost_usd}`);
}

// Handle errors
if (analyticsStore.error()) {
  console.error(`Analytics error: ${analyticsStore.error()}`);
}
```

## UI Integration

The analytics feature integrates with the existing model management system:

- **Active Model Detection**: Cards show an "active" badge for the currently selected model
- **Model Store Integration**: Uses `modelStore.activeProvider` and `modelStore.activeModel` for detection
- **Navigation**: Replaces the previous Models tab in the main navigation

## Testing

### Unit Tests
- **`src/stores/__tests__/analytics.test.ts`** - Store behavior tests
  - Concurrent load protection
  - Period management
  - Error handling
  - State updates

### Mock Transport Usage
```typescript
import { makeMockAnalyticsTransport } from '@/services/api/transports/mock/analytics.js';

const mockTransport = makeMockAnalyticsTransport();
const result = await mockTransport.getModelAnalytics(30);
// Returns empty response for development/testing
```

## Error Handling

The analytics feature includes comprehensive error handling:

1. **Network Errors**: Caught and displayed in the UI with user-friendly messages
2. **Invalid Periods**: Defaults to 30 days if invalid value provided
3. **Concurrent Loads**: Uses sequence numbers to prevent race conditions
4. **Empty States**: Graceful handling when no usage data exists

## Performance Considerations

- **Concurrent Load Guards**: Prevents multiple simultaneous requests
- **Sequence Numbers**: Ensures only the latest request updates state
- **Lazy Loading**: Data only loaded when component mounts
- **Explicit Reloads**: Period changes require explicit `load()` call

## Future Enhancements

Potential improvements for the analytics feature:

- **Cost Breakdowns**: More detailed cost analysis by feature/endpoint
- **Trends**: Historical usage patterns and predictions
- **Export**: CSV/JSON export functionality
- **Filters**: Filter by session type, time range, or model capabilities
- **Visualizations**: Charts and graphs for usage patterns

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) - Overall architecture and store patterns
- [DESIGN.md](../DESIGN.md) - Design system and UI components
- [README.md](../README.md) - Project overview and setup