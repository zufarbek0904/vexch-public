import { createFileRoute } from "@tanstack/react-router";
import { ConversationKindPage } from "@/components/ConversationKindPage";

export const Route = createFileRoute("/_authenticated/groups")({
  head: () => ({ meta: [{ title: "Группы — VexChat" }, { name: "description", content: "Группы VexChat." }] }),
  component: () => <ConversationKindPage kind="group" />,
});
