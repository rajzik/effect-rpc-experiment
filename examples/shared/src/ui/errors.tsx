/**
 * Typed errors in the UI: one place that turns a client error into the text users see, and the
 * alert that shows it.
 */
import type { ClientError } from '@rpc-effect/core';

import type { Forbidden, TaskNotFound, Unauthorized, ValidationFailed } from '../domain';

/** Every domain error a task board call can fail with. */
export type TaskBoardError = TaskNotFound | Forbidden | Unauthorized | ValidationFailed;

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The user-facing text of an error: `Task #<id> not found`, `Forbidden: <reason>`,
 * `Sign in first`, `<Field>: <message>`; anything else (defects, transport failures) is a
 * generic message.
 */
export const describeError = (error: ClientError<TaskBoardError>): string => {
  switch (error._tag) {
    case 'TaskNotFound':
      return `Task #${error.id} not found`;
    case 'Forbidden':
      return `Forbidden: ${error.reason}`;
    case 'Unauthorized':
      return 'Sign in first';
    case 'ValidationFailed':
      return `${capitalize(error.field)}: ${error.message}`;
    default:
      return 'Something went wrong';
  }
};

/** Renders an error as an `alert`; renders nothing without an error. */
export function ErrorAlert({ error }: { readonly error: ClientError<TaskBoardError> | null }) {
  return error === null ? null : <p role="alert">{describeError(error)}</p>;
}
