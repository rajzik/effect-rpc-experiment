// The task board's server side through the in-process caller: auth, typed errors, pagination,
// the change feed and the test-only reset.
import { RpcDefect } from '@effect-trpc/core';
import { testCaller } from '@effect-trpc/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  appRouter,
  Forbidden,
  Task,
  TaskNotFound,
  Unauthorized,
  ValidationFailed,
} from '../src/domain';
import { cookieUser, makeServerLive } from '../src/server';

const caller = testCaller(appRouter, makeServerLive({ resolveUser: cookieUser }));
const as = (name: string) => ({ headers: { cookie: `session=${name}` } });

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
};

beforeEach(async () => {
  vi.stubEnv('EXAMPLES_TEST', '1');
  await caller.$promise.testing.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('task board server', () => {
  it('reset is a defect without EXAMPLES_TEST', async () => {
    vi.stubEnv('EXAMPLES_TEST', '');
    const error = await rejection(caller.$promise.testing.reset());
    expect(error).toBeInstanceOf(RpcDefect);
  });

  it('reset restores the seed data when EXAMPLES_TEST=1', async () => {
    await caller.$promise.tasks.create({ title: 'Scratch' }, as('ada'));
    await caller.$promise.testing.reset();
    const page = await caller.$promise.tasks.list({});
    expect(page.items.map((task) => task.title)).not.toContain('Scratch');
    await expect(caller.$promise.tasks.byId({ id: 13 })).rejects.toBeInstanceOf(TaskNotFound);
  });

  it('guest create is Forbidden', async () => {
    const error = await rejection(caller.$promise.tasks.create({ title: 'Nope' }, as('guest')));
    expect(error).toBeInstanceOf(Forbidden);
    expect(error).toMatchObject({ _tag: 'Forbidden', reason: 'guests cannot write' });
  });

  it('an empty title is a ValidationFailed', async () => {
    const error = await rejection(caller.$promise.tasks.create({ title: '   ' }, as('ada')));
    expect(error).toBeInstanceOf(ValidationFailed);
    expect(error).toMatchObject({ field: 'title', message: 'must not be empty' });
  });

  it('a call without a session is Unauthorized', async () => {
    await expect(caller.$promise.tasks.create({ title: 'x' })).rejects.toBeInstanceOf(Unauthorized);
    await expect(caller.$promise.session.me()).rejects.toBeInstanceOf(Unauthorized);
    await expect(caller.$promise.session.me(undefined, as('nobody'))).rejects.toBeInstanceOf(
      Unauthorized,
    );
  });

  it('session.me returns the signed-in user', async () => {
    const me = await caller.$promise.session.me(undefined, as('grace'));
    expect(me).toMatchObject({ name: 'grace', role: 'member' });
    const guest = await caller.$promise.session.me(undefined, as('guest'));
    expect(guest).toMatchObject({ name: 'guest', role: 'guest' });
  });

  it('a member creates a task that comes first in the list', async () => {
    const created = await caller.$promise.tasks.create({ title: 'Ship it' }, as('ada'));
    expect(created).toBeInstanceOf(Task);
    expect(created).toMatchObject({ id: 13, title: 'Ship it', done: false, assignee: 'ada' });
    const page = await caller.$promise.tasks.list({});
    expect(page.items[0]?.id).toBe(13);
  });

  it('list pages by 5 with a nextCursor', async () => {
    const first = await caller.$promise.tasks.list({});
    expect(first.items.map((task) => task.id)).toEqual([12, 11, 10, 9, 8]);
    expect(first.nextCursor).toBe(8);
    expect(first.items.every((task) => task instanceof Task)).toBe(true);

    const second = await caller.$promise.tasks.list({ cursor: first.nextCursor });
    expect(second.items.map((task) => task.id)).toEqual([7, 6, 5, 4, 3]);
    expect(second.nextCursor).toBe(3);

    const third = await caller.$promise.tasks.list({ cursor: second.nextCursor });
    expect(third.items.map((task) => task.id)).toEqual([2, 1]);
    expect(third.nextCursor).toBeNull();
  });

  it('seeds twelve tasks of which exactly one is overdue', async () => {
    const ids = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const tasks = await Promise.all(ids.map((id) => caller.$promise.tasks.byId({ id })));
    expect(tasks).toHaveLength(12);
    expect(tasks.filter((task) => task.isOverdue).map((task) => task.id)).toEqual([9]);
    expect(tasks[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('byId of an unknown id is TaskNotFound', async () => {
    const error = await rejection(caller.$promise.tasks.byId({ id: 999 }));
    expect(error).toBeInstanceOf(TaskNotFound);
    expect(error).toMatchObject({ _tag: 'TaskNotFound', id: 999 });
  });

  it('toggle flips done and a missing task is TaskNotFound', async () => {
    const toggled = await caller.$promise.tasks.toggle({ id: 12 }, as('ada'));
    expect(toggled.done).toBe(true);
    expect((await caller.$promise.tasks.byId({ id: 12 })).done).toBe(true);
    await expect(caller.$promise.tasks.toggle({ id: 999 }, as('ada'))).rejects.toBeInstanceOf(
      TaskNotFound,
    );
    await expect(caller.$promise.tasks.toggle({ id: 12 }, as('guest'))).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it('toggle publishes onChanged', async () => {
    const iterator = caller.$promise.tasks.onChanged()[Symbol.asyncIterator]();
    let received: IteratorResult<Task> | undefined;
    void iterator.next().then((result) => (received = result));
    // The subscription attaches asynchronously: keep toggling until the first change arrives.
    await vi.waitFor(async () => {
      await caller.$promise.tasks.toggle({ id: 12 }, as('ada'));
      expect(received).toBeDefined();
    });
    expect(received?.done).toBe(false);
    expect(received?.value).toBeInstanceOf(Task);
    expect(received?.value).toMatchObject({ id: 12 });
    await iterator.return?.();
  });

  it('create publishes onChanged', async () => {
    const iterator = caller.$promise.tasks.onChanged()[Symbol.asyncIterator]();
    let received: IteratorResult<Task> | undefined;
    void iterator.next().then((result) => (received = result));
    await vi.waitFor(async () => {
      await caller.$promise.tasks.create({ title: 'Announced' }, as('ada'));
      expect(received).toBeDefined();
    });
    expect(received?.value).toMatchObject({ title: 'Announced' });
    await iterator.return?.();
  });
});
