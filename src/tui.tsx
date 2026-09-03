/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui";
import {
  asSnapshot,
  emptySnapshot,
  mergeProvider,
  type Snapshot,
} from "./format.ts";
import { Usage } from "./rpc.ts";
import { toSessionOptions } from "./sessions.ts";
import { UsageChip } from "./usage-chip.tsx";
import { UsageDialog } from "./usage-dialog.tsx";

export default Plugin.define({
  id: "oc.usage.cli",
  setup(context) {
    const [, setSnapshot] = context.storage.memory("snapshot", {
      initial: emptySnapshot(),
    });
    const [, setSelection] = context.storage.memory("selection", {
      initial: { sessionID: "", providerID: "", modelID: "" },
    });

    const remember = (sessionID: string, providerID: string, modelID = "") => {
      setSelection(
        (draft: { sessionID: string; providerID: string; modelID: string }) => {
          draft.sessionID = sessionID;
          draft.providerID = providerID;
          draft.modelID = modelID;
        },
      );
    };

    const write = (next: Snapshot) => {
      setSnapshot((draft: Snapshot) => {
        draft.fetchedAt = next.fetchedAt || draft.fetchedAt;
        draft.grok = mergeProvider(draft.grok, next.grok);
        draft.go = mergeProvider(draft.go, next.go);
        draft.anthropic = mergeProvider(draft.anthropic, next.anthropic);
        draft.meta = mergeProvider(draft.meta, next.meta);
      });
    };

    const fetchUsage = async (refresh: boolean) => {
      return asSnapshot(await context.client.rpc(Usage).get({ refresh }));
    };

    const refresh = async (force = false) => {
      try {
        write(await fetchUsage(force));
      } catch {
        // RPC may not be ready yet.
      }
    };

    const show = async () => {
      await refresh(true);
      context.ui.dialog.set({ size: "medium", centered: true });
      context.ui.dialog.show(() => <UsageDialog />);
    };

    const showSessions = async () => {
      const sessions = context.data.session.list() ?? [];
      if (sessions.length === 0) {
        context.ui.toast.show({ message: "No sessions" });
        return;
      }
      const current = context.ui.router.current();
      const currentID =
        current.type === "session" ? current.sessionID : undefined;
      const picked = await context.ui.dialog.select({
        title: "Sessions",
        placeholder: "Switch to session…",
        options: toSessionOptions(sessions),
        current: currentID,
      });
      if (!picked) return;
      if (context.ui.tabs.enabled()) {
        context.ui.tabs.open(picked);
      } else {
        context.ui.router.navigate({ type: "session", sessionID: picked });
      }
    };

    const layer = () => ({
      mode: "global" as const,
      priority: 10,
      commands: [
        {
          id: "oc.usage.show",
          title: "Show usage limits",
          group: "Usage",
          palette: true as const,
          slash: { name: "usage", aliases: ["limits"] },
          run: () => void show(),
        },
        {
          id: "oc.usage.sessions",
          title: "List sessions",
          group: "Usage",
          bind: "ctrl+w" as const,
          palette: true as const,
          run: () => void showSessions(),
        },
      ],
    });

    try {
      context.keymap.layer(layer);
    } catch {
      context.ui.slot({
        append: "app",
        render: () => {
          context.keymap.layer(layer);
          return null;
        },
      });
    }

    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => <UsageChip sessionID={input.sessionID} />,
    });

    const stopModel = context.data.on("session.model.selected", (event) => {
      remember(
        event.data.sessionID,
        event.data.model.providerID,
        event.data.model.id,
      );
      context.data.session.invalidate(event.data.sessionID);
      void context.data.session.sync(event.data.sessionID);
    });
    const stopAgent = context.data.on("session.agent.selected", (event) => {
      context.data.session.invalidate(event.data.sessionID);
      void context.data.session.sync(event.data.sessionID).then(() => {
        const model = context.data.session.get(event.data.sessionID)?.model;
        if (model?.providerID)
          remember(event.data.sessionID, model.providerID, model.id ?? "");
      });
    });

    let stopUpdated = () => {};
    try {
      stopUpdated = context.client.rpc(Usage).events.on("updated", (event) => {
        write(asSnapshot(event.data));
      });
    } catch {
      // RPC may not be ready yet.
    }

    const onTurnEnd = () => void refresh(false);
    const stopSucceeded = context.data.on(
      "session.execution.succeeded",
      onTurnEnd,
    );
    const stopFailed = context.data.on("session.execution.failed", onTurnEnd);
    const stopInterrupted = context.data.on(
      "session.execution.interrupted",
      (event) => {
        if (event.data.reason === "shutdown") return;
        onTurnEnd();
      },
    );

    void refresh(false);
    return () => {
      stopUpdated();
      stopSucceeded();
      stopFailed();
      stopInterrupted();
      stopModel();
      stopAgent();
    };
  },
});
