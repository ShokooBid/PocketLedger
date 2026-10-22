import { PlaceholderScreen } from "../../placeholder-screen";

export default function ImportScreen() {
  return (
    <PlaceholderScreen
      title="CSV import"
      path="/import"
      description="A future import flow will validate a CSV, show a preview, and ask for confirmation before saving."
      emptyMessage="No file is selected. File selection and import are not available in this demo."
    />
  );
}
