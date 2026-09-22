import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/*
 * Unmount whatever a test rendered.
 *
 * React Testing Library registers this itself only when the test framework
 * exposes a global `afterEach`. Vitest does not enable globals by default, so
 * without this the DOM accumulates across tests in a file and queries such as
 * getByRole start matching nodes left behind by earlier renders.
 */
afterEach(() => {
  cleanup();
});

/*
 * jsdom implements <dialog> only partially: the `open` attribute reflects
 * correctly, but `showModal()`, `show()` and `close()` are absent entirely.
 *
 * This is a gap in the test environment, not in the application. The Modal
 * component drives the element exactly as the HTML specification describes, so
 * the shim below implements that same contract rather than working around it:
 * showModal() opens the dialog, close() closes it and fires the `close` event
 * that every dismissal path is expected to produce. Tests therefore exercise
 * the component's real logic; only the browser's built-in rendering, top-layer
 * placement and focus trap are unavailable, and those are verified in a real
 * browser instead (Milestone 2, step 6).
 *
 * Guarded so it degrades to a no-op if a future jsdom adds the methods.
 */
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype;

  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };

    proto.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };

    proto.close = function close(
      this: HTMLDialogElement,
      returnValue?: string,
    ) {
      if (returnValue !== undefined) {
        this.returnValue = returnValue;
      }
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
}
