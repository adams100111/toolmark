#!/usr/bin/env node
// The `toolmark` bin (package.json `bin`). Always runs: an `import.meta.url === argv[1]` "is main
// module" guard is false when the bin is invoked through an npm/npx `.bin` symlink, which silently
// made the CLI a no-op (exit 0). Importable code lives in `cli.ts`.
import { main } from './cli.js'

void main()
