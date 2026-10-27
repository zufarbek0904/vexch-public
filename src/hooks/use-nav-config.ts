import { useEffect, useState } from "react";
import { DEFAULT_NAV, loadNav, subscribeNav, type NavSectionId } from "@/lib/navigation";

/** Reads the saved tab list after hydration to avoid SSR mismatches. */
export function useNavConfig(): NavSectionId[] {
  const [list, setList] = useState<NavSectionId[]>(DEFAULT_NAV);
  useEffect(() => {
    setList(loadNav());
    return subscribeNav(() => setList(loadNav()));
  }, []);
  return list;
}
