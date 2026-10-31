import Demo from "@/components/Demo";
import { publicAnchorEnabled } from "@/lib/public-anchor";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Demo anchorEnabled={publicAnchorEnabled()} />;
}
