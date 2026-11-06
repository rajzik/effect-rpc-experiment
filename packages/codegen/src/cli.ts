#!/usr/bin/env node
/**
 * The `effect-trpc-codegen` binary (see `runCommand`).
 *
 * @since 0.1.0
 */
import { runCommand } from './command.js';

const code = runCommand(process.argv.slice(2));
if (code !== 0) process.exitCode = code;
