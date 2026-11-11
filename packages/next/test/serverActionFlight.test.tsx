// @vitest-environment jsdom
// Server action arguments cross Next's Flight serializer (`encodeReply`), which rejects class
// instances. A `Schema.Class` payload is sent in its plain encoded form and decoded on the server.
import { act, renderHook } from '@testing-library/react';
import { Exit } from 'effect';
import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';
import { createServerActionCaller, useServerAction } from '../src/index.js';
import { NoteInput, noteHandlers, noteRouter } from './flight-fixtures.js';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Next ships its Flight client untyped; `encodeReply` encodes server action arguments
const { encodeReply } = createRequire(import.meta.url)(
  'next/dist/compiled/react-server-dom-webpack/client.node.js',
) as { readonly encodeReply: (args: ReadonlyArray<unknown>) => Promise<string | FormData> };

/**
 * What the browser does with a server action reference: Flight-encode the arguments, then call
 * the action. Flight decodes plain objects and `Date`s to equal values, so `action` gets `args`.
 */
const viaFlight =
  <Args extends ReadonlyArray<unknown>, R>(action: (...args: Args) => Promise<R>) =>
  async (...args: Args): Promise<R> => {
    await encodeReply(args);
    return await action(...args);
  };

const at = new Date('2030-05-06T07:08:09.000Z');

test('Flight rejects a Schema.Class instance argument', async () => {
  await expect(encodeReply([new NoteInput({ title: 'hello', at })])).rejects.toThrow(
    /Classes or null prototypes are not supported/,
  );
});

test('useServerAction sends a Schema.Class payload through Flight; the handler gets the instance', async () => {
  const actions = createServerActionCaller(noteRouter, { handlers: noteHandlers });
  const createNote = viaFlight(actions('note.create'));
  const { result } = renderHook(() =>
    useServerAction(createNote, { router: noteRouter, path: 'note.create' }),
  );
  let exit: Exit.Exit<string, unknown> | undefined;
  await act(async () => {
    exit = await result.current.run({ title: 'hello', at });
  });
  expect(exit).toStrictEqual(Exit.succeed('HELLO @ 2030-05-06T07:08:09.000Z'));
  expect(result.current.data).toBe('HELLO @ 2030-05-06T07:08:09.000Z');
  await actions.dispose();
});
