export interface DashboardAskTarget {
  id: string;
  rootUrl: string;
  completedPages: number;
}

export interface DashboardAskNavigation {
  pathname: string;
  state?: {
    openTab: "ask";
    initialAskQuestion: string;
    autoAsk: boolean;
  };
}

export function buildDashboardAskNavigation(
  target: DashboardAskTarget | null,
  question: string
): DashboardAskNavigation {
  if (!target) {
    return { pathname: "/new", state: undefined };
  }

  const trimmed = question.trim();
  return {
    pathname: `/jobs/${target.id}`,
    state: {
      openTab: "ask",
      initialAskQuestion: trimmed,
      autoAsk: trimmed.length > 0,
    },
  };
}
