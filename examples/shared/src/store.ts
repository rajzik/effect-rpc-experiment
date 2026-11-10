/**
 * The in-memory task store: a `Ref` of tasks plus a `PubSub` that announces every change.
 *
 * The store is one per server process, kept on `globalThis` under a `Symbol.for` key: frameworks
 * bundle server code several times (Next.js builds route handlers, server components and server
 * actions as separate bundles), and each bundle must see the same tasks and the same change feed.
 */
import { Effect, PubSub, Ref } from 'effect';

import { PAGE_SIZE, Task, TaskNotFound, TaskPage } from './domain';
import { seedTasks } from './seed';

/** The store's operations; every one is an Effect and none needs a service. */
export interface Store {
  /** Newest first; `cursor` is the id of the last task of the previous page. */
  readonly list: (cursor: number | null | undefined) => Effect.Effect<TaskPage>;
  readonly byId: (id: number) => Effect.Effect<Task, TaskNotFound>;
  readonly create: (title: string, assignee: string) => Effect.Effect<Task>;
  readonly toggle: (id: number) => Effect.Effect<Task, TaskNotFound>;
  /** Every created or toggled task, as it happens. */
  readonly changes: PubSub.PubSub<Task>;
  /** Back to the seed data. */
  readonly reset: Effect.Effect<void>;
}

const makeStore = (): Store => {
  const tasks = Ref.makeUnsafe<ReadonlyArray<Task>>(seedTasks());
  const changes = Effect.runSync(PubSub.unbounded<Task>());

  const list: Store['list'] = (cursor) =>
    Effect.map(Ref.get(tasks), (all) => {
      const newestFirst = all.toReversed();
      const remaining =
        cursor === null || cursor === undefined
          ? newestFirst
          : newestFirst.filter((task) => task.id < cursor);
      const items = remaining.slice(0, PAGE_SIZE);
      const last = items.at(-1);
      return new TaskPage({
        items,
        nextCursor: remaining.length > PAGE_SIZE && last !== undefined ? last.id : null,
      });
    });

  const byId: Store['byId'] = (id) =>
    Effect.flatMap(Ref.get(tasks), (all) => {
      const task = all.find((candidate) => candidate.id === id);
      return task === undefined ? Effect.fail(new TaskNotFound({ id })) : Effect.succeed(task);
    });

  const create: Store['create'] = (title, assignee) =>
    Ref.modify(tasks, (all) => {
      const task = new Task({
        id: Math.max(0, ...all.map((candidate) => candidate.id)) + 1,
        title,
        done: false,
        assignee,
        createdAt: new Date(),
        dueAt: undefined,
      });
      return [task, [...all, task]] as const;
    }).pipe(Effect.tap((task) => PubSub.publish(changes, task)));

  const toggle: Store['toggle'] = (id) =>
    Ref.modify(tasks, (all) => {
      const current = all.find((candidate) => candidate.id === id);
      if (current === undefined) return [undefined, all] as const;
      const next = new Task({
        id: current.id,
        title: current.title,
        done: !current.done,
        assignee: current.assignee,
        createdAt: current.createdAt,
        dueAt: current.dueAt,
      });
      return [next, all.map((candidate) => (candidate.id === id ? next : candidate))] as const;
    }).pipe(
      Effect.flatMap((next) =>
        next === undefined
          ? Effect.fail(new TaskNotFound({ id }))
          : Effect.as(PubSub.publish(changes, next), next),
      ),
    );

  return { list, byId, create, toggle, changes, reset: Ref.set(tasks, seedTasks()) };
};

const key = Symbol.for('@rpc-effect-examples/shared/store');

/** The process-wide store. */
export const store: Store = Reflect.get(globalThis, key) ?? makeStore();
Reflect.set(globalThis, key, store);
