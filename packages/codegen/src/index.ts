/**
 * `@effect-trpc/codegen`: generates the schemas of routers written with the `Procedure` builder
 * without `.output` / `.error`, from the handler types (TypeScript 7 checker API). The CLI is
 * `effect-trpc-codegen`; the Vite plugin is `@effect-trpc/codegen/vite`.
 *
 * @since 0.1.0
 */
export {
  createGenerator,
  generate,
  type GeneratedFile,
  type GenerateOptions,
  type GenerateResult,
  type Generator,
  type ProcedureReport,
} from './generate.js';
export { runCommand, type CommandIO } from './command.js';
