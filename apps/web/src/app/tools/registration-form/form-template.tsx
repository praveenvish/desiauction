"use client";

import { SPORTS, sportPackFor } from "@desiauction/core";
import { Button, Select } from "@desiauction/ui";
import { useState } from "react";

import { registrationTemplate } from "../../../content/tools";

/**
 * The Google Form questions for one sport (SEO-1 Phase 4d). Rendered on the
 * server for cricket, switched here; `content/tools.test.ts` runs every sport's
 * template through the real import, so what this lists is what imports.
 */
export function RegistrationTemplate() {
  const [sport, setSport] = useState("cricket");
  const [copied, setCopied] = useState(false);
  const pack = sportPackFor(sport);
  const questions = registrationTemplate(pack);

  const asText = questions
    .map((question, index) => {
      const head = `${String(index + 1)}. ${question.heading}${question.required ? " (required)" : ""} — ${question.kind}`;
      const choices =
        question.options === undefined ? "" : `\n   Choices: ${question.options.join(", ")}`;
      return head + choices;
    })
    .join("\n");

  return (
    <div className="tool-template">
      <div className="tool-template-bar">
        <Select
          label="Sport"
          value={sport}
          onChange={(event) => {
            setSport(event.currentTarget.value);
            setCopied(false);
          }}
        >
          {SPORTS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(asText).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? "Copied" : "Copy the questions"}
        </Button>
        <span className="visually-hidden" role="status">
          {copied ? "Questions copied" : ""}
        </span>
      </div>
      <ol className="tool-questions" data-testid="template-questions">
        {questions.map((question) => (
          <li key={question.field} className="tool-question">
            <p className="tool-question-head">
              <strong>{question.heading}</strong>
              <span className="tool-question-kind">
                {question.kind}
                {question.required ? " · required" : " · optional"}
              </span>
            </p>
            {question.options === undefined ? null : (
              <ul className="sport-chips">
                {question.options.map((option) => (
                  <li key={option}>{option}</li>
                ))}
              </ul>
            )}
            {question.note === undefined ? null : (
              <p className="tool-question-note">{question.note}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
