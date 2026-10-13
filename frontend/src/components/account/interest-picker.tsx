"use client";

import { useId, useState } from "react";

import type { Category } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { MAX_INTERESTS, validateInterestCount } from "@/lib/validation";

export type InterestPickerProps = {
  categories: Category[];
  /** The chosen category ids. The parent owns this; the picker never stores it. */
  selected: readonly string[];
  onChange: (categoryIds: string[]) => void;
  disabled?: boolean;
};

/*
 * The category chooser.
 *
 * A fieldset rather than a div, because the group needs a name: a screen
 * reader announcing twelve bare checkboxes gives no clue what is being chosen.
 *
 * The upper bound is enforced by REFUSING the selection, not by allowing it and
 * then showing an error. The backend rejects an 11th id outright, so a UI that
 * accepted one would be holding a state that cannot be saved — the failure
 * would just arrive later, at submit, with the user's click apparently having
 * worked. The refusal speaks in the backend's own words so the message matches
 * what a direct API call would say.
 *
 * The lower bound is deliberately NOT enforced here. A first-time visitor has
 * zero selected and has done nothing wrong yet; complaining before they have
 * had a chance to choose would be scolding them for arriving.
 */
export function InterestPicker({
  categories,
  selected,
  onChange,
  disabled = false,
}: InterestPickerProps) {
  const countId = useId();
  const statusId = useId();
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  const chosen = new Set(selected);

  function toggle(categoryId: string) {
    const next = new Set(chosen);

    if (next.has(categoryId)) {
      next.delete(categoryId);
      setRefusal(undefined);
      onChange([...next]);
      return;
    }

    if (next.size >= MAX_INTERESTS) {
      // +1 for the one being attempted: the rule is about the resulting count.
      setRefusal(validateInterestCount(next.size + 1));
      return;
    }

    next.add(categoryId);
    setRefusal(undefined);
    onChange([...next]);
  }

  return (
    <fieldset
      disabled={disabled}
      aria-describedby={`${countId} ${statusId}`}
      className="flex flex-col gap-3"
    >
      <legend className="text-sm font-medium text-foreground">
        What do you want to watch?
      </legend>

      <p id={countId} className="text-sm text-muted">
        {selected.length} of {MAX_INTERESTS} selected
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {categories.map((category) => {
          const fieldId = `interest-${category.id}`;
          const isChosen = chosen.has(category.id);

          return (
            <label
              key={category.id}
              htmlFor={fieldId}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border border-border p-3",
                "transition-colors hover:bg-foreground/5",
                // Green, not the primary blue: a checked box is a CHOSEN
                // state, and this palette reserves green for exactly that.
                // Blue stays what it means everywhere else — something you
                // can act on.
                "has-[:checked]:border-success has-[:checked]:bg-success/5",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                id={fieldId}
                type="checkbox"
                checked={isChosen}
                onChange={() => toggle(category.id)}
                className="mt-0.5 size-4 shrink-0 accent-success"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {category.name}
                </span>
                {category.description ? (
                  <span className="text-xs text-muted">
                    {category.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>

      {/*
        A live region so the refusal is announced when it appears. Kept in the
        DOM even when empty: a region added at the moment it has something to
        say is not reliably picked up.
      */}
      <p id={statusId} role="status" className="min-h-5 text-sm text-destructive">
        {refusal ?? ""}
      </p>
    </fieldset>
  );
}
