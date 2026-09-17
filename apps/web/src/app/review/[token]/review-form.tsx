"use client";

import { Button, Field } from "@desiauction/ui";
import { useActionState, useState } from "react";

import {
  submitReviewAction,
  type ReviewFormState,
  type ReviewFormValues,
} from "../../../server/reviews/actions";
import type { ExistingReview } from "../../../server/reviews/reviews";

/**
 * THE REVIEW FORM (FR-1 Phase 2).
 *
 * The rating is five native radios in a fieldset — keyboard and screen readers
 * get a real radio group, and each option says what its number means rather
 * than leaving "3" to be interpreted.
 *
 * The quote permission is OFF by default and asks for the name to sign with
 * only once ticked. A default-on box would turn "I didn't notice" into consent,
 * and that is not a review we could put on the landing page honestly.
 */

const RATINGS: readonly { value: number; words: string }[] = [
  { value: 1, words: "Poor" },
  { value: 2, words: "Not great" },
  { value: 3, words: "OK" },
  { value: 4, words: "Good" },
  { value: 5, words: "Excellent" },
];

export function ReviewForm({
  token,
  suggestedName,
  existing,
}: {
  token: string;
  suggestedName: string | null;
  existing: ExistingReview | null;
}) {
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(
    submitReviewAction,
    {},
  );

  if (state.closed === true) {
    return (
      <p className="review-done" role="status">
        The team has already read your review, so it can&apos;t be changed from here. Thank you.
      </p>
    );
  }

  const errorFor = (name: string): string | undefined =>
    state.field === name && state.error !== undefined ? state.error : undefined;

  // What the fields start from: what was just sent, else what is on file.
  // The name field only exists while the box is ticked, so an unticked send
  // echoes an empty name; ticking it later should still offer theirs.
  const values: ReviewFormValues =
    state.values !== undefined
      ? {
          ...state.values,
          displayName:
            state.values.displayName === "" ? (suggestedName ?? "") : state.values.displayName,
        }
      : {
          rating: existing?.rating ?? null,
          wentWell: existing?.wentWell ?? "",
          improve: existing?.improve ?? "",
          mayQuote: existing?.mayQuote ?? false,
          displayName: existing?.displayName ?? suggestedName ?? "",
          displayOrg: existing?.displayOrg ?? "",
        };

  return (
    <ReviewFields
      // A new key per settle remounts the fields with `values` as their
      // defaults, which is what survives React's post-action form reset.
      key={state.version ?? 0}
      formAction={formAction}
      token={token}
      state={state}
      values={values}
      errorFor={errorFor}
      pending={pending}
      isEdit={existing !== null || state.saved === true}
    />
  );
}

function ReviewFields({
  formAction,
  token,
  state,
  values,
  errorFor,
  pending,
  isEdit,
}: {
  formAction: (formData: FormData) => void;
  token: string;
  state: ReviewFormState;
  values: ReviewFormValues;
  errorFor: (name: string) => string | undefined;
  pending: boolean;
  isEdit: boolean;
}) {
  const [mayQuote, setMayQuote] = useState(values.mayQuote);

  return (
    <form action={formAction} className="review-form" data-testid="review-form">
      <input type="hidden" name="token" value={token} />

      {state.saved === true ? (
        <p className="review-done" role="status" data-testid="review-saved">
          {state.firstTime === true
            ? "Thank you — your review is with the team."
            : "Saved — your changes are with the team."}{" "}
          You can still change it from this link until we&apos;ve read it.
        </p>
      ) : null}

      <fieldset
        className="review-rating"
        aria-describedby={errorFor("rating") !== undefined ? "review-rating-error" : undefined}
      >
        <legend>Overall, how was it?</legend>
        <div className="review-rating-options">
          {RATINGS.map((option) => (
            <label key={option.value} className="review-rating-option">
              <input
                type="radio"
                name="rating"
                value={option.value}
                required
                defaultChecked={values.rating === option.value}
              />
              <span className="review-rating-number">{option.value}</span>
              <span className="review-rating-words">{option.words}</span>
            </label>
          ))}
        </div>
        {errorFor("rating") !== undefined ? (
          <p id="review-rating-error" className="review-error" role="alert">
            {errorFor("rating")}
          </p>
        ) : null}
      </fieldset>

      <TextArea
        id="review-went-well"
        name="wentWell"
        label="What went well?"
        placeholder="The part that saved you time, or the moment the room noticed."
        defaultValue={values.wentWell}
        error={errorFor("wentWell")}
      />
      <TextArea
        id="review-improve"
        name="improve"
        label="What should we improve?"
        placeholder="Where you got stuck, or what you had to do outside DesiAuction."
        defaultValue={values.improve}
        error={errorFor("improve")}
      />

      <div className="review-quote">
        <label className="review-check">
          <input
            type="checkbox"
            name="mayQuote"
            value="yes"
            checked={mayQuote}
            onChange={(event) => {
              setMayQuote(event.currentTarget.checked);
            }}
          />
          <span>DesiAuction may quote this review publicly, with the name below.</span>
        </label>
        {mayQuote ? (
          <div className="review-quote-fields">
            <Field
              label="Name to show"
              name="displayName"
              required
              maxLength={80}
              defaultValue={values.displayName}
              error={errorFor("displayName")}
            />
            <Field
              label="Club or tournament (optional)"
              name="displayOrg"
              maxLength={120}
              defaultValue={values.displayOrg}
              error={errorFor("displayOrg")}
            />
          </div>
        ) : null}
      </div>

      {state.error !== undefined && state.field === undefined ? (
        <p className="review-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="lg" loading={pending}>
          {isEdit ? "Save changes" : "Send review"}
        </Button>
      </div>
    </form>
  );
}

function TextArea({
  id,
  name,
  label,
  placeholder,
  defaultValue,
  error,
}: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  error: string | undefined;
}) {
  return (
    <div className="review-field">
      <label htmlFor={id} className="review-label">
        {label} <span className="review-optional">(optional)</span>
      </label>
      <textarea
        id={id}
        name={name}
        rows={4}
        maxLength={2000}
        className="review-textarea"
        placeholder={placeholder}
        defaultValue={defaultValue}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? `${id}-error` : undefined}
      />
      {error !== undefined ? (
        <p id={`${id}-error`} className="review-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
