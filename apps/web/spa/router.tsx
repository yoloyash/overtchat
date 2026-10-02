import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { queryClient } from "@/lib/queryClient";
import { appRoute, authRoute, rootRoute } from "@/spa/routes/root";
import { loginRoute, signupRoute } from "@/spa/routes/auth";
import { chatRoute, homeRoute } from "@/spa/routes/chat";
import {
  activityIndexRoute,
  activityProfileRoute,
  activityRoute,
  agentSessionRoute,
  libraryRoute,
  newAgentSessionRoute,
  projectRoute,
} from "@/spa/routes/pages";
import {
  accountSettingsRoute,
  connectionsSettingsRoute,
  dataSettingsRoute,
  generalSettingsRoute,
  mcpServerSettingsRoute,
  modelSettingsRoute,
  modelsSettingsRoute,
  newMcpServerSettingsRoute,
  newModelSettingsRoute,
  personalizationSettingsRoute,
  profileSettingsRoute,
  servicesSettingsRoute,
  settingsIndexRoute,
  settingsRoute,
  toolsSettingsRoute,
  usersSettingsRoute,
} from "@/spa/routes/settings";

const routeTree = rootRoute.addChildren([
  authRoute.addChildren([loginRoute, signupRoute]),
  appRoute.addChildren([
    homeRoute,
    chatRoute,
    projectRoute,
    newAgentSessionRoute,
    agentSessionRoute,
    libraryRoute,
    activityRoute.addChildren([activityIndexRoute, activityProfileRoute]),
    settingsRoute.addChildren([
      settingsIndexRoute,
      generalSettingsRoute,
      accountSettingsRoute,
      profileSettingsRoute,
      personalizationSettingsRoute,
      dataSettingsRoute,
      connectionsSettingsRoute,
      modelsSettingsRoute,
      newModelSettingsRoute,
      modelSettingsRoute,
      servicesSettingsRoute,
      toolsSettingsRoute,
      newMcpServerSettingsRoute,
      mcpServerSettingsRoute,
      usersSettingsRoute,
    ]),
  ]),
]);

/** Search params stay plain strings, matching `URLSearchParams`. */
function parseSearch(search: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (!(key in params)) params[key] = value;
  }
  return params;
}

function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Creates the UI router. Bundled clients pass their own history. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    parseSearch,
    stringifySearch,
    // Pages remount when their path params change, as Next's did.
    defaultRemountDeps: ({ params }) => params,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
