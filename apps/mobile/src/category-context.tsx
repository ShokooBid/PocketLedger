import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren
} from "react";
import { createApiCategorySource } from "./category-api";
import { createDemoCategorySource, type CategorySource } from "./category-data";
import { useSession } from "./session";

const Categories = createContext<CategorySource | null>(null);
// The app layout remounts this provider for each verified session generation.
// No data source survives logout, switching accounts, or entering/leaving demo.
export function CategoriesProvider({ children }: PropsWithChildren) {
  const { session, controller } = useSession();
  const [source] = useState(() => {
    if (session.status === "demo") return createDemoCategorySource();
    if (session.status === "authenticated")
      return createApiCategorySource(
        controller.client(session.generation),
        process.env.EXPO_PUBLIC_FINANCE_CATEGORIES_ENABLED === "true"
      );
    throw new Error("Categories require an application session.");
  });
  return <Categories.Provider value={source}>{children}</Categories.Provider>;
}
export function useCategories() {
  const source = useContext(Categories);
  if (!source) throw new Error("CategoriesProvider is required.");
  return source;
}
