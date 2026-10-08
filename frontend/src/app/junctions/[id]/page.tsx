import { JunctionDetailView } from "./JunctionDetailView";

export const instant = false;

export default async function JunctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <JunctionDetailView junctionId={decodeURIComponent(id).toUpperCase()} />;
}