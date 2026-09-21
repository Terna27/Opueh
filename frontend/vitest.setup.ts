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
