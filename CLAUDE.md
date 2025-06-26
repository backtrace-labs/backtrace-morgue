# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `backtrace-morgue`, a command-line interface (CLI) tool for interacting with the Backtrace object store. The tool allows users to upload, download, query, and manage crash reports and debugging data in the Backtrace error reporting system.

## Development Commands

### Build
```bash
# Install dependencies
npm install

# Build the project (compiles with Babel to dist/)
gulp compile  # or just 'gulp'

# Clean build artifacts
gulp clean
```

### Lint
```bash
npm run lint
```

### Running the CLI
```bash
# After building, the CLI is available at:
./bin/morgue.js [command] [options]

# Or if installed globally:
morgue [command] [options]
```

## Architecture Overview

### Core Structure
- **Entry Points**:
  - CLI: `bin/morgue.js` - Main command router and CLI interface
  - Library: `lib/coroner.js` - Core client class for API interactions

### Key Components
1. **Command System** (`bin/morgue.js`):
   - Modular command architecture where each command is a separate module
   - Commands are dynamically loaded and registered
   - Each command module exports: name, synopsis, description, helpDetail, and fn

2. **API Client** (`lib/coroner.js`):
   - Central client class handling all Backtrace API interactions
   - Manages authentication, HTTP requests, and response handling
   - Configuration stored in `~/.morgue`

3. **Service Modules** (`lib/`):
   - `crdb.js` - Database query and aggregation functionality
   - `callstack.js` - Callstack analysis and processing
   - `symbold.js` - Symbol server management
   - `bpg.js` - Binary protocol handling

4. **Workflow System** (`lib/workflows/`):
   - Extensible plugin architecture for integrations
   - Models for CRUD operations on workflows, connections, and alerts
   - Plugin examples: S3 export, Slack notifications

5. **CLI Utilities** (`lib/cli/`):
   - Error handling and user-friendly error messages
   - Query parsing and time range handling
   - Option processing and validation

### Build System
- Uses Gulp with Babel for ES6+ transpilation
- Source files in `lib/` and `bin/` are compiled to `dist/`
- Assets and package.json are copied to dist during build

### Key Design Patterns
1. **Command Pattern**: Each CLI command is self-contained with its own module
2. **Client-Server Architecture**: Acts as a rich client to Backtrace's REST API
3. **Configuration Management**: User config stored in home directory
4. **Plugin System**: Extensible architecture for workflow integrations

### Important Implementation Notes
- Uses Node.js 14.17.0+ features
- HTTP client: Primarily uses `axios` and `request` for API calls
- Authentication: Token-based with support for SSO
- Error tracking: Dogfoods Backtrace for its own error reporting
- No formal test suite - testing appears to be manual or external

### Common Development Tasks
When adding new features:
1. For new CLI commands: Create a new module in `bin/` following the existing pattern
2. For API functionality: Extend `lib/coroner.js` or create new service modules
3. For workflow integrations: Add plugins to `lib/workflows/plugins/`
4. Always run `npm run lint` before committing
5. Build with `gulp` to ensure compilation succeeds

### API Interaction Patterns
- All API calls go through the coroner client
- Error responses are normalized and presented with user-friendly messages
- Supports both promise-based and callback patterns
- Request cancellation via AbortController for long-running operations