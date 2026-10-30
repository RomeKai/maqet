import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeliverView } from "./DeliverView";

const takeoffFixture = {
  preliminary: true,
  flags: [],
  stages: {
    foundations: [],
    walls: [],
    bond_beams_roof: [],
    openings: [],
    finishes: [],
  },
};

describe("DeliverView fetch", () => {
  it("shows DXF and CSV export buttons", () => {
    const scene: any = { id: "s", scale_confirmed: true, walls: [] };
    const { container } = render(<DeliverView scene={scene} takeoff={takeoffFixture as any} locale="en" />);
    expect(screen.getByText(/DXF/i)).toBeTruthy();
    expect(screen.getByText(/Export CSV/i)).toBeTruthy();
    expect(container.textContent).toBeTruthy();
  });

  it("shows preliminary label", () => {
    const scene: any = { id: "s", scale_confirmed: true, walls: [] };
    render(<DeliverView scene={scene} takeoff={null} locale="en" />);
    expect(screen.getByTestId("preliminary-label")).toBeTruthy();
  });
});
