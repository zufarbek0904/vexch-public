import { useQuery } from "@tanstack/react-query";
import { signedUrl } from "@/lib/db";

export function useSignedUrl(bucket: string, path: string | null | undefined) {
  return useQuery({ queryKey: ["signed", bucket, path], enabled: !!path, staleTime: 50 * 60_000, queryFn: () => signedUrl(bucket, path) }).data ?? null;
}
