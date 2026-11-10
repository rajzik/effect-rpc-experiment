'use client';
/** The "new task" form: a "Title" textbox and a "Create" button. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { exitToClientError, type ClientError } from '@rpc-effect/core';
import type { RpcOptionsProxy } from '@rpc-effect/tanstack-react-query';
import { Option, type Exit } from 'effect';
import { useState, type FormEvent } from 'react';

import type { AppRouter, Forbidden, Task, Unauthorized, ValidationFailed } from '../domain';
import { ErrorAlert } from './errors';
import { useHydrated } from './useHydrated';

type CreateError = Forbidden | Unauthorized | ValidationFailed;

/** Props of {@link NewTaskForm}. */
export interface NewTaskFormProps {
  readonly rpc: RpcOptionsProxy<AppRouter>;
  /**
   * Creates the task in place of the default `tasks.create` mutation, e.g. a Next.js server
   * action. Resolve with the call's `Exit` (a failure is shown as an alert) or with nothing when
   * it succeeded.
   */
  readonly submit?: (title: string) => Promise<Exit.Exit<Task, ClientError<CreateError>> | void>;
}

/** Creates a task; a typed failure appears as an `alert` and the list refreshes on success. */
export function NewTaskForm({ rpc, submit }: NewTaskFormProps) {
  const queryClient = useQueryClient();
  const hydrated = useHydrated();
  const [title, setTitle] = useState('');
  const [submitError, setSubmitError] = useState<ClientError<CreateError> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const refreshList = () => queryClient.invalidateQueries(rpc.tasks.list.pathFilter());
  const create = useMutation(
    rpc.tasks.create.mutationOptions({
      onSuccess: (task) => {
        setTitle('');
        queryClient.setQueryData(rpc.tasks.byId.queryKey({ id: task.id }), task);
        return refreshList();
      },
    }),
  );

  const send = async (run: NonNullable<NewTaskFormProps['submit']>, value: string) => {
    setSubmitting(true);
    try {
      const exit = await run(value);
      const failure = exit === undefined ? Option.none() : exitToClientError(exit);
      setSubmitError(Option.getOrNull(failure));
      if (Option.isNone(failure)) {
        setTitle('');
        await refreshList();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submit === undefined) {
      create.mutate({ title });
      return;
    }
    void send(submit, title);
  };

  return (
    <form onSubmit={onSubmit} data-hydrated={hydrated}>
      <label>
        Title{' '}
        <input name="title" value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>{' '}
      <button type="submit" disabled={create.isPending || submitting}>
        Create
      </button>
      <ErrorAlert error={submit === undefined ? create.error : submitError} />
    </form>
  );
}
