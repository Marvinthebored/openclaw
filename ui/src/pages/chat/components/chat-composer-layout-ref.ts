import { createMemo, onSettled } from "solid-js";
import { createLayoutMeasurement } from "../../../lib/reactive/layout-measurement.ts";
import { createPointerDrag } from "../../../lib/reactive/pointer-drag.ts";
import { ComposerLayout, type ComposerLayoutOptions } from "./chat-composer-layout.ts";
import type { ChatComposerProps, ChatComposerState } from "./chat-composer-types.ts";

/** Bind the shared geometry owner after Solid commits the surface and its children. */
export function createComposerLayoutRef(
  options: () => ComposerLayoutOptions,
  active: () => boolean = () => true,
) {
  const layout = new ComposerLayout(createPointerDrag());
  let input: HTMLElement | undefined;
  let shell: HTMLElement | undefined;
  const binding = createMemo(() => ({ value: options(), active: active() }));
  createLayoutMeasurement(
    binding,
    () => {
      const next = binding();
      if (next.active && input) {
        layout.update(input, next.value);
      } else {
        layout.disconnect();
      }
    },
    {
      targets: () => [shell, ...layout.targets()].filter((node): node is Element => Boolean(node)),
      mutations: () => shell!,
    },
  );
  onSettled(() => () => layout.disconnect());
  return Object.assign(
    (element: HTMLElement) => {
      input = element;
    },
    {
      shell: (element: HTMLElement) => {
        shell = element;
      },
    },
  );
}

/** The chat composer's binding: width and drag from props, the editor from state, context by ref. */
export function createComposerViewLayoutRef(
  props: Pick<ChatComposerProps, "chatMessageMaxWidth" | "onComposerWidthChange">,
  state: Pick<ChatComposerState, "composerTextarea">,
  active: () => boolean,
) {
  let context: HTMLElement | undefined;
  const ref = createComposerLayoutRef(
    () => ({
      width: props.chatMessageMaxWidth,
      onWidthChange: props.onComposerWidthChange,
      getEditor: () => state.composerTextarea,
      getContext: () => context,
    }),
    active,
  );
  return Object.assign(ref, {
    context: (element: HTMLElement) => {
      context = element;
    },
  });
}
