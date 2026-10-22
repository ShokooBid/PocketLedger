import { PlaceholderScreen } from "../../placeholder-screen";
import { NavigationLink } from "../../ui";

export default function DashboardScreen() {
  return (
    <PlaceholderScreen
      title="Dashboard"
      path="/"
      description="Your income, expenses, and recent activity will appear here."
      emptyMessage="No summary is available in this demo. Explore the screens below."
    >
      <NavigationLink href="/transactions" label="View transactions" />
      <NavigationLink href="/categories" label="Manage categories" />
      <NavigationLink href="/import" label="Preview CSV import" />
      <NavigationLink href="/settings" label="Open settings" />
    </PlaceholderScreen>
  );
}
