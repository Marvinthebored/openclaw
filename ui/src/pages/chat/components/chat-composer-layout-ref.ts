import { onSettled } from "solid-js";
import { createLayoutMeasurement } from "../../../lib/reactive/layout-measurement.ts";
import { listen } from "../../../lib/reactive/listener.ts";
import {
  composerLayoutTargets,
  measureComposerLayout,
  type ComposerLayoutOptions,
} from "./chat-composer-layout.ts";
import type { ChatComposerState } from "./chat-composer-types.ts";

/** Bind the shared geometry owner after Solid commits the surface and its children. */
export function createComposerLayoutRef(
  options: () => ComposerLayoutOptions,
  active: () => boolean = () => true,
) {
  let input: HTMLElement | undefined;
  let shell: HTMLElement | undefined;
  const clear = () => input?.style.removeProperty("--chat-composer-editor-height-limit");
  const schedule = createLayoutMeasurement(
    () => ({ value: options(), active: active() }),
    (next) => {
      if (next?.active && input) {
        return measureComposerLayout(input, next.value);
      }
      return clear;
    },
    {
      targets: (next) => composerLayoutTargets(input, shell, next?.value),
      mutations: () => shell!,
    },
  );
  onSettled(() => {
    // Pane observers cover layout resizing; the visual viewport also covers the keyboard.
    const stopViewport = window.visualViewport && listen(window.visualViewport, "resize", schedule);
    return () => {
      stopViewport?.();
      clear();
    };
  });
  return Object.assign(
    (element: HTMLElement) => {
      if (input !== element) {
        clear();
        input = element;
        schedule();
      }
    },
    {
      shell: (element: HTMLElement) => {
        shell = element;
      },
    },
  );
}

/** Bind the chat editor and its surrounding footer content. */
export function createComposerViewLayoutRef(
  state: Pick<ChatComposerState, "composerTextarea">,
  active: () => boolean,
) {
  let context: HTMLElement | undefined;
  const ref = createComposerLayoutRef(
    () => ({
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
