#!/usr/bin/env node

'use strict';

try {
  require('../dist/index.js');
} catch (err) {
  if (err.code === 'MODULE_NOT_FOUND') {
    console.error(
      'Error: Redbis is not built. Please run "npm run build" first.\n' +
      'If you installed via npm, this should have been done automatically via the "prepare" script.'
    );
    process.exit(1);
  }
  throw err;
}