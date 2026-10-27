import { createFileRoute } from "@tanstack/react-router";
import { ConversationKindPage } from "@/components/ConversationKindPage";

export const Route = createFileRoute("/_authenticated/channels")({
  head: () => ({ meta: [{ title: "Каналы — VexChat" }, { name: "description", content: "Каналы VexChat." }] }),
  component: () => <ConversationKindPage kind="channel" />,
});
