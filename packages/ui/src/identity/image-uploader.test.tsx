import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageUploader, type UploadOutcome } from "./image-uploader";

function fileInput(): HTMLInputElement {
  // The visually-hidden input is the only file control in the component.
  const input = document.querySelector('input[type="file"]');
  if (input === null) {
    throw new Error("file input not found");
  }
  return input as HTMLInputElement;
}

describe("ImageUploader", () => {
  it("renders the label, the branded preview, and the format hint", () => {
    render(<ImageUploader label="Team logo" name="Alpha Warriors" onUpload={vi.fn()} />);
    expect(screen.getByText("Team logo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload image" })).toBeInTheDocument();
    expect(screen.getByText(/up to 5 MB/i)).toBeInTheDocument();
  });

  it("rejects a wrong file type client-side and never calls onUpload", () => {
    const onUpload = vi.fn();
    render(<ImageUploader label="Photo" name="Ravi" onUpload={onUpload} />);
    const bad = new File(["x"], "doc.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput(), { target: { files: [bad] } });
    expect(screen.getByRole("alert")).toHaveTextContent(/JPEG, PNG or WebP/i);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("calls onUpload for a valid image and shows the returned photo", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    });
    const onUpload = vi.fn(
      async (): Promise<UploadOutcome> => ({ ok: true, url: "/_media/ok.jpg" }),
    );
    render(<ImageUploader label="Photo" name="Ravi" onUpload={onUpload} />);
    const good = new File(["bytes"], "p.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput(), { target: { files: [good] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      const img = screen.getByTestId("player-image").querySelector("img");
      expect(img).toHaveAttribute("src", "/_media/ok.jpg");
    });
    vi.unstubAllGlobals();
  });
});
