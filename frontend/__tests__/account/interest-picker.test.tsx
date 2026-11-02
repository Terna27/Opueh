import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { InterestPicker } from "@/components/account/interest-picker";
import type { Category } from "@/lib/api/types";
import { MAX_INTERESTS } from "@/lib/validation";

/*
 * The category chooser.
 *
 * The upper bound is the part worth testing: it is enforced by REFUSING a
 * click, not by accepting it and complaining later. A UI that accepted an 11th
 * selection would be holding a state the backend will not save, and the user
 * would only find out at submit — after the click that appeared to work.
 */

/** Twelve, so "one more than the maximum" is reachable. */
const CATEGORIES: Category[] = Array.from({ length: MAX_INTERESTS + 2 }, (_, i) => ({
  id: `0000000${i}-0000-0000-0000-000000000000`,
  name: `Category ${i}`,
  slug: `category-${i}`,
  description: null,
}));

/** The picker is controlled, so the test owns the selection like a page does. */
function Harness({ initial = [] as string[] }) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <>
      <InterestPicker
        categories={CATEGORIES}
        selected={selected}
        onChange={setSelected}
      />
      {/*
        A div, not an <output>: <output> carries an implicit `status` role,
        which would collide with the picker's own live region and make
        getByRole("status") ambiguous.
      */}
      <div data-testid="selected">{selected.join(",")}</div>
    </>
  );
}

function selected(): string {
  return screen.getByTestId("selected").textContent ?? "";
}

function box(name: string): HTMLInputElement {
  return screen.getByLabelText(name) as HTMLInputElement;
}

describe("InterestPicker", () => {
  it("renders one checkbox per category, each named by its label", () => {
    render(<Harness />);

    for (const category of CATEGORIES) {
      const input = box(category.name);
      expect(input.type).toBe("checkbox");
      // Named by the label wrapping it, which is what makes it announceable
      // and clickable by its text rather than only by its 16px box.
      expect(input.disabled).toBe(false);
    }
  });

  it("gives the group a name", () => {
    render(<Harness />);

    // A dozen bare checkboxes with no legend gives a screen reader no clue
    // what is being chosen.
    expect(screen.getByRole("group")).toBeDefined();
    expect(screen.getByText("What do you want to watch?")).toBeDefined();
  });

  it("is operable by keyboard: every option can take focus", () => {
    render(<Harness />);

    for (const category of CATEGORIES) {
      const input = box(category.name);
      input.focus();
      // jsdom does not implement Space-to-toggle on a checkbox, so the honest
      // assertion is the precondition: a real, enabled checkbox that can hold
      // focus. A disabled or display:none control could not.
      expect(document.activeElement).toBe(input);
    }
  });

  it("adds a category and reports the new selection upward", () => {
    render(<Harness />);

    fireEvent.click(box("Category 0"));

    expect(selected()).toBe(CATEGORIES[0].id);
  });

  it("removes a category that is already chosen", () => {
    render(<Harness initial={[CATEGORIES[0].id, CATEGORIES[1].id]} />);

    fireEvent.click(box("Category 0"));

    expect(selected()).toBe(CATEGORIES[1].id);
  });

  it("counts the selection against the maximum", () => {
    render(<Harness initial={[CATEGORIES[0].id]} />);

    expect(screen.getByText(`1 of ${MAX_INTERESTS} selected`)).toBeDefined();

    fireEvent.click(box("Category 1"));

    expect(screen.getByText(`2 of ${MAX_INTERESTS} selected`)).toBeDefined();
  });

  it("allows exactly the maximum", () => {
    const full = CATEGORIES.slice(0, MAX_INTERESTS - 1).map((c) => c.id);
    render(<Harness initial={full} />);

    fireEvent.click(box(`Category ${MAX_INTERESTS - 1}`));

    expect(selected().split(",")).toHaveLength(MAX_INTERESTS);
    // Nothing was refused, so nothing is being complained about.
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("refuses the selection past the maximum, in the backend's own words", () => {
    const full = CATEGORIES.slice(0, MAX_INTERESTS).map((c) => c.id);
    render(<Harness initial={full} />);

    fireEvent.click(box(`Category ${MAX_INTERESTS}`));

    // The selection is unchanged — the click was refused, not accepted and
    // then reported as an error after the fact.
    expect(selected().split(",")).toHaveLength(MAX_INTERESTS);
    expect(selected()).not.toContain(CATEGORIES[MAX_INTERESTS].id);
    // The same sentence a direct API call would produce, so the UI and the API
    // are visibly the same rule rather than two similar ones.
    expect(screen.getByRole("status").textContent).toBe(
      `at most ${MAX_INTERESTS} categories may be selected`,
    );
  });

  it("still allows deselecting while at the maximum", () => {
    const full = CATEGORIES.slice(0, MAX_INTERESTS).map((c) => c.id);
    render(<Harness initial={full} />);

    // Pressing against the limit must not lock the user in.
    fireEvent.click(box("Category 0"));

    expect(selected().split(",")).toHaveLength(MAX_INTERESTS - 1);
  });

  it("clears the refusal once a selection is made again", () => {
    const full = CATEGORIES.slice(0, MAX_INTERESTS).map((c) => c.id);
    render(<Harness initial={full} />);

    fireEvent.click(box(`Category ${MAX_INTERESTS}`));
    expect(screen.getByRole("status").textContent).not.toBe("");

    // Freeing a slot makes the refused click available again, so the message
    // describing it is stale and must go.
    fireEvent.click(box("Category 0"));
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("shows a description when the category has one, and nothing when it is null", () => {
    render(
      <InterestPicker
        categories={[
          { ...CATEGORIES[0], description: "The first one." },
          CATEGORIES[1],
        ]}
        selected={[]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText("The first one.")).toBeDefined();
    // `description` is nullable upstream, and rendering "null" for an unset
    // one is the failure this is here to catch.
    expect(screen.getByRole("group").textContent).not.toContain("null");
  });

  it("does not enforce the lower bound on arrival", () => {
    render(<Harness />);

    // Someone who has not chosen yet has done nothing wrong. Complaining
    // before they have had a chance to choose would be scolding them for
    // showing up; the submit button is where the minimum belongs.
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("does not fire onChange when a click is refused", () => {
    const onChange = vi.fn();
    render(
      <InterestPicker
        categories={CATEGORIES}
        selected={CATEGORIES.slice(0, MAX_INTERESTS).map((c) => c.id)}
        onChange={onChange}
      />,
    );

    fireEvent.click(box(`Category ${MAX_INTERESTS}`));

    expect(onChange).not.toHaveBeenCalled();
  });
});
