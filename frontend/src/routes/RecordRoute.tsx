import { useParams } from "react-router-dom";

import { StubPage } from "../components/StubPage";

export function RecordRoute() {
  const { id } = useParams();
  return (
    <StubPage eyebrow="Recording" title="Play along">
      The recording + live-analysis flow for score{" "}
      <span className="font-medium text-ink">{id}</span> arrives in Batch 7.
    </StubPage>
  );
}
