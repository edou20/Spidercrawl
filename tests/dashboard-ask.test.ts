import { describe, expect, it } from "vitest";
import { buildDashboardAskNavigation } from "../dashboard/src/dashboard-ask.ts";

describe("buildDashboardAskNavigation", () => {
  it("sends a typed question to the crawl ask tab", () => {
    expect(
      buildDashboardAskNavigation(
        { id: "job_123", rootUrl: "https://example.com", completedPages: 8 },
        "What changed?"
      )
    ).toEqual({
      pathname: "/jobs/job_123",
      state: {
        openTab: "ask",
        initialAskQuestion: "What changed?",
        autoAsk: true,
      },
    });
  });

  it("opens the crawl without auto-asking when there is no question yet", () => {
    expect(
      buildDashboardAskNavigation(
        { id: "job_123", rootUrl: "https://example.com", completedPages: 8 },
        "   "
      )
    ).toEqual({
      pathname: "/jobs/job_123",
      state: {
        openTab: "ask",
        initialAskQuestion: "",
        autoAsk: false,
      },
    });
  });

  it("falls back to the new crawl flow when there is no crawl target", () => {
    expect(buildDashboardAskNavigation(null, "Anything")).toEqual({
      pathname: "/new",
      state: undefined,
    });
  });
});
