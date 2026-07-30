"use client";

import type { DirectorySort } from "../../../server/competition/public";

/**
 * The sort control is a plain `<select name="sort">` INSIDE the directory's GET
 * form, so the result is an ordinary URL — shareable, back-buttonable, and
 * identical whether it was reached by picking an option or by pasting a link.
 * The only thing client-side here is the courtesy of not making you press
 * "Search" after choosing: changing the value submits the form the select
 * already belongs to. Without JS the control still posts with the next search,
 * which is why it carries no click handler of its own.
 */
export function SortSelect({ value }: { value: DirectorySort }) {
  return (
    <label className="showcase-sort public-sort">
      <span className="public-sort-label">Sort by</span>
      <select
        name="sort"
        defaultValue={value}
        data-testid="directory-sort"
        onChange={(event) => {
          event.currentTarget.form?.requestSubmit();
        }}
      >
        <option value="opportunity">Live and open first</option>
        <option value="soon">Starting soonest</option>
        <option value="name">Name (A–Z)</option>
      </select>
    </label>
  );
}
