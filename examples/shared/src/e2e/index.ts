/**
 * Playwright helpers of the task board, shared by the three example suites: a page object, the
 * shared scenarios, a console-error guard and the data reset. Import from
 * `@rpc-effect-examples/shared/e2e` in a test file only (it needs `@playwright/test`).
 */
export { httpBoards, type Boards } from './boards';
export { failOnConsoleErrors, type ConsoleErrorGuard } from './console';
export { resetData } from './reset';
export { sharedScenarios, type SharedScenarioOptions } from './scenarios';
export { httpAdapter, TaskBoardPage, type TaskBoardAdapter } from './TaskBoardPage';
