# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Apple2TS is a fully-featured Apple IIe emulator written in TypeScript and React. It runs entirely in the browser using Web Workers for the emulation engine, providing authentic 6502 CPU emulation, disk drive support, sound synthesis, and debugging capabilities.

## Essential Development Commands

### Core Development
```bash
npm install          # Install dependencies
npm start            # Start development server (localhost:6502)
npm start --urlparam=speed=fast#Replay  # Start with specific emulator options
npm run build        # Build for production (outputs to dist/)
npm test             # Run all Jest unit tests
npm run lint         # Run ESLint
npm run lint-fix     # Run ESLint with auto-fix
```

### Specialized Commands
```bash
npm run host         # Start dev server accessible to network (for Android debugging)
npm test memory.test.ts        # Run specific test file
npm test -- --watch           # Run tests in watch mode
npm run preview               # Preview production build locally
```

### HTTPS Development (for gamepad support)
Install the [@vitejs/plugin-basic-ssl](https://github.com/vitejs/vite-plugin-basic-ssl) plugin (already configured) to enable HTTPS on localhost, required for gamepad functionality.

## Architecture Overview

### Multi-threaded Design
The emulator uses a strict UI/Worker separation enforced by ESLint rules:

- **UI Thread** (`src/ui/`): React components, user interface, audio/video output
- **Worker Thread** (`src/worker/`): 6502 CPU emulation, memory management, device emulation
- **Common** (`src/common/`): Shared types and utilities (no UI/Worker dependencies allowed)

Communication between threads happens through `main2worker.ts` and `worker2main.ts` message passing interfaces.

### Core Emulation Components

**CPU & Memory System:**
- `cpu6502.ts`: 6502 processor implementation with debugging support
- `instructions.ts`: Instruction execution and processor state management
- `memory.ts`: Memory mapping, bank switching, Apple IIe memory model
- `motherboard.ts`: System orchestration, save states, machine configuration

**Device Emulation:**
- `devices/drivestate.ts`: Floppy/hard disk drive emulation
- `devices/mockingboard.ts`: Sound card emulation  
- `devices/joystick.ts`: Gamepad and joystick support
- `devices/keyboard.ts`: Keyboard input processing
- `devices/mouse.ts`: Apple Mouse card emulation

**Graphics & Display:**
- `graphics.ts`, `graphicshgr.ts`: Apple II graphics modes (text, lores, hires)
- `canvas.tsx`: Main display canvas rendering
- `display.tsx`: Top-level display component orchestration

### UI Architecture

**Main Components:**
- `App.tsx`: Root component with i18n integration
- `controls/controlpanel.tsx`: Main emulator controls
- `panels/debugsection.tsx`: Debugging interface with disassembly
- `devices/disk/diskinterface.tsx`: Disk management UI

**Internationalization (i18n):**
- `i18n/index.ts`: Core translation system with localStorage persistence
- `i18n/useTranslation.ts`: React hook for component translations
- `i18n/languages/`: Language files (English, Traditional Chinese)

### Testing Strategy

**Unit Tests:** 
- CPU correctness: Klaus 6502 functional tests (`cpu6502.test.ts`)
- Memory system: Bank switching, AUX memory (`memory.test.ts`)
- Device emulation: Mockingboard, drive state tests
- Component tests using Jest with jsdom environment

**Integration Tests:**
- Full emulator state save/restore functionality
- Cross-thread message passing validation

## Key Development Patterns

### Worker Communication
```typescript
// UI to Worker
export const passSetRunMode = (runMode: RUN_MODE) => {
  doPostMessage(MSG_MAIN.RUN_MODE, runMode)
}

// Worker to UI  
export const passMachineState = (state: MachineState) => {
  doPostMessage(MSG_WORKER.MACHINE_STATE, state)
}
```

### Memory Bank Switching
The emulator implements authentic Apple IIe memory management with dynamic bank switching based on soft switch states. Memory access functions automatically handle main/aux RAM, ROM, and expansion card memory routing.

### State Management
- Emulator state is fully serializable for save/restore functionality
- React state updates trigger through the `updateDisplay` callback pattern
- Worker state is synchronized to UI through periodic machine state messages

### Breakpoint System
Advanced debugging with instruction-level, memory watchpoint, and conditional breakpoints. Breakpoints support complex expressions and one-time execution flags.

## Build and Deployment

**GitHub Actions:**
- `main-build-deploy.yml`: Builds and deploys to GitHub Pages on main branch pushes
- `pull-request-build-only.yml`: Build verification for pull requests

**Production Build:**
- Vite bundler with React SWC plugin for fast compilation
- Code splitting and chunk optimization (warning limit: 1500KB)
- Base64-encoded ROM assets for authentic Apple II system ROMs

## Project-Specific Considerations

**Performance:**
- 6502 CPU runs at authentic 1.023 MHz with cycle-accurate timing
- Graphics rendering optimized for 60fps browser refresh rates
- Web Worker isolation prevents UI blocking during intensive emulation

**Compatibility:**
- Cross-platform support (Windows, macOS, Linux, mobile browsers)
- Gamepad API integration with custom controller mapping
- File System Access API for local disk image management

**ROM and Asset Management:**
- Apple II ROMs stored as Base64-encoded TypeScript modules
- Disk images support .dsk, .woz, .po formats with authentic drive mechanics
- Cloud storage integration (Google Drive, OneDrive) for disk collections

## Code Quality Standards

- TypeScript strict mode with comprehensive type safety
- ESLint configuration prevents UI/Worker cross-imports
- React 18+ with modern hooks patterns and JSX transform
- Jest testing with 20-second timeout for CPU tests
