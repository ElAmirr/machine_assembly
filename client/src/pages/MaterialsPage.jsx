// Materials page (spec section 16) — thin wrapper over the shared inventory page.
import InventoryPage from './InventoryPage.jsx';

export default function MaterialsPage() {
  return <InventoryPage kind="materials" />;
}
