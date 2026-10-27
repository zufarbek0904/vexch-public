import { useSignedUrl } from "@/hooks/use-signed-url";
import { initials } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

export function UserAvatar({ path, name, className }: { path?: string | null; name?: string | null; className?: string }) {
  const url = useSignedUrl("avatars", path);
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-primary font-bold text-primary-foreground", className)}>
      {url ? <img src={url} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}
