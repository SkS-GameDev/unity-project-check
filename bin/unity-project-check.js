#!/usr/bin/env node

const { run } = await import('../out/src/cli.js');
process.exit(await run(process.argv.slice(2)));
