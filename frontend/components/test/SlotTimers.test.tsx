import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SlotTimers } from "@/components/test/SlotTimers";

describe("SlotTimers", () => {
  it("shows preparation and recording countdowns side by side", () => {
    render(<SlotTimers prepRemaining={42} recordingRemaining={90} preparing recording={false} />);
    expect(screen.getByRole("timer", { name: "Preparation time left" })).toHaveTextContent("0:42");
    expect(screen.getByRole("timer", { name: "Recording time left" })).toHaveTextContent("1:30");
    expect(screen.getByText("Recording starts automatically when preparation ends.")).toBeInTheDocument();
  });

  it("shows the recording indicator and warns only in the last 10 s", () => {
    const { rerender } = render(<SlotTimers prepRemaining={0} recordingRemaining={11} preparing={false} recording />);
    expect(screen.getAllByText("Recording").length).toBeGreaterThan(1);
    expect(screen.queryByText(/Recording stops in/)).toBeNull();
    rerender(<SlotTimers prepRemaining={0} recordingRemaining={10} preparing={false} recording />);
    expect(screen.getByText("Recording stops in 10 s")).toBeInTheDocument();
  });
});
