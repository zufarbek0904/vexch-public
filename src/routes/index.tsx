import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VexChat — мессенджер" },
      { name: "description", content: "VexChat — мессенджер для личных сообщений, групп, каналов и звонков." },
      { property: "og:title", content: "VexChat — мессенджер" },
      { property: "og:description", content: "Личные сообщения, группы, каналы и звонки." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/chats" });
  },
});
